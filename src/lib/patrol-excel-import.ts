import * as XLSX from "xlsx"

import type { Employee, PatrolPositionCode, PatrolScheduleRow, ShiftType } from "../types"

type ParsedPatrolImport = {
  scheduleRows: PatrolScheduleRow[]
  overrideRows: PatrolScheduleRow[]
  unmatchedNames: string[]
  importedDateRange: {
    start: string
    end: string
  } | null
}

const DAY_COLUMN_STARTS = [1, 4, 7, 10, 13, 16, 19]

const WORKING_ROW_LAYOUT: Array<{
  offset: number
  shiftType: ShiftType
  positionCode: PatrolPositionCode
}> = [
  { offset: 2, shiftType: "Days", positionCode: "SUP1" },
  { offset: 4, shiftType: "Days", positionCode: "SUP2" },
  { offset: 6, shiftType: "Days", positionCode: "DEP1" },
  { offset: 8, shiftType: "Days", positionCode: "DEP2" },
  { offset: 10, shiftType: "Days", positionCode: "POL" },
  { offset: 13, shiftType: "Nights", positionCode: "POL" },
  { offset: 15, shiftType: "Nights", positionCode: "SUP1" },
  { offset: 17, shiftType: "Nights", positionCode: "SUP2" },
  { offset: 19, shiftType: "Nights", positionCode: "DEP1" },
  { offset: 21, shiftType: "Nights", positionCode: "DEP2" }
]

const OFF_STATUS_MAP: Record<string, string> = {
  VAC: "Vacation",
  VACATION: "Vacation",
  SICK: "Sick",
  FMLA: "FMLA",
  TR: "Training",
  TRNG: "Training",
  TRAINING: "Training",
  K9TR: "Training",
  CT: "Court",
  COURT: "Court",
  MIL: "Professional Leave",
  WC: "Off",
  BEREAVEMENT: "Bereavement",
  BRVMT: "Bereavement",
  CALL: "Call Out",
  CALLOUT: "Call Out",
  OFF: "Off"
}

function normalizeCellValue(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim()
}

function normalizeImportedName(value: unknown) {
  return normalizeCellValue(value)
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function buildRowKey(row: Pick<PatrolScheduleRow, "assignment_date" | "shift_type" | "position_code">) {
  return `${row.assignment_date}-${row.shift_type}-${row.position_code}`
}

function parseMonthLabel(label: string) {
  const normalized = normalizeCellValue(label)
  const match = normalized.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[A-Za-z]*.*?(\d{2,4})/i)
  if (!match) return null

  const monthMap: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    sept: 8,
    oct: 9,
    nov: 10,
    dec: 11
  }

  const monthIndex = monthMap[match[1].toLowerCase()]
  let year = Number(match[2])
  if (year < 100) year += 2000
  if (Number.isNaN(monthIndex) || Number.isNaN(year)) return null
  return { monthIndex, year }
}

function parseBlockStartDate(label: string, dayValue: string) {
  const parsedMonth = parseMonthLabel(label)
  const day = Number(normalizeCellValue(dayValue))
  if (!parsedMonth || Number.isNaN(day)) return null
  return new Date(parsedMonth.year, parsedMonth.monthIndex, day)
}

function normalizeHours(token: string, shiftType: ShiftType) {
  const normalized = normalizeCellValue(token)
  if (!normalized) return shiftType === "Days" ? "5a-5p" : "5p-5a"
  if (normalized === "5-5") return shiftType === "Days" ? "5a-5p" : "5p-5a"
  return normalized
}

function parseStatusOrHours(token: string, shiftType: ShiftType) {
  const normalized = normalizeCellValue(token)
  if (!normalized) {
    return {
      status: "Scheduled",
      shiftHours: normalizeHours("", shiftType)
    }
  }

  const compact = normalized.replace(/\s+/g, "").toUpperCase()
  const mappedStatus = OFF_STATUS_MAP[compact]
  if (mappedStatus) {
    return {
      status: mappedStatus,
      shiftHours: normalizeHours("", shiftType)
    }
  }

  const looksLikeHours = /\d/.test(normalized) && !/[A-Za-z]/.test(normalized)
  if (looksLikeHours) {
    return {
      status: "Scheduled",
      shiftHours: normalizeHours(normalized, shiftType)
    }
  }

  return {
    status: "Off",
    shiftHours: normalizeHours("", shiftType)
  }
}

function findEmployeeByLastName(employeesByLastName: Map<string, Employee>, lastName: string) {
  return employeesByLastName.get(normalizeImportedName(lastName).toLowerCase()) || null
}

function isActiveOverrideStatus(status: string | null | undefined) {
  return Boolean(status) && status !== "Scheduled" && status !== "Open Shift"
}

export async function parsePatrolWorkbook(
  file: File,
  employees: Employee[],
  todayIso: string
): Promise<ParsedPatrolImport> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: "array" })
  const employeesByLastName = new Map(
    employees.map((employee) => [employee.lastName.trim().toLowerCase(), employee] as const)
  )

  const scheduleMap = new Map<string, PatrolScheduleRow>()
  const overrideMap = new Map<string, PatrolScheduleRow>()
  const unmatchedNames = new Set<string>()
  let minDate: string | null = null
  let maxDate: string | null = null

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(worksheet, {
      header: 1,
      raw: false,
      defval: ""
    })

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || []
      const monthLabel = normalizeCellValue(row[0])
      const firstDayValue = normalizeCellValue(row[1])
      const blockStart = parseBlockStartDate(monthLabel || sheetName, firstDayValue)

      if (!blockStart) continue

      for (const dayIndex of DAY_COLUMN_STARTS.keys()) {
        const date = new Date(blockStart)
        date.setDate(blockStart.getDate() + dayIndex)
        const isoDate = date.toISOString().slice(0, 10)
        if (minDate === null || isoDate.localeCompare(minDate) < 0) {
          minDate = isoDate
        }
        if (maxDate === null || isoDate.localeCompare(maxDate) > 0) {
          maxDate = isoDate
        }

        const colStart = DAY_COLUMN_STARTS[dayIndex]

        for (const definition of WORKING_ROW_LAYOUT) {
          const workingRow = rows[rowIndex + definition.offset] || []
          const replacementRow = rows[rowIndex + definition.offset + 1] || []

          const vehicle = normalizeCellValue(workingRow[colStart])
          const lastName = normalizeImportedName(workingRow[colStart + 1])
          const hoursOrStatus = normalizeCellValue(workingRow[colStart + 2])

          if (!vehicle && !lastName && !hoursOrStatus) continue

          const matchedEmployee = findEmployeeByLastName(employeesByLastName, lastName)
          if (lastName && !matchedEmployee) unmatchedNames.add(lastName)

          const resolved = parseStatusOrHours(hoursOrStatus, definition.shiftType)

          const replacementVehicle = normalizeCellValue(replacementRow[colStart])
          const replacementLastName = normalizeImportedName(replacementRow[colStart + 1])
          const replacementHoursToken = normalizeCellValue(replacementRow[colStart + 2])
          const matchedReplacement = findEmployeeByLastName(employeesByLastName, replacementLastName)
          if (replacementLastName && !matchedReplacement) unmatchedNames.add(replacementLastName)

          const patrolRow: PatrolScheduleRow = {
            assignment_date: isoDate,
            shift_type: definition.shiftType,
            position_code: definition.positionCode,
            employee_id: matchedEmployee?.id || null,
            vehicle: vehicle || matchedEmployee?.defaultVehicle || null,
            shift_hours: resolved.shiftHours || matchedEmployee?.defaultShiftHours || null,
            status: resolved.status,
            replacement_employee_id: matchedReplacement?.id || null,
            replacement_vehicle: replacementVehicle || matchedReplacement?.defaultVehicle || null,
            replacement_hours: replacementHoursToken
              ? normalizeHours(replacementHoursToken, definition.shiftType)
              : matchedReplacement?.defaultShiftHours || null
          }

          scheduleMap.set(buildRowKey(patrolRow), patrolRow)

          if (isoDate >= todayIso && (isActiveOverrideStatus(patrolRow.status) || patrolRow.replacement_employee_id)) {
            overrideMap.set(buildRowKey(patrolRow), patrolRow)
          }
        }
      }
    }
  }

  return {
    scheduleRows: [...scheduleMap.values()].sort((a, b) =>
      a.assignment_date.localeCompare(b.assignment_date) ||
      a.shift_type.localeCompare(b.shift_type) ||
      a.position_code.localeCompare(b.position_code)
    ),
    overrideRows: [...overrideMap.values()].sort((a, b) =>
      a.assignment_date.localeCompare(b.assignment_date) ||
      a.shift_type.localeCompare(b.shift_type) ||
      a.position_code.localeCompare(b.position_code)
    ),
    unmatchedNames: [...unmatchedNames].sort((a, b) => a.localeCompare(b)),
    importedDateRange:
      minDate && maxDate
        ? {
            start: minDate,
            end: maxDate
          }
        : null
  }
}

export type { ParsedPatrolImport }

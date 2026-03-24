import { initialEmployees } from "../data/employees"
import type { Employee, PatrolPositionCode, ShiftType, Team } from "../types"
import { supabase } from "./supabase"

const POSITIONS: PatrolPositionCode[] = ["SUP1", "SUP2", "DEP1", "DEP2", "POL"]
const SHIFTS: ShiftType[] = ["Days", "Nights"]
const seededMonthCache = new Set<string>()
const SCHEDULE_ROTATION_VERSION = "2026-03-anchor-fix"

type PatrolScheduleRow = {
  id?: string
  assignment_date: string
  shift_type: ShiftType
  position_code: PatrolPositionCode
  employee_id: string | null
  vehicle: string | null
  shift_hours: string | null
  status: string | null
  replacement_employee_id: string | null
  replacement_vehicle: string | null
  replacement_hours: string | null
}

function getMonthRange(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1)
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  return { start, end }
}

function toISO(date: Date) {
  return date.toISOString().slice(0, 10)
}

function getCalendarDayDiff(date: Date, anchor: Date) {
  const utcDate = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const utcAnchor = Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
  return Math.round((utcDate - utcAnchor) / 86400000)
}

function getActiveTeam(date: Date, shift: ShiftType): Team {
  const pitman = [0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0]
  const start = new Date("2026-03-01T12:00:00")
  const diff = getCalendarDayDiff(date, start)
  const idx = pitman[((diff % pitman.length) + pitman.length) % pitman.length]

  if (shift === "Days") return idx ? "Days A" : "Days B"
  return idx ? "Nights A" : "Nights B"
}

function getShiftHours(shift: ShiftType) {
  return shift === "Days" ? "5a-5p" : "5p-5a"
}

function getAssignmentForPosition(teamEmployees: Employee[], position: PatrolPositionCode) {
  switch (position) {
    case "SUP1":
      return teamEmployees.find((employee) => employee.rank === "Sgt") || null
    case "SUP2":
      return teamEmployees.find((employee) => employee.rank === "Cpl") || null
    case "DEP1":
      return (
        teamEmployees.filter((employee) => employee.rank === "Deputy")[0] || null
      )
    case "DEP2":
      return (
        teamEmployees.filter((employee) => employee.rank === "Deputy")[1] || null
      )
    case "POL":
      return (
        teamEmployees.find((employee) => employee.rank === "Poland Deputy") || null
      )
    default:
      return null
  }
}

function buildSeedRow(
  date: Date,
  shift: ShiftType,
  position: PatrolPositionCode
): PatrolScheduleRow {
  const activeTeam = getActiveTeam(date, shift)
  const teamEmployees = initialEmployees.filter(
    (employee) => employee.status === "Active" && employee.team === activeTeam
  )
  const assignedEmployee = getAssignmentForPosition(teamEmployees, position)
  const shiftHours = assignedEmployee?.defaultShiftHours || getShiftHours(shift)

  return {
    assignment_date: toISO(date),
    shift_type: shift,
    position_code: position,
    employee_id: assignedEmployee?.id || null,
    vehicle: assignedEmployee?.defaultVehicle || null,
    shift_hours: shiftHours,
    status: assignedEmployee ? "Scheduled" : "Open Shift",
    replacement_employee_id: null,
    replacement_vehicle: null,
    replacement_hours: shiftHours
  }
}

export async function ensureMonthSchedule(baseDate: Date) {
  const { start, end } = getMonthRange(baseDate)
  const monthStart = toISO(start)
  const monthEnd = toISO(end)
  const monthKey = `${SCHEDULE_ROTATION_VERSION}-${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`

  if (seededMonthCache.has(monthKey)) {
    return
  }

  const { data: existing, error } = await supabase
    .from("patrol_schedule")
    .select("id,assignment_date,shift_type,position_code,employee_id,status,replacement_employee_id")
    .gte("assignment_date", monthStart)
    .lte("assignment_date", monthEnd)

  if (error) {
    console.error("Failed loading patrol_schedule seeds:", error)
    return
  }

  const existingRows = (existing || []) as PatrolScheduleRow[]
  const existingMap = new Map(
    existingRows.map((row) => [
      `${row.assignment_date}-${row.shift_type}-${row.position_code}`,
      row
    ])
  )

  const inserts: PatrolScheduleRow[] = []
  const updates: PatrolScheduleRow[] = []

  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    for (const shift of SHIFTS) {
      for (const position of POSITIONS) {
        const seedRow = buildSeedRow(date, shift, position)
        const key = `${seedRow.assignment_date}-${shift}-${position}`
        const existingRow = existingMap.get(key)

        if (!existingRow) {
          inserts.push(seedRow)
          continue
        }

        const shouldSeedExistingRow =
          !existingRow.employee_id &&
          !existingRow.replacement_employee_id &&
          (existingRow.status === "Open Shift" || !existingRow.status)

        const shouldRealignSeededRow =
          Boolean(seedRow.employee_id) &&
          existingRow.employee_id !== seedRow.employee_id &&
          !existingRow.replacement_employee_id &&
          existingRow.status === "Scheduled"

        if (shouldSeedExistingRow && seedRow.employee_id) {
          updates.push({
            ...existingRow,
            employee_id: seedRow.employee_id,
            vehicle: seedRow.vehicle,
            shift_hours: seedRow.shift_hours,
            status: "Scheduled",
            replacement_employee_id: null,
            replacement_vehicle: null,
            replacement_hours: seedRow.shift_hours
          })
        } else if (shouldRealignSeededRow) {
          updates.push({
            ...existingRow,
            employee_id: seedRow.employee_id,
            vehicle: seedRow.vehicle,
            shift_hours: seedRow.shift_hours,
            status: "Scheduled",
            replacement_employee_id: null,
            replacement_vehicle: null,
            replacement_hours: seedRow.shift_hours
          })
        }
      }
    }
  }

  if (inserts.length > 0) {
    const { error: insertError } = await supabase
      .from("patrol_schedule")
      .insert(inserts)

    if (insertError) {
      console.error("Failed creating patrol_schedule rows:", insertError)
    }
  }

  if (updates.length > 0) {
    const { error: updateError } = await supabase
      .from("patrol_schedule")
      .upsert(updates)

    if (updateError) {
      console.error("Failed seeding patrol_schedule assignments:", updateError)
    }
  }

  seededMonthCache.add(monthKey)
}

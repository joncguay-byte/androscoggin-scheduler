import { useEffect, useMemo, useRef, useState } from "react"
import type {
  Employee,
  OvertimeShiftRequest,
  PatrolPositionCode,
  Rank,
  ScheduleView,
  ShiftType,
  Team
} from "../../types"
import { patrolPositions, scheduleViews } from "../../data/constants"
import { Select, SelectItem } from "../../components/ui/simple-ui"
import { fetchPatrolScheduleRange, invalidatePatrolScheduleCache } from "../../lib/patrol-schedule"
import { printElementById } from "../../lib/print"
import { isForceRequired, isShiftCovered } from "../../lib/staffing-engine"
import { supabase } from "../../lib/supabase"
import { ensureMonthSchedule } from "../../lib/schedule-generator"
import { pushAppToast } from "../../stores/ui-store"
import type { ReferenceSettings } from "../settings/SettingsPage"
type ScheduleRow = {
  id?: string
  assignment_date: string
  shift_type: "Days" | "Nights"
  position_code: "SUP1" | "SUP2" | "DEP1" | "DEP2" | "POL"
  employee_id: string | null
  vehicle: string | null
  shift_hours: string | null
  status: string | null
  replacement_employee_id: string | null
  replacement_vehicle: string | null
  replacement_hours: string | null
}

type EditingRow = ScheduleRow

type TeamShiftEditor = {
  assignmentDate: string
  shiftType: ShiftType
  team: Team
}

type TeamEmployeeSelection = {
  employeeId: string
  positionCode: PatrolPositionCode
  shiftType: ShiftType
  assignmentDate: string
  team: Team
}

type TimeOffDateSelection = {
  employeeId: string
  positionCode: PatrolPositionCode
  shiftType: ShiftType
  assignmentDate: string
  team: Team
  mode: "single" | "multiple"
  singleDate: string
  rangeStart: string
  rangeEnd: string
}

type TimeOffReasonSelection = TimeOffDateSelection & {
  dates: string[]
  reason: string
}

type MultiDatePickerSelection = {
  employeeId: string
  positionCode: PatrolPositionCode
  shiftType: ShiftType
  team: Team
  selectedDates: string[]
}

type OvertimeBuilderSelection = {
  employeeId: string
  selectedRowKeys: string[]
  selectedRows: ScheduleRow[]
}

type OvertimeBuilderReasonSelection = {
  employeeId: string
  selectedRowKeys: string[]
  selectedRows: ScheduleRow[]
  reason: string
}

type OvertimeBuilderLaunch = {
  employeeId: string
}

const DEFAULT_STATUS_OPTIONS = [
  "Scheduled",
  "Sick",
  "Vacation",
  "Court",
  "Training",
  "FMLA",
  "Professional Leave",
  "Bereavement",
  "Call Out",
  "Detail",
  "Extra",
  "Swap",
  "Open Shift",
  "Off"
]

const STATUS_ABBREVIATIONS: Record<string, string> = {
  Scheduled: "Sch",
  Sick: "Sick",
  Vacation: "Vac",
  Court: "Court",
  Training: "Trng",
  FMLA: "FMLA",
  "Professional Leave": "Prof",
  Bereavement: "BRVMT",
  "Call Out": "Call",
  Detail: "Det",
  Extra: "Extra",
  Swap: "Swap",
  "Open Shift": "Open",
  Off: "Off"
}

function buildVisibleDates(baseDate: Date, view: ScheduleView) {
  const startOfWeek = new Date(baseDate)
  startOfWeek.setDate(baseDate.getDate() - baseDate.getDay())
  startOfWeek.setHours(0, 0, 0, 0)

  if (view === "day") {
    return [new Date(baseDate)]
  }

  if (view === "week") {
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(startOfWeek)
      date.setDate(startOfWeek.getDate() + i)
      return date
    })
  }

  if (view === "two_week") {
    return Array.from({ length: 14 }, (_, i) => {
      const date = new Date(startOfWeek)
      date.setDate(startOfWeek.getDate() + i)
      return date
    })
  }

  const year = baseDate.getFullYear()
  const month = baseDate.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const gridStart = new Date(firstDay)
  gridStart.setDate(firstDay.getDate() - firstDay.getDay())
  const gridEnd = new Date(lastDay)
  gridEnd.setDate(lastDay.getDate() + (6 - lastDay.getDay()))

  const dates: Date[] = []

  for (
    let date = new Date(gridStart);
    date <= gridEnd;
    date.setDate(date.getDate() + 1)
  ) {
    dates.push(new Date(date))
  }

  return dates
}

function formatRange(start: Date, end: Date) {
  const a = start.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric"
  })
  const b = end.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric"
  })
  return `${a} - ${b}`
}

function getCalendarDayDiff(date: Date, anchor: Date) {
  const utcDate = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const utcAnchor = Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
  return Math.round((utcDate - utcAnchor) / 86400000)
}

function getActiveTeam(date: Date, shift: "Days" | "Nights") {
  const pitman = [0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0]
  const start = new Date("2026-03-01T12:00:00")
  const diff = getCalendarDayDiff(date, start)
  const idx = pitman[((diff % pitman.length) + pitman.length) % pitman.length]

  if (shift === "Days") return idx ? "Days A" : "Days B"
  return idx ? "Nights A" : "Nights B"
}

function isProblemStatus(status?: string | null) {
  return !!status && status !== "Scheduled"
}

function formatStatusLabel(status?: string | null) {
  if (!status) return ""
  return STATUS_ABBREVIATIONS[status] || status
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function chunkDates(dates: Date[], chunkSize: number) {
  const chunks: Date[][] = []

  for (let index = 0; index < dates.length; index += chunkSize) {
    chunks.push(dates.slice(index, index + chunkSize))
  }

  return chunks
}

function buildInclusiveDateRange(startIso: string, endIso: string) {
  if (!startIso || !endIso) return []

  const start = new Date(`${startIso}T12:00:00`)
  const end = new Date(`${endIso}T12:00:00`)
  const dates: string[] = []

  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    dates.push(toIsoDate(cursor))
  }

  return dates
}

function buildPatrolOvertimeRequestId(assignmentDate: string, shiftType: ShiftType, positionCode: PatrolPositionCode) {
  return `patrol-open-${assignmentDate}-${shiftType}-${positionCode}`
}

function positionLabelFromCode(positionCode: PatrolPositionCode) {
  return patrolPositions.find((position) => position.code === positionCode)?.label || positionCode
}

function getScheduleRowKey(row: Pick<ScheduleRow, "assignment_date" | "shift_type" | "position_code">) {
  return `${row.assignment_date}-${row.shift_type}-${row.position_code}`
}

function toPatrolOverridePayload(row: ScheduleRow) {
  return {
    assignment_date: row.assignment_date,
    shift_type: row.shift_type,
    position_code: row.position_code,
    employee_id: row.employee_id,
    vehicle: row.vehicle,
    shift_hours: row.shift_hours,
    status: row.status,
    replacement_employee_id: row.replacement_employee_id,
    replacement_vehicle: row.replacement_vehicle,
    replacement_hours: row.replacement_hours,
    updated_at: new Date().toISOString()
  }
}

function buildPatrolRequestPayload(row: ScheduleRow, employee: Employee | null): OvertimeShiftRequest {
  return {
    id: buildPatrolOvertimeRequestId(row.assignment_date, row.shift_type, row.position_code),
    source: "Patrol Open Shift",
    assignmentDate: row.assignment_date,
    shiftType: row.shift_type,
    positionCode: row.position_code,
    description: `${positionLabelFromCode(row.position_code)} time off`,
    offEmployeeId: employee?.id || row.employee_id || null,
    offEmployeeLastName: employee?.lastName || null,
    offHours: row.shift_hours || employee?.defaultShiftHours || null,
    offReason: row.status || "Off",
    assignedHours: row.replacement_hours || null,
    selectionActive: true,
    workflowStatus: "Open",
    status: row.replacement_employee_id ? "Assigned" : "Open",
    assignedEmployeeId: row.replacement_employee_id || null,
    createdAt: new Date().toISOString(),
    responses: []
  }
}

function mergeScheduleRows(baseRows: ScheduleRow[], overrideRows: ScheduleRow[]) {
  const merged = new Map<string, ScheduleRow>()

  for (const row of baseRows) {
    merged.set(getScheduleRowKey(row), row)
  }

  for (const row of overrideRows) {
    merged.set(getScheduleRowKey(row), row)
  }

  return [...merged.values()].sort((a, b) => {
    if (a.assignment_date !== b.assignment_date) return a.assignment_date.localeCompare(b.assignment_date)
    if (a.shift_type !== b.shift_type) return a.shift_type.localeCompare(b.shift_type)
    return a.position_code.localeCompare(b.position_code)
  })
}

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)

    Promise.resolve(promise)
      .then((value) => {
        window.clearTimeout(timer)
        resolve(value)
      })
      .catch((error: unknown) => {
        window.clearTimeout(timer)
        reject(error)
      })
  })
}

function getDefaultEmployeeForPosition(
  employees: Employee[],
  team: Team,
  positionCode: PatrolPositionCode
) {
  const teamEmployees = employees.filter(
    (employee) => employee.status === "Active" && employee.team === team
  )

  const firstByRank = (rank: Rank) =>
    teamEmployees.find((employee) => employee.rank === rank) || null

  switch (positionCode) {
    case "SUP1":
      return firstByRank("Sgt")
    case "SUP2":
      return firstByRank("Cpl")
    case "DEP1":
      return teamEmployees.filter((employee) => employee.rank === "Deputy")[0] || null
    case "DEP2":
      return teamEmployees.filter((employee) => employee.rank === "Deputy")[1] || null
    case "POL":
      return firstByRank("Poland Deputy")
    default:
      return null
  }
}

function buildDefaultAssignmentRow(
  employees: Employee[],
  date: Date,
  positionCode: PatrolPositionCode,
  shiftType: ShiftType,
  existingRow?: ScheduleRow | null
): ScheduleRow | null {
  const activeTeam = getActiveTeam(date, shiftType)
  const defaultEmployee = getDefaultEmployeeForPosition(employees, activeTeam, positionCode)

  if (!defaultEmployee) {
    return existingRow || null
  }

  return {
    id: existingRow?.id,
    assignment_date: toIsoDate(date),
    shift_type: shiftType,
    position_code: positionCode,
    employee_id: defaultEmployee.id,
    vehicle: existingRow?.vehicle || defaultEmployee.defaultVehicle,
    shift_hours: existingRow?.shift_hours || defaultEmployee.defaultShiftHours,
    status:
      existingRow?.status && existingRow.status !== "Open Shift"
        ? existingRow.status
        : "Scheduled",
    replacement_employee_id: existingRow?.replacement_employee_id || null,
    replacement_vehicle: existingRow?.replacement_vehicle || null,
    replacement_hours:
      existingRow?.replacement_hours || defaultEmployee.defaultShiftHours
  }
}

export function PatrolPage({
  employees,
  canEdit,
  defaultView = "month",
  referenceSettings,
  patrolOverrideRows,
  setPatrolOverrideRows,
  overtimeShiftRequests,
  setOvertimeShiftRequests,
  colorSettings,
  overtimeBuilderLaunch,
  onConsumeOvertimeBuilderLaunch,
  onCompleteOvertimeBuilderSave,
  onAuditEvent
}: {
  employees: Employee[]
  canEdit?: boolean
  defaultView?: ScheduleView
  referenceSettings: ReferenceSettings
  patrolOverrideRows: ScheduleRow[]
  setPatrolOverrideRows: React.Dispatch<React.SetStateAction<ScheduleRow[]>>
  overtimeShiftRequests: OvertimeShiftRequest[]
  setOvertimeShiftRequests: React.Dispatch<React.SetStateAction<OvertimeShiftRequest[]>>
  colorSettings?: {
    accent: string
    border: string
    cardBackground: string
    cardBorder: string
    cellBackground: string
    cellHighlight: string
  }
  overtimeBuilderLaunch?: OvertimeBuilderLaunch | null
  onConsumeOvertimeBuilderLaunch?: () => void
  onCompleteOvertimeBuilderSave?: () => void
  onAuditEvent?: (action: string, summary: string, details?: string) => void
}) {
  const today = new Date()

  const [baseDate, setBaseDate] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1)
  )
  const [view, setView] = useState<ScheduleView>(defaultView)
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([])
  const [editingRow, setEditingRow] = useState<EditingRow | null>(null)
  const [teamEditor, setTeamEditor] = useState<TeamShiftEditor | null>(null)
  const [teamEmployeeSelection, setTeamEmployeeSelection] = useState<TeamEmployeeSelection | null>(null)
  const [timeOffDateSelection, setTimeOffDateSelection] = useState<TimeOffDateSelection | null>(null)
  const [timeOffReasonSelection, setTimeOffReasonSelection] = useState<TimeOffReasonSelection | null>(null)
  const [multiDatePickerSelection, setMultiDatePickerSelection] = useState<MultiDatePickerSelection | null>(null)
  const [overtimeBuilderSelection, setOvertimeBuilderSelection] = useState<OvertimeBuilderSelection | null>(null)
  const [overtimeBuilderReasonSelection, setOvertimeBuilderReasonSelection] = useState<OvertimeBuilderReasonSelection | null>(null)
  const [saving, setSaving] = useState(false)
  const scheduleRefreshTimeoutRef = useRef<number | null>(null)
  const weekSectionRefs = useRef<Array<HTMLDivElement | null>>([])

  const dates = useMemo(() => buildVisibleDates(baseDate, view), [baseDate, view])
  const statusOptions = useMemo(() => {
    const configured = referenceSettings.patrolStatuses
      .map((status) => status.trim())
      .filter(Boolean)
    return configured.length > 0 ? configured : DEFAULT_STATUS_OPTIONS
  }, [referenceSettings.patrolStatuses])
  const nonScheduledStatusOptions = useMemo(
    () => statusOptions.filter((status) => status !== "Scheduled" && status !== "Open Shift"),
    [statusOptions]
  )
  const effectiveScheduleRows = useMemo(
    () => mergeScheduleRows(scheduleRows, patrolOverrideRows),
    [patrolOverrideRows, scheduleRows]
  )
  const patrolTimeOffRequests = useMemo(
    () =>
      overtimeShiftRequests.filter(
        (request) => request.status !== "Closed"
      ),
    [overtimeShiftRequests]
  )
  const employeeMap = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee])),
    [employees]
  )
  const months = Array.from({ length: 12 }, (_, index) =>
    new Date(today.getFullYear(), index, 1).toLocaleDateString(undefined, { month: "long" })
  )
  const years = Array.from({ length: 9 }, (_, index) => today.getFullYear() - 4 + index)

  useEffect(() => {
    setView(defaultView)
  }, [defaultView])

  useEffect(() => {
    if (!overtimeBuilderLaunch) return

    const today = new Date()
    setView("month")
    setBaseDate(new Date(today.getFullYear(), today.getMonth(), 1))
    setTeamEditor(null)
    setTeamEmployeeSelection(null)
    setTimeOffDateSelection(null)
    setTimeOffReasonSelection(null)
    setMultiDatePickerSelection(null)
    setOvertimeBuilderReasonSelection(null)
    setOvertimeBuilderSelection({
      employeeId: overtimeBuilderLaunch.employeeId,
      selectedRowKeys: [],
      selectedRows: []
    })
    onConsumeOvertimeBuilderLaunch?.()
  }, [onConsumeOvertimeBuilderLaunch, overtimeBuilderLaunch])

  useEffect(() => {
    let active = true

    async function loadSchedule() {
      if (dates.length === 0) return

      const rangeStart = dates[0]
      const rangeEnd = dates[dates.length - 1]
      const startMonth = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1)
      const endMonth = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1)

      for (
        let monthCursor = new Date(startMonth);
        monthCursor <= endMonth;
        monthCursor.setMonth(monthCursor.getMonth() + 1)
      ) {
        await ensureMonthSchedule(new Date(monthCursor))
      }

      const visibleStart = toIsoDate(rangeStart)
      const visibleEnd = toIsoDate(rangeEnd)

      const { data, error } = await fetchPatrolScheduleRange(visibleStart, visibleEnd)

      if (error) {
        console.error("Failed to load patrol_schedule:", error)
        if (active) {
          setScheduleRows([])
        }
        return
      }

      if (active) {
        setScheduleRows((data || []) as ScheduleRow[])
      }
    }

    function scheduleScheduleRefresh() {
      if (scheduleRefreshTimeoutRef.current) {
        window.clearTimeout(scheduleRefreshTimeoutRef.current)
      }

      scheduleRefreshTimeoutRef.current = window.setTimeout(() => {
        void loadSchedule()
      }, 350)
    }

    void loadSchedule()

    const channel = supabase
      .channel("patrol_schedule_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "patrol_schedule"
        },
        () => {
          invalidatePatrolScheduleCache()
          scheduleScheduleRefresh()
        }
      )
      .subscribe()

    return () => {
      active = false
      if (scheduleRefreshTimeoutRef.current) {
        window.clearTimeout(scheduleRefreshTimeoutRef.current)
      }
      supabase.removeChannel(channel)
    }
  }, [baseDate, dates])

  function prevMonth() {
    const date = new Date(baseDate)
    date.setMonth(date.getMonth() - 1)
    setBaseDate(new Date(date.getFullYear(), date.getMonth(), 1))
  }

  function nextMonth() {
    const date = new Date(baseDate)
    date.setMonth(date.getMonth() + 1)
    setBaseDate(new Date(date.getFullYear(), date.getMonth(), 1))
  }

  function goToday() {
    setBaseDate(new Date(today.getFullYear(), today.getMonth(), 1))
  }

  function setMonth(monthIndex: number) {
    setBaseDate((current) => new Date(current.getFullYear(), monthIndex, 1))
  }

  function setYear(year: number) {
    setBaseDate((current) => new Date(year, current.getMonth(), 1))
  }

  function setAnchorDate(dateValue: string) {
    if (!dateValue) return

    const nextDate = new Date(`${dateValue}T12:00:00`)

    if (view === "month") {
      setBaseDate(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1))
      return
    }

    setBaseDate(nextDate)
  }

  function cellFor(
    date: Date,
    positionCode: ScheduleRow["position_code"],
    shiftType: ScheduleRow["shift_type"]
  ) {
    const iso = toIsoDate(date)
    const existingRow =
      effectiveScheduleRows.find(
        (r) =>
          r.assignment_date === iso &&
          r.position_code === positionCode &&
          r.shift_type === shiftType
      ) || null

    const shouldSeedFromEmployees =
      !existingRow ||
      (!existingRow.employee_id &&
        !existingRow.replacement_employee_id &&
        (existingRow.status === "Open Shift" || !existingRow.status))

    const baseRow = shouldSeedFromEmployees
      ? buildDefaultAssignmentRow(
          employees,
          date,
          positionCode,
          shiftType,
          existingRow
        )
      : existingRow

    if (!baseRow) {
      return null
    }

    const matchingEmployeeTimeOffRequest = patrolTimeOffRequests.find(
      (request) =>
        request.assignmentDate === iso &&
        request.shiftType === shiftType &&
        (
          request.offEmployeeId === baseRow.employee_id ||
          request.offEmployeeLastName === employees.find((candidate) => candidate.id === baseRow.employee_id)?.lastName ||
          request.positionCode === positionCode
        )
    )

    if (matchingEmployeeTimeOffRequest && !isProblemStatus(baseRow.status)) {
      return {
        ...baseRow,
        status: matchingEmployeeTimeOffRequest.offReason || "Off"
      }
    }

    if (shouldSeedFromEmployees) {
      return baseRow
    }

    return existingRow
  }

  function buildEmptyRow(
    date: Date,
    positionCode: ScheduleRow["position_code"],
    shiftType: ScheduleRow["shift_type"]
  ): EditingRow {
    return {
      assignment_date: toIsoDate(date),
      shift_type: shiftType,
      position_code: positionCode,
      employee_id: null,
      vehicle: null,
      shift_hours: shiftType === "Days" ? "5a-5p" : "5p-5a",
      status: "Open Shift",
      replacement_employee_id: null,
      replacement_vehicle: null,
      replacement_hours: shiftType === "Days" ? "5a-5p" : "5p-5a"
    }
  }

  function openEditor(
    date: Date,
    positionCode: ScheduleRow["position_code"],
    shiftType: ScheduleRow["shift_type"]
  ) {
    if (!canEdit) return

    const existing = cellFor(date, positionCode, shiftType)

    if (existing) {
      setEditingRow({ ...existing })
    } else {
      setEditingRow(buildEmptyRow(date, positionCode, shiftType))
    }
  }

  function openTeamEditor(date: Date, shiftType: ShiftType) {
    if (!canEdit) return

    setTeamEditor({
      assignmentDate: toIsoDate(date),
      shiftType,
      team: getActiveTeam(date, shiftType)
    })
  }

  function updateEditingRow<K extends keyof EditingRow>(key: K, value: EditingRow[K]) {
    if (!editingRow) return
    setEditingRow({
      ...editingRow,
      [key]: value
    })
  }

  function handleEmployeeChange(employeeId: string) {
    if (!editingRow) return

    if (!employeeId) {
      setEditingRow({
        ...editingRow,
        employee_id: null,
        vehicle: null
      })
      return
    }

    const employee = employees.find((e) => e.id === employeeId)

    setEditingRow({
      ...editingRow,
      employee_id: employeeId,
      vehicle: employee?.defaultVehicle || editingRow.vehicle,
      shift_hours: employee?.defaultShiftHours || editingRow.shift_hours
    })
  }

  function handleReplacementChange(employeeId: string) {
    if (!editingRow) return

    if (!employeeId) {
      setEditingRow({
        ...editingRow,
        replacement_employee_id: null,
        replacement_vehicle: null
      })
      return
    }

    const employee = employees.find((e) => e.id === employeeId)

    setEditingRow({
      ...editingRow,
      replacement_employee_id: employeeId,
      replacement_vehicle: employee?.defaultVehicle || editingRow.replacement_vehicle,
      replacement_hours: editingRow.shift_hours || employee?.defaultShiftHours || editingRow.replacement_hours
    })
  }

  async function saveEditingRow() {
    if (!editingRow) return
    const row = editingRow

    setSaving(true)

    const basePayload = {
      assignment_date: row.assignment_date,
      shift_type: row.shift_type,
      position_code: row.position_code,
      employee_id: row.employee_id,
      vehicle: row.vehicle,
      shift_hours: row.shift_hours,
      status: row.status,
      replacement_employee_id: row.replacement_employee_id,
      replacement_vehicle: row.replacement_vehicle,
      replacement_hours: row.replacement_hours
    }
    type SaveResult = { error: { message: string } | null }
    async function runSaveAttempt(): Promise<SaveResult> {
      if (row.id) {
        return withTimeout(
          supabase
            .from("patrol_schedule")
            .update(basePayload)
            .eq("id", row.id),
          8000,
          "Request timeout"
        ) as Promise<SaveResult>
      }

      const existingResult = await withTimeout(
        supabase
          .from("patrol_schedule")
          .select("id")
          .eq("assignment_date", row.assignment_date)
          .eq("shift_type", row.shift_type)
          .eq("position_code", row.position_code)
          .order("id", { ascending: true }),
        8000,
        "Request timeout"
      ) as { data: Array<{ id: string }> | null; error: { message: string } | null }

      if (existingResult.error) {
        return { error: existingResult.error }
      }

      if (existingResult.data && existingResult.data.length > 0) {
        return withTimeout(
          supabase
            .from("patrol_schedule")
            .update(basePayload)
            .eq("assignment_date", row.assignment_date)
            .eq("shift_type", row.shift_type)
            .eq("position_code", row.position_code),
          8000,
          "Request timeout"
        ) as Promise<SaveResult>
      }

      return withTimeout(
        supabase
          .from("patrol_schedule")
          .insert(basePayload),
        8000,
        "Request timeout"
      ) as Promise<SaveResult>
    }

    async function verifySavedRow() {
      const { data, error } = await withTimeout(
        supabase
          .from("patrol_schedule")
          .select("replacement_employee_id,replacement_vehicle,replacement_hours,employee_id,status")
          .eq("assignment_date", row.assignment_date)
          .eq("shift_type", row.shift_type)
          .eq("position_code", row.position_code)
          .order("id", { ascending: true }),
        4000,
        "Verify timeout"
      ) as {
        data: Array<{
          replacement_employee_id: string | null
          replacement_vehicle: string | null
          replacement_hours: string | null
          employee_id: string | null
          status: string | null
        }> | null
        error: { message: string } | null
      }

      if (error || !data || data.length === 0) return false

      return data.some((savedRow) => (
        savedRow.employee_id === row.employee_id &&
        savedRow.status === row.status &&
        savedRow.replacement_employee_id === row.replacement_employee_id &&
        savedRow.replacement_vehicle === row.replacement_vehicle &&
        savedRow.replacement_hours === row.replacement_hours
      ))
    }

    let error = null

    for (let attempt = 0; attempt < 3; attempt += 1) {
      let result: SaveResult

      try {
        result = await runSaveAttempt()
      } catch (requestError) {
        error = requestError instanceof Error ? requestError : new Error("Request failed")
        continue
      }

      if (!result.error) {
        error = null
        break
      }

      error = result.error

      if (!error.message.toLowerCase().includes("timeout")) {
        break
      }

      let didPersist = false

      try {
        didPersist = await verifySavedRow()
      } catch {
        didPersist = false
      }
      if (didPersist) {
        error = null
        break
      }
    }

    const localRow: ScheduleRow = {
      id: row.id,
      ...basePayload
    }
    const employee = employees.find((employeeRow) => employeeRow.id === row.employee_id) || null
    const replacement = employees.find((employeeRow) => employeeRow.id === row.replacement_employee_id) || null
    const shouldCreateOvertimeRequest =
      isProblemStatus(localRow.status) || localRow.status === "Open Shift" || !!localRow.replacement_employee_id
    const nextRequest = shouldCreateOvertimeRequest
      ? buildPatrolRequestPayload(localRow, employee)
      : null

    function applyLocalSync() {
      setPatrolOverrideRows((current) => mergeScheduleRows(current, [localRow]))
      setScheduleRows((current) => mergeScheduleRows(current, [localRow]))
      setOvertimeShiftRequests((current) => {
        const withoutCurrent = current.filter(
          (request) => request.id !== buildPatrolOvertimeRequestId(localRow.assignment_date, localRow.shift_type, localRow.position_code)
        )
        return nextRequest ? [...withoutCurrent, nextRequest] : withoutCurrent
      })
    }

    if (error) {
      const message = error.message.toLowerCase()
      const isNetworkError =
        message.includes("timeout") ||
        message.includes("failed to fetch") ||
        message.includes("fetch")

      if (isNetworkError) {
        applyLocalSync()
        onAuditEvent?.(
          "Patrol Shift Saved",
          `Saved patrol shift locally for ${row.assignment_date} ${row.shift_type} ${row.position_code}.`,
          `${employee ? `${employee.firstName} ${employee.lastName}` : "Open"} | Status: ${row.status || "Scheduled"}${replacement ? ` | Replacement: ${replacement.firstName} ${replacement.lastName}` : ""}`
        )
        setSaving(false)
        setEditingRow(null)
        pushAppToast({
          tone: "warning",
          title: "Shift saved locally",
          message: "Supabase did not respond, but the shift remains visible in the scheduler."
        })
        return
      }

      console.error("Failed to save patrol row:", error)
      pushAppToast({
        tone: "error",
        title: "Patrol shift save failed",
        message: error.message
      })
      setSaving(false)
      return
    }

    invalidatePatrolScheduleCache()
    applyLocalSync()
    onAuditEvent?.(
      "Patrol Shift Saved",
      `Saved patrol shift for ${row.assignment_date} ${row.shift_type} ${row.position_code}.`,
      `${employee ? `${employee.firstName} ${employee.lastName}` : "Open"} | Status: ${row.status || "Scheduled"}${replacement ? ` | Replacement: ${replacement.firstName} ${replacement.lastName}` : ""}`
    )
    setSaving(false)
    setEditingRow(null)

    void Promise.all([
      supabase
        .from("patrol_overrides")
        .upsert([toPatrolOverridePayload(localRow)], { onConflict: "assignment_date,shift_type,position_code" }),
      nextRequest
        ? supabase
            .from("overtime_shift_requests")
            .upsert([
              {
                id: nextRequest.id,
                source: nextRequest.source,
                batch_id: null,
                batch_name: null,
                assignment_date: nextRequest.assignmentDate,
                shift_type: nextRequest.shiftType,
                position_code: nextRequest.positionCode,
                description: nextRequest.description,
                off_employee_id: nextRequest.offEmployeeId || null,
                off_employee_last_name: nextRequest.offEmployeeLastName || null,
                off_hours: nextRequest.offHours || null,
                off_reason: nextRequest.offReason || null,
                assigned_hours: nextRequest.assignedHours || null,
                selection_active: nextRequest.selectionActive ?? true,
                workflow_status: nextRequest.workflowStatus || "Open",
                status: nextRequest.status,
                assigned_employee_id: nextRequest.assignedEmployeeId || null,
                created_at: nextRequest.createdAt,
                responses: nextRequest.responses
              }
            ], { onConflict: "id" })
        : supabase
            .from("overtime_shift_requests")
            .delete()
            .eq("id", buildPatrolOvertimeRequestId(localRow.assignment_date, localRow.shift_type, localRow.position_code))
    ]).catch((syncError) => {
      console.error("Failed to sync manual patrol edit to overrides/overtime:", syncError)
      window.setTimeout(() => {
        pushAppToast({
          tone: "warning",
          title: "Patrol shift saved",
          message: "The overtime sync was delayed. Refresh in a moment if needed."
        })
      }, 0)
    })
  }

  function buildWorkingShiftRows(editor: TeamShiftEditor) {
    const editorDate = new Date(`${editor.assignmentDate}T12:00:00`)

    return patrolPositions
      .map((position) => {
        const row = cellFor(editorDate, position.code, editor.shiftType)
        if (!row || !row.employee_id) return null

        const employee = employees.find((candidate) => candidate.id === row.employee_id)
        if (!employee) return null

        return {
          row,
          employee,
          positionLabel: position.label
        }
      })
      .filter((entry): entry is { row: ScheduleRow; employee: Employee; positionLabel: string } => Boolean(entry))
  }

  function buildDatesFromSelection(selection: TimeOffDateSelection) {
    if (selection.mode === "single") {
      return selection.singleDate ? [selection.singleDate] : []
    }

    return buildInclusiveDateRange(selection.rangeStart, selection.rangeEnd)
  }

  function toggleMultiDatePick(assignmentDate: string) {
    if (!multiDatePickerSelection) return

    setMultiDatePickerSelection((current) => {
      if (!current) return current

      const exists = current.selectedDates.includes(assignmentDate)

      return {
        ...current,
        selectedDates: exists
          ? current.selectedDates.filter((date) => date !== assignmentDate)
          : [...current.selectedDates, assignmentDate].sort((a, b) => a.localeCompare(b))
      }
    })
  }

  function toggleOvertimeBuilderRow(row: ScheduleRow) {
    setOvertimeBuilderSelection((current) => {
      if (!current) return current

      const rowKey = getScheduleRowKey(row)
      const exists = current.selectedRowKeys.includes(rowKey)

      return {
        ...current,
        selectedRowKeys: exists
          ? current.selectedRowKeys.filter((key) => key !== rowKey)
          : [...current.selectedRowKeys, rowKey],
        selectedRows: exists
          ? current.selectedRows.filter((entry) => getScheduleRowKey(entry) !== rowKey)
          : [...current.selectedRows.filter((entry) => getScheduleRowKey(entry) !== rowKey), row]
      }
    })
  }

  async function saveTeamTimeOffSelection() {
    if (!timeOffReasonSelection) return

    const employee = employees.find((candidate) => candidate.id === timeOffReasonSelection.employeeId)
    if (!employee) return

    const validDates =
      timeOffReasonSelection.mode === "multiple"
        ? [...timeOffReasonSelection.dates].sort((a, b) => a.localeCompare(b))
        : timeOffReasonSelection.dates.filter((isoDate) => {
            const targetDate = new Date(`${isoDate}T12:00:00`)
            return getActiveTeam(targetDate, timeOffReasonSelection.shiftType) === employee.team
          })

    if (validDates.length === 0) {
      pushAppToast({
        tone: "warning",
        title: "No scheduled dates found",
        message: "No scheduled dates for that employee were included in the selected range."
      })
      return
    }

    setSaving(true)

    const rowsToApply: ScheduleRow[] = []
    const nextRequests: OvertimeShiftRequest[] = []

    for (const isoDate of validDates) {
      const targetDate = new Date(`${isoDate}T12:00:00`)
      const existingRow =
        effectiveScheduleRows.find((candidate) =>
          candidate.assignment_date === isoDate &&
          candidate.shift_type === timeOffReasonSelection.shiftType &&
          candidate.position_code === timeOffReasonSelection.positionCode &&
          candidate.employee_id === timeOffReasonSelection.employeeId
        ) ||
        buildDefaultAssignmentRow(
          employees,
          targetDate,
          timeOffReasonSelection.positionCode,
          timeOffReasonSelection.shiftType
        )

      if (!existingRow) continue

      rowsToApply.push({
        ...existingRow,
        assignment_date: isoDate,
        shift_type: timeOffReasonSelection.shiftType,
        position_code: timeOffReasonSelection.positionCode,
        employee_id: timeOffReasonSelection.employeeId,
        vehicle: employee.defaultVehicle || existingRow.vehicle,
        shift_hours: employee.defaultShiftHours || existingRow.shift_hours,
        status: timeOffReasonSelection.reason,
        replacement_employee_id: null,
        replacement_vehicle: null,
        replacement_hours: existingRow.shift_hours || employee.defaultShiftHours
      })

      nextRequests.push({
        id: buildPatrolOvertimeRequestId(
          isoDate,
          timeOffReasonSelection.shiftType,
          timeOffReasonSelection.positionCode
        ),
        source: "Patrol Open Shift",
        assignmentDate: isoDate,
        shiftType: timeOffReasonSelection.shiftType,
        positionCode: timeOffReasonSelection.positionCode,
        description: `${positionLabelFromCode(timeOffReasonSelection.positionCode)} time off`,
        offEmployeeId: employee.id,
        offEmployeeLastName: employee.lastName,
        offHours: employee.defaultShiftHours,
        offReason: timeOffReasonSelection.reason,
        selectionActive: true,
        workflowStatus: "Open",
        status: "Open",
        assignedEmployeeId: null,
        createdAt: new Date().toISOString(),
        responses: []
      })
    }

    if (rowsToApply.length === 0) {
      setSaving(false)
      return
    }

    setPatrolOverrideRows((current) => mergeScheduleRows(current, rowsToApply))
    setScheduleRows((current) => mergeScheduleRows(current, rowsToApply))
    setOvertimeShiftRequests((current) => {
      const next = [...current]

      for (const request of nextRequests) {
        const requestIndex = next.findIndex((entry) => entry.id === request.id)
        if (requestIndex >= 0) {
          next[requestIndex] = {
            ...next[requestIndex],
            ...request,
            createdAt: next[requestIndex].createdAt || request.createdAt,
            responses: next[requestIndex].responses || []
          }
        } else {
          next.push(request)
        }
      }

      return next
    })

    invalidatePatrolScheduleCache()
    setSaving(false)
    setTimeOffReasonSelection(null)
    setTimeOffDateSelection(null)
    setTeamEmployeeSelection(null)
    setTeamEditor(null)

    onAuditEvent?.(
      "Patrol Team Time Off Saved",
      `Saved ${timeOffReasonSelection.reason} for ${employee.firstName} ${employee.lastName}.`,
      `${validDates.join(", ")} | ${timeOffReasonSelection.shiftType} ${positionLabelFromCode(timeOffReasonSelection.positionCode)}`
    )

    const firstSavedDate = validDates[0]
    if (firstSavedDate) {
      const firstSavedDateObject = new Date(`${firstSavedDate}T12:00:00`)
      setBaseDate(new Date(firstSavedDateObject.getFullYear(), firstSavedDateObject.getMonth(), 1))
    }

    void Promise.all([
      supabase
        .from("patrol_overrides")
        .upsert(
          rowsToApply.map((row) => toPatrolOverridePayload(row)),
          { onConflict: "assignment_date,shift_type,position_code" }
        ),
      supabase
        .from("overtime_shift_requests")
        .upsert(
          nextRequests.map((request) => ({
            id: request.id,
            source: request.source,
            batch_id: null,
            batch_name: null,
            assignment_date: request.assignmentDate,
            shift_type: request.shiftType,
            position_code: request.positionCode,
            description: request.description,
            off_employee_id: request.offEmployeeId || null,
            off_employee_last_name: request.offEmployeeLastName || null,
            off_hours: request.offHours || null,
            selection_active: true,
            workflow_status: "Open",
            status: "Open",
            assigned_employee_id: null,
            created_at: request.createdAt,
            responses: request.responses
          })),
          { onConflict: "id" }
        )
    ]).catch((error) => {
      console.error("Failed to batch save patrol time off selection:", error)
      window.setTimeout(() => {
        pushAppToast({
          tone: "warning",
          title: "Time off saved locally",
          message: "The cloud update was delayed. Refresh in a moment if needed."
        })
      }, 0)
    })
  }

  async function saveOvertimeBuilderSelection() {
    if (!overtimeBuilderReasonSelection) return

    const employee = employeeMap.get(overtimeBuilderReasonSelection.employeeId)
    if (!employee) return

    const selectedRows =
      overtimeBuilderReasonSelection.selectedRows.length > 0
        ? overtimeBuilderReasonSelection.selectedRows
        : effectiveScheduleRows.filter(
            (row) =>
              overtimeBuilderReasonSelection.selectedRowKeys.includes(getScheduleRowKey(row)) &&
              row.employee_id === overtimeBuilderReasonSelection.employeeId
          )

    if (selectedRows.length === 0) {
      setSaving(false)
      window.setTimeout(() => {
        pushAppToast({
          tone: "error",
          title: "Selected patrol shifts could not be resolved",
          message: "Please reselect the boxes and try again."
        })
      }, 0)
      return
    }

    setSaving(true)

    const rowsToApply: ScheduleRow[] = selectedRows.map((row) => ({
      ...row,
      vehicle: employee.defaultVehicle || row.vehicle,
      shift_hours: employee.defaultShiftHours || row.shift_hours,
      status: overtimeBuilderReasonSelection.reason,
      replacement_employee_id: null,
      replacement_vehicle: null,
      replacement_hours: row.shift_hours || employee.defaultShiftHours
    }))

    const nextRequests: OvertimeShiftRequest[] = rowsToApply.map((row) => ({
      id: buildPatrolOvertimeRequestId(row.assignment_date, row.shift_type, row.position_code),
      source: "Patrol Open Shift",
      assignmentDate: row.assignment_date,
      shiftType: row.shift_type,
      positionCode: row.position_code,
      description: `${positionLabelFromCode(row.position_code)} time off`,
      offEmployeeId: employee.id,
      offEmployeeLastName: employee.lastName,
      offHours: row.shift_hours || employee.defaultShiftHours,
      offReason: overtimeBuilderReasonSelection.reason,
      selectionActive: true,
      workflowStatus: "Open",
      status: "Open",
      assignedEmployeeId: null,
      createdAt: new Date().toISOString(),
      responses: []
    }))

    setPatrolOverrideRows((current) => mergeScheduleRows(current, rowsToApply))
    setScheduleRows((current) => mergeScheduleRows(current, rowsToApply))
    setOvertimeShiftRequests((current) => {
      const next = [...current]

      for (const request of nextRequests) {
        const requestIndex = next.findIndex((entry) => entry.id === request.id)
        if (requestIndex >= 0) {
          next[requestIndex] = {
            ...next[requestIndex],
            ...request,
            createdAt: next[requestIndex].createdAt || request.createdAt,
            responses: next[requestIndex].responses || []
          }
        } else {
          next.push(request)
        }
      }

      return next
    })

    invalidatePatrolScheduleCache()
    setSaving(false)
    setOvertimeBuilderReasonSelection(null)
    setOvertimeBuilderSelection(null)
    const firstSavedDate = rowsToApply[0]?.assignment_date
    if (firstSavedDate) {
      const firstSavedDateObject = new Date(`${firstSavedDate}T12:00:00`)
      setBaseDate(new Date(firstSavedDateObject.getFullYear(), firstSavedDateObject.getMonth(), 1))
    }

    onAuditEvent?.(
      "Overtime Builder Time Off Saved",
      `Saved ${overtimeBuilderReasonSelection.reason} for ${employee.firstName} ${employee.lastName}.`,
      rowsToApply.map((row) => `${row.assignment_date} ${row.shift_type} ${positionLabelFromCode(row.position_code)}`).join(" | ")
    )
    onCompleteOvertimeBuilderSave?.()

    void Promise.all([
      supabase
        .from("patrol_overrides")
        .upsert(
          rowsToApply.map((row) => toPatrolOverridePayload(row)),
          { onConflict: "assignment_date,shift_type,position_code" }
        ),
      supabase
        .from("overtime_shift_requests")
        .upsert(
          nextRequests.map((request) => ({
            id: request.id,
            source: request.source,
            batch_id: null,
            batch_name: null,
            assignment_date: request.assignmentDate,
            shift_type: request.shiftType,
            position_code: request.positionCode,
            description: request.description,
            off_employee_id: request.offEmployeeId || null,
            off_employee_last_name: request.offEmployeeLastName || null,
            off_hours: request.offHours || null,
            off_reason: request.offReason || null,
            selection_active: true,
            workflow_status: "Open",
            status: "Open",
            assigned_employee_id: null,
            created_at: request.createdAt,
            responses: request.responses
          })),
          { onConflict: "id" }
        )
    ]).catch((error) => {
      console.error("Failed to batch save overtime builder selection:", error)
      window.setTimeout(() => {
        pushAppToast({
          tone: "warning",
          title: "Time off saved locally",
          message: "The cloud update was delayed. Refresh in a moment if needed."
        })
      }, 0)
    })
  }

  async function deleteEditingRow() {
    if (!editingRow?.id) {
      setEditingRow(null)
      return
    }

    setSaving(true)
    const rowToDelete = editingRow

    const { error } = await supabase
      .from("patrol_schedule")
      .delete()
      .eq("id", rowToDelete.id)

    if (error) {
      console.error("Failed to delete patrol row:", error)
      pushAppToast({
        tone: "error",
        title: "Patrol shift delete failed",
        message: "Failed to delete shift."
      })
      setSaving(false)
      return
    }

    invalidatePatrolScheduleCache()
    onAuditEvent?.(
      "Patrol Shift Deleted",
      `Deleted patrol shift for ${rowToDelete.assignment_date} ${rowToDelete.shift_type} ${rowToDelete.position_code}.`
    )
    setSaving(false)
    setEditingRow(null)
  }

  function renderShiftCell(
    date: Date,
    positionCode: ScheduleRow["position_code"],
    shiftType: ScheduleRow["shift_type"],
    compact = false
  ) {
    const row = cellFor(date, positionCode, shiftType)

    if (!row) {
      return (
        <div
          onClick={() => openEditor(date, positionCode, shiftType)}
          style={{
            minHeight: compact ? "50px" : "84px",
            padding: compact ? "5px" : "10px",
            border: `1px solid ${colorSettings?.cardBorder || colorSettings?.border || "#e5e7eb"}`,
            borderRadius: "6px",
            background: colorSettings?.cellBackground || "#ffffff",
            fontSize: compact ? "11px" : "13px",
            cursor: canEdit ? "pointer" : "default",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "0"
          }}
        >
          <div style={{ fontWeight: 700, fontSize: compact ? "12px" : "13px", lineHeight: 1 }}>
            OPEN
          </div>
        </div>
      )
    }

    const employee = employees.find((e) => e.id === row.employee_id)
    const matchingPatrolTimeOffRequest = patrolTimeOffRequests.find(
      (request) =>
        request.assignmentDate === row.assignment_date &&
        request.shiftType === row.shift_type &&
        (
          request.offEmployeeId === row.employee_id ||
          request.offEmployeeLastName === employee?.lastName ||
          request.positionCode === row.position_code
        ) &&
        request.status !== "Closed"
    )
    const replacementEmployeeId =
      row.replacement_employee_id ||
      matchingPatrolTimeOffRequest?.assignedEmployeeId ||
      null
    const replacement = replacementEmployeeId
      ? employees.find((e) => e.id === replacementEmployeeId) || null
      : null
    const replacementVehicle =
      row.replacement_vehicle ||
      replacement?.defaultVehicle ||
      ""
    const replacementHours =
      row.replacement_hours ||
      matchingPatrolTimeOffRequest?.assignedHours ||
      matchingPatrolTimeOffRequest?.offHours ||
      replacement?.defaultShiftHours ||
      ""
    const leave = isProblemStatus(row.status) || !!matchingPatrolTimeOffRequest
    const forcedPatrolTimeOffHighlight = !!matchingPatrolTimeOffRequest
    const leaveLabel = matchingPatrolTimeOffRequest?.offReason
      ? formatStatusLabel(matchingPatrolTimeOffRequest.offReason)
      : isProblemStatus(row.status)
        ? formatStatusLabel(row.status)
      : matchingPatrolTimeOffRequest
        ? "Off"
        : row.shift_hours || ""
    const isMultiDateCandidate =
      !!multiDatePickerSelection &&
      row.employee_id === multiDatePickerSelection.employeeId &&
      row.position_code === multiDatePickerSelection.positionCode &&
      row.shift_type === multiDatePickerSelection.shiftType
    const isMultiDateSelected =
      !!multiDatePickerSelection && multiDatePickerSelection.selectedDates.includes(row.assignment_date)
    const isMultiDateDimmed =
      !!multiDatePickerSelection &&
      !isMultiDateCandidate
    const isOvertimeBuilderCandidate =
      !!overtimeBuilderSelection &&
      row.employee_id === overtimeBuilderSelection.employeeId
    const isOvertimeBuilderSelected =
      !!overtimeBuilderSelection &&
      overtimeBuilderSelection.selectedRowKeys.includes(getScheduleRowKey(row))
    const isOvertimeBuilderDimmed =
      !!overtimeBuilderSelection &&
      !isOvertimeBuilderCandidate
    const rowDate = new Date(`${row.assignment_date}T12:00:00`)
    const shiftRows = patrolPositions
      .map((position) => cellFor(rowDate, position.code, row.shift_type))
      .filter((shiftRow): shiftRow is ScheduleRow => Boolean(shiftRow))
    const forceNeeded =
      isForceRequired(row, shiftRows) &&
      !isShiftCovered(row) &&
      row.status !== "Open Shift"

    const activeTeam = getActiveTeam(new Date(row.assignment_date), row.shift_type)

    return (
      <div
        onClick={() => openEditor(date, positionCode, shiftType)}
        style={{
          minHeight: compact ? "44px" : "84px",
          padding: compact ? "1px 5px" : "10px",
          border: isMultiDateCandidate
            ? `2px solid ${isMultiDateSelected ? "#2563eb" : "#94a3b8"}`
            : isOvertimeBuilderCandidate
              ? `2px solid ${isOvertimeBuilderSelected ? "#2563eb" : "#94a3b8"}`
            : `1px solid ${colorSettings?.cardBorder || colorSettings?.border || "#e5e7eb"}`,
          borderRadius: "6px",
          background: isMultiDateSelected
            ? "#dbeafe"
            : isMultiDateCandidate
              ? "#f8fafc"
              : isOvertimeBuilderSelected
                ? "#dbeafe"
                : isOvertimeBuilderCandidate
                  ? "#f8fafc"
              : colorSettings?.cellBackground || "#ffffff",
          display: "grid",
          gridTemplateRows: compact ? "auto auto" : "1fr auto",
          alignContent: "start",
          gap: compact ? "0px" : "2px",
          fontSize: compact ? "12px" : "13px",
          cursor: canEdit ? "pointer" : "default",
          position: "relative",
          boxShadow: isMultiDateCandidate || isOvertimeBuilderCandidate ? "0 0 0 1px rgba(148, 163, 184, 0.18)" : "none",
          opacity: isMultiDateDimmed || isOvertimeBuilderDimmed ? 0.4 : 1,
          filter: isMultiDateDimmed || isOvertimeBuilderDimmed ? "grayscale(0.2)" : "none"
        }}
      >
        {isMultiDateCandidate && (
          <button
            onClick={(event) => {
              event.stopPropagation()
              toggleMultiDatePick(row.assignment_date)
            }}
            style={{
              position: "absolute",
              top: compact ? "3px" : "6px",
              right: compact ? "3px" : "6px",
              width: compact ? "16px" : "20px",
              height: compact ? "16px" : "20px",
              borderRadius: "4px",
              border: `2px solid ${isMultiDateSelected ? "#2563eb" : "#94a3b8"}`,
              background: isMultiDateSelected ? "#2563eb" : "#ffffff",
              color: "#ffffff",
              fontSize: compact ? "10px" : "12px",
              fontWeight: 800,
              lineHeight: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              padding: 0,
              boxShadow: "0 2px 6px rgba(15, 23, 42, 0.16)"
            }}
            aria-label={`Select ${row.assignment_date}`}
          >
            {isMultiDateSelected ? "✓" : ""}
          </button>
        )}

        {isOvertimeBuilderCandidate && (
          <button
            onClick={(event) => {
              event.stopPropagation()
              toggleOvertimeBuilderRow(row)
            }}
            style={{
              position: "absolute",
              top: compact ? "3px" : "6px",
              right: compact ? "24px" : "30px",
              width: compact ? "16px" : "20px",
              height: compact ? "16px" : "20px",
              borderRadius: "4px",
              border: `2px solid ${isOvertimeBuilderSelected ? "#2563eb" : "#94a3b8"}`,
              background: isOvertimeBuilderSelected ? "#2563eb" : "#ffffff",
              color: "#ffffff",
              fontSize: compact ? "10px" : "12px",
              fontWeight: 800,
              lineHeight: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              padding: 0,
              boxShadow: "0 2px 6px rgba(15, 23, 42, 0.16)"
            }}
            aria-label={`Select ${row.assignment_date}`}
          >
            {isOvertimeBuilderSelected ? "✓" : ""}
          </button>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: compact ? "2px" : "6px" }}>
          <div
            style={{
              width: "100%",
              fontWeight: 600,
              background: forcedPatrolTimeOffHighlight
                ? "#fde68a"
                : leave
                  ? colorSettings?.cellHighlight || "#fde68a"
                  : "transparent",
              border: forcedPatrolTimeOffHighlight ? "1px solid #f59e0b" : "1px solid #d1d5db",
              padding: compact ? "2px 4px" : "2px 6px",
              borderRadius: "4px",
              whiteSpace: "nowrap",
              minHeight: compact ? "16px" : "24px",
              fontSize: compact ? "13px" : "15px",
              lineHeight: 1,
              letterSpacing: "-0.02em",
              boxSizing: "border-box",
              justifyContent: "center",
              textAlign: "center",
              display: "grid",
              gridTemplateColumns: compact ? "26px minmax(0, 1fr) 30px" : "36px minmax(0, 1fr) 56px",
              alignItems: "center",
              columnGap: compact ? "4px" : "8px",
              outline: forcedPatrolTimeOffHighlight
                ? "1px solid #f59e0b"
                : isMultiDateCandidate
                  ? "1px solid #94a3b8"
                  : isOvertimeBuilderCandidate
                    ? "1px solid #94a3b8"
                  : "none"
            }}
          >
            <span style={{ textAlign: "left", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
              {(row.vehicle || "").trim()}
            </span>
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                background: isMultiDateCandidate || isOvertimeBuilderCandidate ? "#e5e7eb" : "transparent",
                borderRadius: "4px",
                padding: isMultiDateCandidate || isOvertimeBuilderCandidate ? "1px 4px" : "0"
              }}
            >
              {employee?.lastName || "OPEN"}
            </span>
            <span style={{ textAlign: "center", whiteSpace: "nowrap" }}>
              {leaveLabel}
            </span>
          </div>
        </div>

        <div
          style={{
            fontSize: compact ? "12px" : "13px",
            color: replacement ? "#2563eb" : "#94a3b8",
            paddingTop: 0,
            minHeight: compact ? "8px" : "14px",
            lineHeight: 0.82,
            marginTop: compact ? "3px" : "0"
          }}
        >
          <div
            style={{
              width: "100%",
              border: "1px solid #d1d5db",
              borderRadius: "4px",
              padding: compact ? "2px 4px" : "2px 6px",
              boxSizing: "border-box",
              minHeight: compact ? "16px" : "24px",
              background: "#ffffff",
              display: "grid",
              gridTemplateColumns: compact ? "26px minmax(0, 1fr) 30px" : "36px minmax(0, 1fr) 56px",
              alignItems: "center",
              lineHeight: 1,
              justifyContent: "center",
              textAlign: "center",
              columnGap: compact ? "4px" : "8px"
            }}
          >
            {replacement ? (
              <>
                <span style={{ textAlign: "left", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  {replacementVehicle.trim()}
                </span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {replacement.lastName}
                </span>
                <span style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                  {replacementHours}
                </span>
              </>
            ) : ""}
          </div>
        </div>
{forceNeeded && (
  <button
    onClick={async (e) => {
      e.stopPropagation()

      const { data: history } = await supabase
        .from("force_history")
        .select("*")

      const today = row.assignment_date

// 1. who is already working that day?
const workingIds = effectiveScheduleRows
  .filter((r) => r.assignment_date === today)
  .map((r) => r.employee_id)
  .filter((employeeId): employeeId is string => Boolean(employeeId))

// 2. build force stats
const enriched = employees.map(emp => {
  const records = (history || [])
    .filter((r: any) => r.employee_id === emp.id)
    .sort((a: any, b: any) =>
      b.forced_date.localeCompare(a.forced_date)
    )

  return {
    ...emp,
    total: records.length,
    last: records[0]?.forced_date || ""
  }
})

// 3. FILTER ELIGIBLE
const eligible = enriched.filter(emp => {

   // ❌ prevent same team forcing
   if (emp.team === activeTeam) return false

  // ❌ already working that day
  if (workingIds.includes(emp.id)) return false

  // ❌ already assigned as replacement somewhere
  const alreadyReplacement = effectiveScheduleRows.some(r =>
    r.assignment_date === today &&
    r.replacement_employee_id === emp.id
  )
  if (alreadyReplacement) return false

  // ❌ cooldown (forced in last 3 days)
  if (emp.last) {
    const lastDate = new Date(emp.last)
    const now = new Date(today)
    const diff = (now.getTime() - lastDate.getTime()) / 86400000

    if (diff < 3) return false
  }

  return true
})

// 4. SORT FAIRLY
const ranking = eligible.sort((a, b) => {
  if (a.total !== b.total) return a.total - b.total
  return a.last.localeCompare(b.last)
})

const next = ranking[0]
      if (!next) return

      // assign replacement
      await supabase.from("patrol_schedule").upsert({
        ...row,
        replacement_employee_id: next.id
      })

      // log force
      await supabase.from("force_history").insert({
        employee_id: next.id,
        forced_date: new Date().toISOString().slice(0, 10)
      })
      onAuditEvent?.(
        "Patrol Force Required",
        `Force-assigned ${next.firstName} ${next.lastName} into ${row.assignment_date} ${row.shift_type} ${row.position_code}.`,
        `Original team: ${activeTeam}`
      )
    }}
    style={{
      marginTop: "6px",
      background: "#991b1b",
      color: "white",
      padding: "4px",
      fontSize: "11px",
      borderRadius: "4px",
      border: "none",
      cursor: "pointer"
    }}
  >
    FORCE REQUIRED
  </button>
)}

      </div>
    )
  }

  const weekRows = view === "day" ? [dates] : chunkDates(dates, 7)
  const rangeTitle =
    view === "month"
      ? baseDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : dates.length > 0
        ? formatRange(dates[0], dates[dates.length - 1])
        : "Patrol Schedule"
  const weekdayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  const labelColumnWidth = view === "day" ? "84px" : "90px"
  const stickyWeekHeaderTop = multiDatePickerSelection || overtimeBuilderSelection ? "108px" : "8px"
  const visiblePatrolCells = dates.flatMap((date) =>
    (["Days", "Nights"] as const).flatMap((shiftType) =>
      patrolPositions
        .map((position) => cellFor(date, position.code, shiftType))
        .filter((row): row is ScheduleRow => Boolean(row))
    )
  )
  const openShiftCount = visiblePatrolCells.filter(
    (row) => row.status === "Open Shift" || !row.employee_id
  ).length
  const timeOffCount = visiblePatrolCells.filter((row) => isProblemStatus(row.status)).length
  const replacementCount = visiblePatrolCells.filter((row) => !!row.replacement_employee_id).length
  const forceRiskCount = visiblePatrolCells.filter((row) => {
    const rowDate = new Date(`${row.assignment_date}T12:00:00`)
    const shiftRows = patrolPositions
      .map((position) => cellFor(rowDate, position.code, row.shift_type))
      .filter((shiftRow): shiftRow is ScheduleRow => Boolean(shiftRow))

    return isForceRequired(row, shiftRows) && !isShiftCovered(row) && row.status !== "Open Shift"
  }).length
  const supervisorAlertCount = visiblePatrolCells.filter((row) => {
    if (!row.position_code.startsWith("SUP")) return false

    const rowDate = new Date(`${row.assignment_date}T12:00:00`)
    const shiftRows = patrolPositions
      .map((position) => cellFor(rowDate, position.code, row.shift_type))
      .filter((shiftRow): shiftRow is ScheduleRow => Boolean(shiftRow))

    return isForceRequired(row, shiftRows) && !isShiftCovered(row)
  }).length

  return (
    <>
      <div
        id="patrol-print-section"
        style={{
          width: "100%",
          background: colorSettings?.cardBackground || "#fff",
          borderRadius: "16px",
          border: `1px solid ${colorSettings?.border || "#dbeafe"}`,
          boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
          overflow: "hidden"
        }}
      >
        <div
          style={{
            display: "grid",
            gap: "8px",
            padding: "10px 12px 8px",
            background: "linear-gradient(180deg, #f8fbff 0%, #eef4ff 100%)",
            borderBottom: `1px solid ${colorSettings?.border || "#dbeafe"}`
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "12px",
              flexWrap: "wrap"
            }}
          >
            <div style={{ display: "grid", gap: "2px" }}>
              <div
                style={{
                  fontSize: "9px",
                  fontWeight: 800,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "#1d4ed8"
                }}
              >
                Patrol Operations
              </div>
              <h2 style={{ margin: 0, fontSize: "18px", lineHeight: 1.05 }}>Patrol Schedule</h2>
              <div style={{ fontSize: "11px", color: "#475569" }}>
                Live roster, open coverage, and replacement visibility in one board.
              </div>
            </div>

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              <button data-no-print="true" onClick={prevMonth} style={{ minWidth: "34px", padding: "5px 8px" }}>
                ←
              </button>
              <button data-no-print="true" onClick={goToday} style={{ padding: "5px 8px" }}>
                Today
              </button>
              <button data-no-print="true" onClick={nextMonth} style={{ minWidth: "34px", padding: "5px 8px" }}>
                →
              </button>
              <button
                data-no-print="true"
                onClick={() => printElementById("patrol-print-section", "Patrol Schedule")}
                style={{ padding: "5px 8px" }}
              >
                Print Patrol
              </button>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(115px, 1fr))",
              gap: "6px"
            }}
          >
            {[
              { label: "Open Shifts", value: openShiftCount, tone: "#b91c1c", bg: "#fef2f2" },
              { label: "Time Off", value: timeOffCount, tone: "#92400e", bg: "#fffbeb" },
              { label: "Replacements", value: replacementCount, tone: "#1d4ed8", bg: "#eff6ff" },
              { label: "Force Risk", value: forceRiskCount, tone: "#7c3aed", bg: "#f5f3ff" },
              { label: "Supervisor Alerts", value: supervisorAlertCount, tone: "#be123c", bg: "#fff1f2" }
            ].map((card) => (
              <div
                key={card.label}
                style={{
                  border: "1px solid rgba(148, 163, 184, 0.22)",
                  borderRadius: "10px",
                  padding: "7px 9px",
                  background: card.bg,
                  display: "grid",
                  gap: "2px"
                }}
              >
                <div
                  style={{
                    fontSize: "9px",
                    fontWeight: 800,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "#64748b"
                  }}
                >
                  {card.label}
                </div>
                <div style={{ fontSize: "18px", lineHeight: 1, fontWeight: 800, color: card.tone }}>
                  {card.value}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              gap: "6px",
              flexWrap: "wrap",
              alignItems: "center",
              padding: "6px 8px",
              borderRadius: "10px",
              background: "rgba(255,255,255,0.8)",
              border: "1px solid rgba(148, 163, 184, 0.2)"
            }}
          >
            <Select
              value={String(baseDate.getMonth())}
              onValueChange={(value) => setMonth(Number(value))}
            >
              {months.map((month, index) => (
                <SelectItem key={month} value={String(index)}>
                  {month}
                </SelectItem>
              ))}
            </Select>

            <Select
              value={String(baseDate.getFullYear())}
              onValueChange={(value) => setYear(Number(value))}
            >
              {years.map((year) => (
                <SelectItem key={year} value={String(year)}>
                  {year}
                </SelectItem>
              ))}
            </Select>

            <Select
              value={view}
              onValueChange={(value) => setView(value as ScheduleView)}
            >
              {scheduleViews.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </Select>

            <input
              data-no-print="true"
              type="date"
              value={toIsoDate(baseDate)}
              onChange={(event) => setAnchorDate(event.target.value)}
              style={{
                padding: "6px 8px",
                border: "1px solid #cbd5e1",
                borderRadius: "8px",
                background: "#ffffff"
              }}
            />

          </div>

          <div style={{ display: "none", gap: "8px" }}>
            <button onClick={prevMonth}>←</button>
            <button onClick={goToday}>Today</button>
            <button onClick={nextMonth}>→</button>
          </div>
        </div>

        <div
          style={{
            textAlign: "center",
            fontWeight: 700,
            background: "#0f172a",
            color: "#f8fafc",
            border: `1px solid ${colorSettings?.border || "#e2e8f0"}`,
            padding: "12px",
            borderRadius: "0",
            marginBottom: "10px",
            letterSpacing: "0.02em"
          }}
        >
          {rangeTitle}
        </div>

        <div style={{ display: "grid", gap: "8px" }}>
          {weekRows.map((week, weekIndex) => (
            <div
              key={`week-${weekIndex}`}
              ref={(element) => {
                weekSectionRefs.current[weekIndex] = element
              }}
              style={{
               border: "1px solid #dbeafe",
                borderColor: colorSettings?.border || "#dbeafe",
                borderRadius: "10px",
                overflow: "visible",
                background: colorSettings?.cardBackground || "#ffffff"
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    view === "day"
                      ? `${labelColumnWidth} minmax(0, 1fr)`
                      : `${labelColumnWidth} repeat(7, minmax(0, 1fr))`,
                  position: "sticky",
                  top: stickyWeekHeaderTop,
                  zIndex: 6,
                  background: "#f8fafc",
                  borderBottom: "1px solid #dbeafe"
                  ,
                  borderBottomColor: colorSettings?.border || "#dbeafe",
                  boxShadow: "0 2px 8px rgba(15, 23, 42, 0.08)"
                }}
              >
                <div style={{ padding: "8px 6px", fontWeight: 700, color: "#475569", fontSize: "12px" }}>
                  {view === "day" ? "Schedule" : `Week ${weekIndex + 1}`}
                </div>

                {week.map((date) => {
                  const inCurrentMonth = date.getMonth() === baseDate.getMonth()

                  return (
                    <div
                      key={`header-${date.toISOString()}`}
                      style={{
                        padding: "6px 4px",
                        textAlign: "center",
                        borderLeft: "1px solid #dbeafe",
                           background: view === "month" && !inCurrentMonth ? "#f8fafc" : "#ffffff",
                            borderLeftColor: colorSettings?.border || "#dbeafe",
                        opacity: view === "month" && !inCurrentMonth ? 0.65 : 1
                      }}
                    >
                      <div style={{ fontSize: "10px", fontWeight: 700, color: "#475569" }}>
                        {weekdayLabels[date.getDay()]}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: "12px" }}>
                        {date.toLocaleDateString(undefined, {
                          month: "numeric",
                          day: "numeric"
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div
                style={{
                  display: "grid",
                  gap: "0"
                }}
              >
                {([
                  { kind: "team", shift: "Days", label: "Days Team" },
                  ...patrolPositions.map((position) => ({
                    kind: "position" as const,
                    shift: "Days" as ShiftType,
                    label: position.label,
                    code: position.code
                  })),
                  { kind: "team", shift: "Nights", label: "Nights Team" },
                  ...patrolPositions.map((position) => ({
                    kind: "position" as const,
                    shift: "Nights" as ShiftType,
                    label: position.label,
                    code: position.code
                  }))
                ] as const).map((row, rowIndex) => (
                  <div
                    key={`${row.label}-${rowIndex}-${weekIndex}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        view === "day"
                          ? `${labelColumnWidth} minmax(0, 1fr)`
                          : `${labelColumnWidth} repeat(7, minmax(0, 1fr))`,
                      borderTop: rowIndex === 0 ? "none" : "1px solid #e2e8f0"
                      ,
                      borderTopColor: rowIndex === 0 ? undefined : colorSettings?.border || "#e2e8f0"
                    }}
                  >
                    <div
                      style={{
                        padding: row.kind === "team" ? "5px 6px" : "4px 6px",
                        fontWeight: 700,
                        fontSize: row.kind === "team" ? "11px" : "12px",
                        background: row.kind === "team" ? "#f8fafc" : "#ffffff",
                        color: "#ec4899",
                        display: "flex",
                        alignItems: row.kind === "team" ? "center" : "stretch"
                      }}
                    >
                      {row.kind === "team" ? (
                        row.label
                      ) : (
                        <div style={{ display: "grid", gridTemplateRows: "1fr 1fr", width: "100%" }}>
                          <div style={{ display: "flex", alignItems: "center" }}>{row.label}</div>
                          <div style={{ display: "flex", alignItems: "center", fontSize: "9px", color: "#ec4899" }}>
                            Replacement
                          </div>
                        </div>
                      )}
                    </div>

                    {week.map((date) => {
                      const inCurrentMonth = date.getMonth() === baseDate.getMonth()

                      return (
                        <div
                          key={`${row.label}-${date.toISOString()}`}
                          style={{
                            padding: "3px",
                            borderLeft: "1px solid #e2e8f0",
                            borderLeftColor: colorSettings?.border || "#e2e8f0",
                            background: view === "month" && !inCurrentMonth ? "#f8fafc" : colorSettings?.cellBackground || "#ffffff",
                            opacity: view === "month" && !inCurrentMonth ? 0.7 : 1
                          }}
                        >
                          {row.kind === "team"
                            ? (
                              <div
                                onClick={() => openTeamEditor(date, row.shift)}
                                style={{
                                  textAlign: "center",
                                  fontSize: "11px",
                                  fontWeight: 800,
                                  color: "#1e3a8a",
                                  padding: "7px 2px",
                                  borderRadius: "8px",
                                  border: "1px solid #93c5fd",
                                  background: "linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%)",
                                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8)",
                                  cursor: canEdit ? "pointer" : "default"
                                }}
                              >
                                {getActiveTeam(date, row.shift)}
                              </div>
                            )
                            : renderShiftCell(date, row.code, row.shift, true)}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {editingRow && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000
          }}
        >
          <div
            style={{
              width: "420px",
              maxWidth: "95vw",
              background: "#ffffff",
              borderRadius: "10px",
              padding: "16px",
              boxShadow: "0 10px 30px rgba(0,0,0,0.2)"
            }}
          >
            <h3 style={{ marginTop: 0 }}>Edit Shift</h3>

            <div style={{ marginBottom: "10px", fontSize: "13px", color: "#475569" }}>
              {editingRow.assignment_date} · {editingRow.shift_type} · {editingRow.position_code}
            </div>

            <div style={{ display: "grid", gap: "10px" }}>
              <label>
                <div style={{ fontWeight: 600, marginBottom: "4px" }}>Employee</div>
                <select
                  value={editingRow.employee_id || ""}
                  onChange={(e) => handleEmployeeChange(e.target.value)}
                  style={{ width: "100%", padding: "8px" }}
                >
                  <option value="">-- none --</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.lastName}, {e.firstName}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div style={{ fontWeight: 600, marginBottom: "4px" }}>Vehicle</div>
                <input
                  list="patrol-vehicle-options"
                  value={editingRow.vehicle || ""}
                  onChange={(e) => updateEditingRow("vehicle", e.target.value)}
                  style={{ width: "100%", padding: "8px" }}
                />
                <datalist id="patrol-vehicle-options">
                  {referenceSettings.vehicles.map((vehicle) => (
                    <option key={vehicle} value={vehicle} />
                  ))}
                </datalist>
              </label>

              <label>
                <div style={{ fontWeight: 600, marginBottom: "4px" }}>Hours</div>
                <input
                  value={editingRow.shift_hours || ""}
                  onChange={(e) => updateEditingRow("shift_hours", e.target.value)}
                  style={{ width: "100%", padding: "8px" }}
                />
              </label>

              <label>
                <div style={{ fontWeight: 600, marginBottom: "4px" }}>Status</div>
                <select
                  value={editingRow.status || "Scheduled"}
                  onChange={(e) => updateEditingRow("status", e.target.value)}
                  style={{ width: "100%", padding: "8px" }}
                >
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div style={{ fontWeight: 600, marginBottom: "4px" }}>Replacement</div>
                <select
                  value={editingRow.replacement_employee_id || ""}
                  onChange={(e) => handleReplacementChange(e.target.value)}
                  style={{ width: "100%", padding: "8px" }}
                >
                  <option value="">-- none --</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.lastName}, {e.firstName}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div style={{ fontWeight: 600, marginBottom: "4px" }}>Replacement Vehicle</div>
                <input
                  list="patrol-vehicle-options"
                  value={editingRow.replacement_vehicle || ""}
                  onChange={(e) => updateEditingRow("replacement_vehicle", e.target.value)}
                  style={{ width: "100%", padding: "8px" }}
                />
              </label>

              <label>
                <div style={{ fontWeight: 600, marginBottom: "4px" }}>Replacement Hours</div>
                <input
                  value={editingRow.replacement_hours || ""}
                  onChange={(e) => updateEditingRow("replacement_hours", e.target.value)}
                  style={{ width: "100%", padding: "8px" }}
                />
              </label>
            </div>

            <div
              style={{
                marginTop: "16px",
                display: "flex",
                justifyContent: "space-between",
                gap: "8px"
              }}
            >
              <div>
                <button
                  onClick={deleteEditingRow}
                  disabled={saving}
                  style={{
                    padding: "8px 12px",
                    background: "#ef4444",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer"
                  }}
                >
                  Delete
                </button>
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={() => setEditingRow(null)}
                  disabled={saving}
                  style={{
                    padding: "8px 12px",
                    background: "#e2e8f0",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer"
                  }}
                >
                  Cancel
                </button>

                <button
                  onClick={saveEditingRow}
                  disabled={saving}
                  style={{
                    padding: "8px 12px",
                    background: "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer"
                  }}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {teamEditor && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000
          }}
        >
          <div
            style={{
              width: "640px",
              maxWidth: "94vw",
              background: "#ffffff",
              borderRadius: "12px",
              padding: "18px",
              boxShadow: "0 18px 40px rgba(15, 23, 42, 0.25)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
              <div>
                <div style={{ fontSize: "18px", fontWeight: 800 }}>Edit {teamEditor.team}</div>
                <div style={{ fontSize: "13px", color: "#64748b" }}>
                  {new Date(`${teamEditor.assignmentDate}T12:00:00`).toLocaleDateString(undefined, {
                    month: "long",
                    day: "numeric",
                    year: "numeric"
                  })} | {teamEditor.shiftType}
                </div>
              </div>

              <button
                onClick={() => setTeamEditor(null)}
                style={{
                  padding: "8px 12px",
                  border: "none",
                  borderRadius: "8px",
                  background: "#e2e8f0",
                  cursor: "pointer"
                }}
              >
                Close
              </button>
            </div>

            <div style={{ display: "grid", gap: "10px" }}>
              {buildWorkingShiftRows(teamEditor).map(({ row, employee, positionLabel }) => (
                <div
                  key={`${row.assignment_date}-${row.shift_type}-${row.position_code}`}
                  style={{
                    border: "1px solid #dbe3ee",
                    borderRadius: "10px",
                    padding: "12px 14px",
                    display: "grid",
                    gridTemplateColumns: "26px minmax(0, 1fr)",
                    gap: "12px",
                    alignItems: "center"
                  }}
                >
                  <button
                    onClick={() => {
                      setTeamEmployeeSelection({
                        employeeId: employee.id,
                        positionCode: row.position_code,
                        shiftType: row.shift_type,
                        assignmentDate: row.assignment_date,
                        team: teamEditor.team
                      })
                      setTimeOffDateSelection({
                        employeeId: employee.id,
                        positionCode: row.position_code,
                        shiftType: row.shift_type,
                        assignmentDate: row.assignment_date,
                        team: teamEditor.team,
                        mode: "single",
                        singleDate: row.assignment_date,
                        rangeStart: row.assignment_date,
                        rangeEnd: row.assignment_date
                      })
                    }}
                    style={{
                      width: "22px",
                      height: "22px",
                      borderRadius: "6px",
                      border: "2px solid #2563eb",
                      background: "#eff6ff",
                      cursor: "pointer"
                    }}
                    aria-label={`Select ${employee.firstName} ${employee.lastName}`}
                  />

                  <div style={{ display: "grid", gap: "3px" }}>
                    <div style={{ fontWeight: 800, fontSize: "14px", color: "#0f172a" }}>
                      {positionLabel} | {employee.firstName} {employee.lastName}
                    </div>
                    <div style={{ fontSize: "12px", color: "#475569" }}>
                      Vehicle: {row.vehicle || employee.defaultVehicle || "TBD"} | Hours: {row.shift_hours || employee.defaultShiftHours || "TBD"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {timeOffDateSelection && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.38)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1001
          }}
        >
          <div
            style={{
              width: "420px",
              maxWidth: "92vw",
              background: "#ffffff",
              borderRadius: "12px",
              padding: "18px",
              boxShadow: "0 18px 40px rgba(15, 23, 42, 0.25)"
            }}
          >
            <div style={{ fontWeight: 800, fontSize: "18px", marginBottom: "12px" }}>Select Time-Off Date</div>

            <div style={{ display: "grid", gap: "12px" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                {(["single", "multiple"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setTimeOffDateSelection({ ...timeOffDateSelection, mode })}
                    style={{
                      padding: "8px 12px",
                      border: "none",
                      borderRadius: "8px",
                      cursor: "pointer",
                      background: timeOffDateSelection.mode === mode ? "#2563eb" : "#e2e8f0",
                      color: timeOffDateSelection.mode === mode ? "#ffffff" : "#0f172a",
                      fontWeight: 700
                    }}
                  >
                    {mode === "single" ? "Single Date" : "Multiple Dates"}
                  </button>
                ))}
              </div>

              {timeOffDateSelection.mode === "single" ? (
                <label>
                  <div style={{ fontWeight: 600, marginBottom: "4px" }}>Date</div>
                  <input
                    type="date"
                    value={timeOffDateSelection.singleDate}
                    onChange={(event) => setTimeOffDateSelection({ ...timeOffDateSelection, singleDate: event.target.value })}
                    style={{ width: "100%", padding: "8px" }}
                  />
                </label>
              ) : (
                <div
                  style={{
                    padding: "12px",
                    borderRadius: "10px",
                    background: "#eff6ff",
                    border: "1px solid #bfdbfe",
                    fontSize: "13px",
                    color: "#1e3a8a",
                    lineHeight: 1.45
                  }}
                >
                  Choosing `Multiple Dates` will bring you back to the Patrol schedule.
                  The selected employee’s shifts will show clickable boxes so you can pick the exact dates from the calendar.
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}>
              <button
                onClick={() => {
                  setTimeOffDateSelection(null)
                  setTeamEmployeeSelection(null)
                }}
                style={{
                  padding: "8px 12px",
                  border: "none",
                  borderRadius: "8px",
                  background: "#e2e8f0",
                  cursor: "pointer"
                }}
              >
                Cancel
              </button>

              <button
                onClick={() => {
                  if (timeOffDateSelection.mode === "multiple") {
                    setMultiDatePickerSelection({
                      employeeId: timeOffDateSelection.employeeId,
                      positionCode: timeOffDateSelection.positionCode,
                      shiftType: timeOffDateSelection.shiftType,
                      team: timeOffDateSelection.team,
                      selectedDates: []
                    })
                    setTimeOffDateSelection(null)
                    setTeamEditor(null)
                    return
                  }

                  const dates = buildDatesFromSelection(timeOffDateSelection)
                  if (dates.length === 0) return

                  setTimeOffReasonSelection({
                    ...timeOffDateSelection,
                    dates,
                    reason: "Vacation"
                  })
                  setTimeOffDateSelection(null)
                }}
                style={{
                  padding: "8px 12px",
                  border: "none",
                  borderRadius: "8px",
                  background: "#2563eb",
                  color: "#ffffff",
                  cursor: "pointer"
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {multiDatePickerSelection && (
        <div
          style={{
            position: "fixed",
            top: "16px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 999,
            width: "min(860px, calc(100vw - 32px))",
            background: "#0f172a",
            color: "#ffffff",
            borderRadius: "12px",
            padding: "12px 14px",
            boxShadow: "0 18px 40px rgba(15, 23, 42, 0.3)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "14px",
            flexWrap: "wrap"
          }}
        >
          <div style={{ display: "grid", gap: "2px" }}>
            <div style={{ fontWeight: 800, fontSize: "14px" }}>Choose Multiple Patrol Dates</div>
            <div style={{ fontSize: "12px", color: "#cbd5e1" }}>
              Click the boxes on that employee’s scheduled shifts. Selected: {multiDatePickerSelection.selectedDates.length}
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <button
              onClick={prevMonth}
              style={{
                padding: "8px 10px",
                border: "none",
                borderRadius: "8px",
                background: "#1e293b",
                color: "#ffffff",
                cursor: "pointer",
                fontWeight: 700
              }}
            >
              Prev Month
            </button>

            <div
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                background: "#1e293b",
                color: "#cbd5e1",
                fontSize: "12px",
                fontWeight: 700
              }}
            >
              {baseDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </div>

            <button
              onClick={nextMonth}
              style={{
                padding: "8px 10px",
                border: "none",
                borderRadius: "8px",
                background: "#1e293b",
                color: "#ffffff",
                cursor: "pointer",
                fontWeight: 700
              }}
            >
              Next Month
            </button>

            <button
              onClick={() => {
                setMultiDatePickerSelection(null)
                setTeamEmployeeSelection(null)
              }}
              style={{
                padding: "8px 12px",
                border: "none",
                borderRadius: "8px",
                background: "#334155",
                color: "#ffffff",
                cursor: "pointer"
              }}
            >
              Cancel
            </button>

            <button
              onClick={() => {
                if (multiDatePickerSelection.selectedDates.length === 0) return

                setTimeOffReasonSelection({
                  employeeId: multiDatePickerSelection.employeeId,
                  positionCode: multiDatePickerSelection.positionCode,
                  shiftType: multiDatePickerSelection.shiftType,
                  assignmentDate: multiDatePickerSelection.selectedDates[0],
                  team: multiDatePickerSelection.team,
                  mode: "multiple",
                  singleDate: multiDatePickerSelection.selectedDates[0],
                  rangeStart: multiDatePickerSelection.selectedDates[0],
                  rangeEnd: multiDatePickerSelection.selectedDates[multiDatePickerSelection.selectedDates.length - 1],
                  dates: multiDatePickerSelection.selectedDates,
                  reason: "Vacation"
                })
                setMultiDatePickerSelection(null)
              }}
              style={{
                padding: "8px 12px",
                border: "none",
                borderRadius: "8px",
                background: "#2563eb",
                color: "#ffffff",
                cursor: "pointer"
              }}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {overtimeBuilderSelection && (
        <div
          style={{
            position: "fixed",
            top: "16px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 999,
            width: "min(920px, calc(100vw - 32px))",
            background: "#0f172a",
            color: "#ffffff",
            borderRadius: "12px",
            padding: "12px 14px",
            boxShadow: "0 18px 40px rgba(15, 23, 42, 0.3)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "14px",
            flexWrap: "wrap"
          }}
        >
            <div style={{ display: "grid", gap: "2px" }}>
            <div style={{ fontWeight: 800, fontSize: "14px" }}>Overtime Builder Patrol Picker</div>
            <div style={{ fontSize: "12px", color: "#cbd5e1" }}>
              Click the selected employee's Patrol boxes. Selected: {overtimeBuilderSelection.selectedRows.length}
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <button
              onClick={prevMonth}
              style={{
                padding: "8px 10px",
                border: "none",
                borderRadius: "8px",
                background: "#1e293b",
                color: "#ffffff",
                cursor: "pointer",
                fontWeight: 700
              }}
            >
              Prev Month
            </button>

            <div
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                background: "#1e293b",
                color: "#cbd5e1",
                fontSize: "12px",
                fontWeight: 700
              }}
            >
              {baseDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </div>

            <button
              onClick={nextMonth}
              style={{
                padding: "8px 10px",
                border: "none",
                borderRadius: "8px",
                background: "#1e293b",
                color: "#ffffff",
                cursor: "pointer",
                fontWeight: 700
              }}
            >
              Next Month
            </button>

            <button
              onClick={() => setOvertimeBuilderSelection(null)}
              style={{
                padding: "8px 12px",
                border: "none",
                borderRadius: "8px",
                background: "#334155",
                color: "#ffffff",
                cursor: "pointer"
              }}
            >
              Cancel
            </button>

            <button
              onClick={() => {
                if (overtimeBuilderSelection.selectedRows.length === 0) return

                setOvertimeBuilderReasonSelection({
                  employeeId: overtimeBuilderSelection.employeeId,
                  selectedRowKeys: overtimeBuilderSelection.selectedRowKeys,
                  selectedRows: overtimeBuilderSelection.selectedRows,
                  reason: "Vacation"
                })
              }}
              style={{
                padding: "8px 12px",
                border: "none",
                borderRadius: "8px",
                background: "#2563eb",
                color: "#ffffff",
                cursor: "pointer"
              }}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {timeOffReasonSelection && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.42)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1002
          }}
        >
          <div
            style={{
              width: "420px",
              maxWidth: "92vw",
              background: "#ffffff",
              borderRadius: "12px",
              padding: "18px",
              boxShadow: "0 18px 40px rgba(15, 23, 42, 0.25)"
            }}
          >
            <div style={{ fontWeight: 800, fontSize: "18px", marginBottom: "12px" }}>Select Time-Off Reason</div>

            <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "10px" }}>
              Dates: {timeOffReasonSelection.dates.join(", ")}
            </div>

            <label>
              <div style={{ fontWeight: 600, marginBottom: "4px" }}>Reason</div>
              <select
                value={timeOffReasonSelection.reason}
                onChange={(event) => setTimeOffReasonSelection({ ...timeOffReasonSelection, reason: event.target.value })}
                style={{ width: "100%", padding: "8px" }}
              >
                {nonScheduledStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}>
              <button
                onClick={() => {
                  setTimeOffReasonSelection(null)
                  if (teamEmployeeSelection) {
                    setTimeOffDateSelection({
                      ...teamEmployeeSelection,
                      mode: "single",
                      singleDate: teamEmployeeSelection.assignmentDate,
                      rangeStart: teamEmployeeSelection.assignmentDate,
                      rangeEnd: teamEmployeeSelection.assignmentDate
                    })
                  }
                }}
                style={{
                  padding: "8px 12px",
                  border: "none",
                  borderRadius: "8px",
                  background: "#e2e8f0",
                  cursor: "pointer"
                }}
              >
                Back
              </button>

              <button
                onClick={() => void saveTeamTimeOffSelection()}
                disabled={saving}
                style={{
                  padding: "8px 12px",
                  border: "none",
                  borderRadius: "8px",
                  background: "#2563eb",
                  color: "#ffffff",
                  cursor: "pointer"
                }}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {overtimeBuilderReasonSelection && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.38)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1001
          }}
        >
          <div
            style={{
              width: "420px",
              maxWidth: "92vw",
              background: "#ffffff",
              borderRadius: "12px",
              padding: "18px",
              boxShadow: "0 18px 40px rgba(15, 23, 42, 0.25)"
            }}
          >
            <div style={{ fontWeight: 800, fontSize: "18px", marginBottom: "12px" }}>Select Time-Off Reason</div>

            <div style={{ display: "grid", gap: "12px" }}>
              <div style={{ fontSize: "13px", color: "#475569" }}>
                Selected shifts: {overtimeBuilderReasonSelection.selectedRowKeys.length}
              </div>

              <label>
                <div style={{ fontWeight: 600, marginBottom: "4px" }}>Reason</div>
                <select
                  value={overtimeBuilderReasonSelection.reason}
                  onChange={(event) =>
                    setOvertimeBuilderReasonSelection({
                      ...overtimeBuilderReasonSelection,
                      reason: event.target.value
                    })
                  }
                  style={{ width: "100%", padding: "8px" }}
                >
                  {nonScheduledStatusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}>
              <button
                onClick={() => setOvertimeBuilderReasonSelection(null)}
                style={{
                  padding: "8px 12px",
                  border: "none",
                  borderRadius: "8px",
                  background: "#e2e8f0",
                  cursor: "pointer"
                }}
              >
                Back
              </button>

              <button
                onClick={() => void saveOvertimeBuilderSelection()}
                style={{
                  padding: "8px 12px",
                  border: "none",
                  borderRadius: "8px",
                  background: "#2563eb",
                  color: "#ffffff",
                  cursor: "pointer"
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

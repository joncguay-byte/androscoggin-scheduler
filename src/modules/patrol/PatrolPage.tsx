import { useEffect, useMemo, useRef, useState } from "react"
import type {
  Employee,
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

const STATUS_OPTIONS = [
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

function getScheduleRowKey(row: Pick<ScheduleRow, "assignment_date" | "shift_type" | "position_code">) {
  return `${row.assignment_date}-${row.shift_type}-${row.position_code}`
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
  patrolOverrideRows,
  setPatrolOverrideRows,
  colorSettings,
  onAuditEvent
}: {
  employees: Employee[]
  canEdit?: boolean
  defaultView?: ScheduleView
  patrolOverrideRows: ScheduleRow[]
  setPatrolOverrideRows: React.Dispatch<React.SetStateAction<ScheduleRow[]>>
  colorSettings?: {
    accent: string
    border: string
    cardBackground: string
    cardBorder: string
    cellBackground: string
    cellHighlight: string
  }
  onAuditEvent?: (action: string, summary: string, details?: string) => void
}) {
  const today = new Date()

  const [baseDate, setBaseDate] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1)
  )
  const [view, setView] = useState<ScheduleView>(defaultView)
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([])
  const [editingRow, setEditingRow] = useState<EditingRow | null>(null)
  const [saving, setSaving] = useState(false)
  const scheduleRefreshTimeoutRef = useRef<number | null>(null)

  const dates = useMemo(() => buildVisibleDates(baseDate, view), [baseDate, view])
  const effectiveScheduleRows = useMemo(
    () => mergeScheduleRows(scheduleRows, patrolOverrideRows),
    [patrolOverrideRows, scheduleRows]
  )
  const months = Array.from({ length: 12 }, (_, index) =>
    new Date(today.getFullYear(), index, 1).toLocaleDateString(undefined, { month: "long" })
  )
  const years = Array.from({ length: 9 }, (_, index) => today.getFullYear() - 4 + index)

  useEffect(() => {
    setView(defaultView)
  }, [defaultView])

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

    if (shouldSeedFromEmployees) {
      return buildDefaultAssignmentRow(
        employees,
        date,
        positionCode,
        shiftType,
        existingRow
      )
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

    if (error) {
      const message = error.message.toLowerCase()
      const isNetworkError =
        message.includes("timeout") ||
        message.includes("failed to fetch") ||
        message.includes("fetch")

      if (isNetworkError) {
        const nextLocalOverrides = mergeScheduleRows(patrolOverrideRows, [localRow])
        setPatrolOverrideRows(nextLocalOverrides)
        setScheduleRows((current) => mergeScheduleRows(current, [localRow]))
        const employee = employees.find((employeeRow) => employeeRow.id === row.employee_id)
        const replacement = employees.find((employeeRow) => employeeRow.id === row.replacement_employee_id)
        onAuditEvent?.(
          "Patrol Shift Saved",
          `Saved patrol shift locally for ${row.assignment_date} ${row.shift_type} ${row.position_code}.`,
          `${employee ? `${employee.firstName} ${employee.lastName}` : "Open"} | Status: ${row.status || "Scheduled"}${replacement ? ` | Replacement: ${replacement.firstName} ${replacement.lastName}` : ""}`
        )
        setSaving(false)
        setEditingRow(null)
        alert("Shift saved locally because Supabase did not respond. It will stay visible in the scheduler.")
        return
      }

      console.error("Failed to save patrol row:", error)
      alert(`Failed to save shift: ${error.message}`)
      setSaving(false)
      return
    }

    invalidatePatrolScheduleCache()
    const persistedWithoutNetworkFailure = mergeScheduleRows(patrolOverrideRows, [localRow])
    setPatrolOverrideRows(persistedWithoutNetworkFailure)
    setScheduleRows((current) => mergeScheduleRows(current, [localRow]))
    const employee = employees.find((employeeRow) => employeeRow.id === row.employee_id)
    const replacement = employees.find((employeeRow) => employeeRow.id === row.replacement_employee_id)
    onAuditEvent?.(
      "Patrol Shift Saved",
      `Saved patrol shift for ${row.assignment_date} ${row.shift_type} ${row.position_code}.`,
      `${employee ? `${employee.firstName} ${employee.lastName}` : "Open"} | Status: ${row.status || "Scheduled"}${replacement ? ` | Replacement: ${replacement.firstName} ${replacement.lastName}` : ""}`
    )
    setSaving(false)
    setEditingRow(null)
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
      alert("Failed to delete shift.")
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
    const replacement = employees.find((e) => e.id === row.replacement_employee_id)
    const leave = isProblemStatus(row.status)
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
          border: `1px solid ${colorSettings?.cardBorder || colorSettings?.border || "#e5e7eb"}`,
          borderRadius: "6px",
          background: colorSettings?.cellBackground || "#ffffff",
          display: "grid",
          gridTemplateRows: compact ? "auto auto" : "1fr auto",
          alignContent: "start",
          gap: compact ? "0px" : "2px",
          fontSize: compact ? "12px" : "13px",
          cursor: canEdit ? "pointer" : "default"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: compact ? "2px" : "6px" }}>
          <div
            style={{
              width: "100%",
              fontWeight: 600,
              background: leave ? colorSettings?.cellHighlight || "#fde68a" : "transparent",
              border: "1px solid #d1d5db",
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
              columnGap: compact ? "4px" : "8px"
            }}
          >
            <span style={{ textAlign: "left", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
              {(row.vehicle || "").trim()}
            </span>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {employee?.lastName || "OPEN"}
            </span>
            <span style={{ textAlign: "center", whiteSpace: "nowrap" }}>
              {leave ? formatStatusLabel(row.status) : row.shift_hours || ""}
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
                  {(row.replacement_vehicle || "").trim()}
                </span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {replacement.lastName}
                </span>
                <span style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                  {row.replacement_hours || ""}
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

  return (
    <>
      <div
        id="patrol-print-section"
        style={{
          width: "100%",
          background: colorSettings?.cardBackground || "#fff",
          borderRadius: "10px"
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "8px",
            gap: "12px",
            flexWrap: "wrap"
          }}
        >
          <h2 style={{ margin: 0 }}>Patrol Schedule</h2>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
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
                borderRadius: "6px"
              }}
            />

            <button
              data-no-print="true"
              onClick={() => printElementById("patrol-print-section", "Patrol Schedule")}
            >
              Print Patrol
            </button>

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
            background: "#e2e8f0",
            border: `1px solid ${colorSettings?.border || "#e2e8f0"}`,
            padding: "10px",
            borderRadius: "6px",
            marginBottom: "6px"
          }}
        >
          {rangeTitle}
        </div>

        <div style={{ display: "grid", gap: "8px" }}>
          {weekRows.map((week, weekIndex) => (
            <div
              key={`week-${weekIndex}`}
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
                  top: "8px",
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
                                style={{
                                  textAlign: "center",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  color: "#475569",
                                  padding: "7px 2px"
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
                  value={editingRow.vehicle || ""}
                  onChange={(e) => updateEditingRow("vehicle", e.target.value)}
                  style={{ width: "100%", padding: "8px" }}
                />
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
                  {STATUS_OPTIONS.map((status) => (
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
    </>
  )
}

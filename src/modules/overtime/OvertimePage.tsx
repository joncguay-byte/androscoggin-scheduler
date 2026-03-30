import { useEffect, useMemo, useRef, useState } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/simple-ui"
import { patrolPositions } from "../../data/constants"
import { buildForceRotationOrder, getEmployeeForceSummary } from "../../lib/force-rotation"
import { fetchPatrolScheduleRange, invalidatePatrolScheduleCache } from "../../lib/patrol-schedule"
import { printElementById } from "../../lib/print"
import { ensureMonthSchedule } from "../../lib/schedule-generator"
import { supabase } from "../../lib/supabase"
import type {
  AppRole,
  DetailRecord,
  Employee,
  ForceHistoryRow,
  OvertimeShiftRequest,
  PatrolScheduleRow,
  PatrolPositionCode,
  ShiftType,
} from "../../types"

type OvertimePageProps = {
  employees: Employee[]
  currentUserRole: AppRole
  patrolRows: PatrolScheduleRow[]
  patrolOverrideRows: PatrolScheduleRow[]
  setPatrolOverrideRows: React.Dispatch<React.SetStateAction<PatrolScheduleRow[]>>
  detailRecords: DetailRecord[]
  forceHistory: ForceHistoryRow[]
  setForceHistory: React.Dispatch<React.SetStateAction<ForceHistoryRow[]>>
  overtimeQueueIds: string[]
  setOvertimeQueueIds: React.Dispatch<React.SetStateAction<string[]>>
  overtimeShiftRequests: OvertimeShiftRequest[]
  setOvertimeShiftRequests: React.Dispatch<React.SetStateAction<OvertimeShiftRequest[]>>
  onOpenNotificationsForShiftIds: (shiftIds: string[], recipientIds?: string[]) => void
  onOpenPatrolTimeOffPicker: (employeeId: string) => void
  onQueueAssignmentNotice: (requestId: string, employeeId: string) => void
  onAuditEvent: (action: string, summary: string, details?: string) => void
}

const CARD_STYLE = {
  border: "1px solid #dbe3ee",
  borderRadius: "10px",
  background: "#ffffff"
} as const

const TIME_OFF_REASON_OPTIONS = [
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
  "Off"
] as const

type PreviewLayout = "preview1" | "preview2" | "preview3" | "preview4"
type BuilderSelectionMode = "single" | "multiple" | "month"

function formatQueuePositionLabel(positionCode: OvertimeShiftRequest["positionCode"]) {
  if (positionCode === "SUP1" || positionCode === "SUP2") return "Supervisor"
  if (positionCode === "DEP1" || positionCode === "DEP2") return "Deputy"
  if (positionCode === "POL") return "Poland"
  return positionCode
}

function buildPatrolOvertimeRequestId(assignmentDate: string, shiftType: ShiftType, positionCode: PatrolPositionCode) {
  return `patrol-open-${assignmentDate}-${shiftType}-${positionCode}`
}

function getPatrolRowKey(row: Pick<PatrolScheduleRow, "assignment_date" | "shift_type" | "position_code">) {
  return `${row.assignment_date}-${row.shift_type}-${row.position_code}`
}

function mergePatrolRows(baseRows: PatrolScheduleRow[], overrideRows: PatrolScheduleRow[]) {
  const merged = new Map<string, PatrolScheduleRow>()

  for (const row of baseRows) {
    merged.set(getPatrolRowKey(row), row)
  }

  for (const row of overrideRows) {
    merged.set(getPatrolRowKey(row), row)
  }

  return [...merged.values()].sort((a, b) => {
    if (a.assignment_date !== b.assignment_date) return a.assignment_date.localeCompare(b.assignment_date)
    if (a.shift_type !== b.shift_type) return a.shift_type.localeCompare(b.shift_type)
    return a.position_code.localeCompare(b.position_code)
  })
}

function toPatrolOverridePayload(row: PatrolScheduleRow) {
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

function formatShortDate(isoDate: string) {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "numeric"
  })
}

function buildMonthGrid(anchorDate: Date) {
  const firstDay = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1)
  const lastDay = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0)
  const gridStart = new Date(firstDay)
  gridStart.setDate(firstDay.getDate() - firstDay.getDay())
  const gridEnd = new Date(lastDay)
  gridEnd.setDate(lastDay.getDate() + (6 - lastDay.getDay()))
  const dates: Date[] = []

  for (let date = new Date(gridStart); date <= gridEnd; date.setDate(date.getDate() + 1)) {
    dates.push(new Date(date))
  }

  return dates
}

function chunkDates(dates: Date[], chunkSize: number) {
  const chunks: Date[][] = []

  for (let index = 0; index < dates.length; index += chunkSize) {
    chunks.push(dates.slice(index, index + chunkSize))
  }

  return chunks
}

function getCalendarDayDiff(date: Date, anchor: Date) {
  const utcDate = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const utcAnchor = Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
  return Math.round((utcDate - utcAnchor) / 86400000)
}

function getActiveTeam(date: Date, shift: ShiftType) {
  const pitman = [0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0]
  const start = new Date("2026-03-01T12:00:00")
  const diff = getCalendarDayDiff(date, start)
  const idx = pitman[((diff % pitman.length) + pitman.length) % pitman.length]

  if (shift === "Days") return idx ? "Days A" : "Days B"
  return idx ? "Nights A" : "Nights B"
}

function formatStatusLabel(status?: string | null) {
  if (!status || status === "Scheduled") return ""
  if (status === "Vacation") return "Vac"
  if (status === "Training") return "Trng"
  if (status === "Professional Leave") return "Prof"
  if (status === "Bereavement") return "BRVMT"
  if (status === "Call Out") return "Call"
  return status
}

export function OvertimePage({
  employees,
  patrolRows,
  patrolOverrideRows,
  setPatrolOverrideRows,
  detailRecords,
  forceHistory,
  setForceHistory,
  overtimeQueueIds,
  setOvertimeQueueIds,
  overtimeShiftRequests,
  setOvertimeShiftRequests,
  onOpenNotificationsForShiftIds,
  onOpenPatrolTimeOffPicker,
  onQueueAssignmentNotice,
  onAuditEvent
}: OvertimePageProps) {
  const queueSectionRef = useRef<HTMLDivElement | null>(null)
  const [selectedQueueShiftId, setSelectedQueueShiftId] = useState<string | null>(null)
  const [queueSelectMode, setQueueSelectMode] = useState(false)
  const [selectedQueueShiftIds, setSelectedQueueShiftIds] = useState<string[]>([])
  const [manualAssignRequestId, setManualAssignRequestId] = useState<string | null>(null)
  const [manualAssignEmployeeId, setManualAssignEmployeeId] = useState<string>("")
  const [manualAssignSplitHours, setManualAssignSplitHours] = useState(false)
  const [manualAssignHours, setManualAssignHours] = useState("")
  const [queueRecipientPickerOpen, setQueueRecipientPickerOpen] = useState(false)
  const [selectedNotificationRecipientIds, setSelectedNotificationRecipientIds] = useState<string[]>([])
  const [forceAssignRequestId, setForceAssignRequestId] = useState<string | null>(null)
  const [forceAssignEmployeeId, setForceAssignEmployeeId] = useState<string>("")
  const [layoutPreview, setLayoutPreview] = useState<PreviewLayout>("preview1")
  const [builderEmployeeId, setBuilderEmployeeId] = useState<string>("")
  const [builderSelectionMode, setBuilderSelectionMode] = useState<BuilderSelectionMode>("multiple")
  const [builderReason, setBuilderReason] = useState<string>("Vacation")
  const [builderScheduleRows, setBuilderScheduleRows] = useState<PatrolScheduleRow[]>([])
  const [builderMonthAnchor, setBuilderMonthAnchor] = useState(() => {
    const today = new Date()
    return new Date(today.getFullYear(), today.getMonth(), 1)
  })
  const [builderSelectedShiftKeys, setBuilderSelectedShiftKeys] = useState<string[]>([])
  const [builderCalendarOpen, setBuilderCalendarOpen] = useState(false)
  const [undoStack, setUndoStack] = useState<
    Array<{
      patrolOverrideRows: PatrolScheduleRow[]
      overtimeShiftRequests: OvertimeShiftRequest[]
      overtimeQueueIds: string[]
      forceHistory: ForceHistoryRow[]
    }>
  >([])
  const employeeMap = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee])),
    [employees]
  )
  const effectivePatrolRows = useMemo(() => {
    const merged = new Map<string, PatrolScheduleRow>()

    for (const row of patrolRows) {
      merged.set(`${row.assignment_date}-${row.shift_type}-${row.position_code}`, row)
    }

    for (const row of patrolOverrideRows) {
      merged.set(`${row.assignment_date}-${row.shift_type}-${row.position_code}`, row)
    }

    return Array.from(merged.values())
  }, [patrolOverrideRows, patrolRows])
  const employeePatrolRowsByDate = useMemo(() => {
    const grouped = new Map<string, PatrolScheduleRow[]>()

    for (const row of effectivePatrolRows) {
      if (!row.employee_id) continue
      const key = `${row.assignment_date}-${row.employee_id}`
      const current = grouped.get(key) || []
      current.push(row)
      grouped.set(key, current)
    }

    return grouped
  }, [effectivePatrolRows])
  const replacementAssignmentsByDate = useMemo(() => {
    const grouped = new Map<string, PatrolScheduleRow[]>()

    for (const row of effectivePatrolRows) {
      if (!row.replacement_employee_id) continue
      const key = `${row.assignment_date}-${row.replacement_employee_id}`
      const current = grouped.get(key) || []
      current.push(row)
      grouped.set(key, current)
    }

    return grouped
  }, [effectivePatrolRows])
  const detailAssignmentsByDate = useMemo(() => {
    const assigned = new Set<string>()

    for (const record of detailRecords) {
      if (record.status !== "Assigned" && record.status !== "Accepted") continue
      assigned.add(`${record.date}-${record.employeeId}`)
    }

    return assigned
  }, [detailRecords])
  const overtimeQueueList = useMemo(() => {
    const queuedEmployees = overtimeQueueIds
      .map((employeeId) => employeeMap.get(employeeId))
      .filter((employee): employee is Employee => Boolean(employee))

    const missingActiveEmployees = employees
      .filter((employee) => employee.status === "Active" && !overtimeQueueIds.includes(employee.id))
      .sort((a, b) => a.hireDate.localeCompare(b.hireDate))

    return [...queuedEmployees, ...missingActiveEmployees]
  }, [employeeMap, employees, overtimeQueueIds])
  const activeEmployees = useMemo(
    () =>
      employees
        .filter((employee) => employee.status === "Active")
        .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)),
    [employees]
  )
  const alphabeticalEmployees = useMemo(
    () =>
      [...activeEmployees].sort(
        (a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)
      ),
    [activeEmployees]
  )
  const builderEmployee = useMemo(
    () => alphabeticalEmployees.find((employee) => employee.id === builderEmployeeId) || null,
    [alphabeticalEmployees, builderEmployeeId]
  )
  const builderEffectiveRows = useMemo(
    () => mergePatrolRows(builderScheduleRows, patrolOverrideRows),
    [builderScheduleRows, patrolOverrideRows]
  )
  const builderMonthRows = useMemo(() => {
    if (!builderEmployeeId) return []

    const monthStart = new Date(builderMonthAnchor.getFullYear(), builderMonthAnchor.getMonth(), 1)
    const monthEnd = new Date(builderMonthAnchor.getFullYear(), builderMonthAnchor.getMonth() + 1, 0)
    const startIso = monthStart.toISOString().slice(0, 10)
    const endIso = monthEnd.toISOString().slice(0, 10)

    return builderEffectiveRows
      .filter((row) => row.employee_id === builderEmployeeId)
      .filter((row) => row.assignment_date >= startIso && row.assignment_date <= endIso)
      .sort((a, b) => {
        if (a.assignment_date !== b.assignment_date) return a.assignment_date.localeCompare(b.assignment_date)
        if (a.shift_type !== b.shift_type) return a.shift_type.localeCompare(b.shift_type)
        return a.position_code.localeCompare(b.position_code)
      })
  }, [builderEffectiveRows, builderEmployeeId, builderMonthAnchor])
  const builderRowByKey = useMemo(
    () => new Map(builderEffectiveRows.map((row) => [getPatrolRowKey(row), row])),
    [builderEffectiveRows]
  )
  const builderSelectedShiftKeySet = useMemo(
    () => new Set(builderSelectedShiftKeys),
    [builderSelectedShiftKeys]
  )
  const builderSelectedRows = useMemo(
    () => builderMonthRows.filter((row) => builderSelectedShiftKeys.includes(getPatrolRowKey(row))),
    [builderMonthRows, builderSelectedShiftKeys]
  )
  const builderMonthGrid = useMemo(() => buildMonthGrid(builderMonthAnchor), [builderMonthAnchor])
  const builderWeekRows = useMemo(() => chunkDates(builderMonthGrid, 7), [builderMonthGrid])
  const queueIndexByEmployeeId = useMemo(
    () => new Map(overtimeQueueList.map((employee, index) => [employee.id, index])),
    [overtimeQueueList]
  )
  const forceRotationList = useMemo(
    () => buildForceRotationOrder(activeEmployees, forceHistory),
    [activeEmployees, forceHistory]
  )

  const patrolTimeOffFeed = useMemo(
    () =>
      overtimeShiftRequests
        .filter((request) => request.source === "Patrol Open Shift" && request.status !== "Closed")
        .sort((a, b) => {
          if (a.assignmentDate !== b.assignmentDate) return a.assignmentDate.localeCompare(b.assignmentDate)
          if (a.shiftType !== b.shiftType) return a.shiftType.localeCompare(b.shiftType)
          return a.positionCode.localeCompare(b.positionCode)
        }),
    [overtimeShiftRequests]
  )
  const nextUpEmployee = overtimeQueueList[0] || null
  const assignedQueueShifts = useMemo(
    () =>
      patrolTimeOffFeed.filter(
        (request) => request.status === "Assigned" && Boolean(request.assignedEmployeeId)
      ),
    [patrolTimeOffFeed]
  )

  const overtimeShiftQueue = useMemo(() => {
    const groupedRequests = new Map<string, OvertimeShiftRequest[]>()

    for (const request of patrolTimeOffFeed.filter((entry) => entry.status === "Open")) {
      const key = `${request.assignmentDate}-${request.shiftType}`
      const current = groupedRequests.get(key) || []
      current.push(request)
      groupedRequests.set(key, current)
    }

    return patrolTimeOffFeed.filter((request) => {
      if (request.manuallyQueued) return true

      const peerRequests = groupedRequests.get(`${request.assignmentDate}-${request.shiftType}`) || []
      const totalStaffingSlots = 5
      const totalSupervisorSlots = 2
      const offCount = peerRequests.length
      const supervisorOffCount = peerRequests.filter(
        (peerRequest) => peerRequest.positionCode === "SUP1" || peerRequest.positionCode === "SUP2"
      ).length
      const remainingStaffing = totalStaffingSlots - offCount
      const remainingSupervisors = totalSupervisorSlots - supervisorOffCount

      return remainingSupervisors < 1 || remainingStaffing < 4
    })
  }, [patrolTimeOffFeed])

  const interestedRespondersByQueue = useMemo(
    () =>
      overtimeShiftQueue.map((request) => {
        const responders = request.responses
          .filter((response) => response.status === "Interested")
          .map((response) => ({
            response,
            employee: employeeMap.get(response.employeeId) || null
          }))

        return {
          request,
          responders
        }
      }),
    [employeeMap, overtimeShiftQueue]
  )
  const selectedQueueEntry = useMemo(
    () => interestedRespondersByQueue.find(({ request }) => request.id === selectedQueueShiftId) || null,
    [interestedRespondersByQueue, selectedQueueShiftId]
  )

  useEffect(() => {
    if (overtimeShiftQueue.length === 0) {
      setSelectedQueueShiftId(null)
      setSelectedQueueShiftIds([])
      return
    }

    setSelectedQueueShiftId((current) => {
      if (current && overtimeShiftQueue.some((request) => request.id === current)) {
        return current
      }

      return overtimeShiftQueue[0]?.id || null
    })
  }, [overtimeShiftQueue])

  useEffect(() => {
    let active = true

    async function loadBuilderMonth() {
      const monthStart = new Date(builderMonthAnchor.getFullYear(), builderMonthAnchor.getMonth(), 1)
      const monthEnd = new Date(builderMonthAnchor.getFullYear(), builderMonthAnchor.getMonth() + 1, 0)
      const startIso = monthStart.toISOString().slice(0, 10)
      const endIso = monthEnd.toISOString().slice(0, 10)

      await ensureMonthSchedule(builderMonthAnchor)
      const { data, error } = await fetchPatrolScheduleRange(startIso, endIso)

      if (!active) return

      if (error) {
        console.error("Failed to load builder patrol month:", error)
        setBuilderScheduleRows([])
        return
      }

      setBuilderScheduleRows((data || []) as PatrolScheduleRow[])
    }

    void loadBuilderMonth()

    return () => {
      active = false
    }
  }, [builderMonthAnchor])

  function toggleQueueShiftSelection(requestId: string) {
    setSelectedQueueShiftIds((current) =>
      current.includes(requestId)
        ? current.filter((id) => id !== requestId)
        : [...current, requestId]
    )
  }

  function toggleQueueSelectMode() {
    setQueueSelectMode((current) => {
      if (current) {
        setSelectedQueueShiftIds([])
      }

      return !current
    })
  }

  function selectAllQueueShifts() {
    if (!queueSelectMode) {
      setQueueSelectMode(true)
    }

    setSelectedQueueShiftIds(overtimeShiftQueue.map((request) => request.id))
  }

  function toggleNotificationRecipient(employeeId: string) {
    setSelectedNotificationRecipientIds((current) =>
      current.includes(employeeId)
        ? current.filter((id) => id !== employeeId)
        : [...current, employeeId]
    )
  }

  function resetBuilderSelection(nextEmployeeId = builderEmployeeId) {
    setBuilderEmployeeId(nextEmployeeId)
    setBuilderSelectedShiftKeys([])
    setBuilderReason("Vacation")
    setBuilderSelectionMode("multiple")
    setBuilderCalendarOpen(false)
  }

  function shiftBuilderMonth(offset: number) {
    setBuilderMonthAnchor((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1))
    setBuilderSelectedShiftKeys([])
  }

  function toggleBuilderShiftSelection(row: PatrolScheduleRow) {
    const rowKey = getPatrolRowKey(row)

    setBuilderSelectedShiftKeys((current) => {
      if (builderSelectionMode === "single") {
        return current.includes(rowKey) ? [] : [rowKey]
      }

      if (builderSelectionMode === "month") {
        const monthKeys = builderMonthRows.map((entry) => getPatrolRowKey(entry))
        const next = current.includes(rowKey)
          ? monthKeys.filter((key) => key !== rowKey && current.includes(key))
          : [...new Set([...monthKeys, rowKey])]
        return next
      }

      return current.includes(rowKey)
        ? current.filter((key) => key !== rowKey)
        : [...current, rowKey]
    })
  }

  function setBuilderMode(mode: BuilderSelectionMode) {
    setBuilderSelectionMode(mode)

    if (mode === "multiple" && builderEmployeeId) {
      onOpenPatrolTimeOffPicker(builderEmployeeId)
      return
    }

    if (mode === "month") {
      setBuilderSelectedShiftKeys(builderMonthRows.map((row) => getPatrolRowKey(row)))
      if (builderEmployeeId) {
        setBuilderCalendarOpen(true)
      }
      return
    }

    if (mode === "single" && builderSelectedShiftKeys.length > 1) {
      setBuilderSelectedShiftKeys(builderSelectedShiftKeys.slice(0, 1))
    }

    if (builderEmployeeId) {
      setBuilderCalendarOpen(true)
    }
  }

  async function saveBuilderTimeOffSelection() {
    if (!builderEmployee || builderSelectedRows.length === 0) {
      window.alert("Choose an employee and at least one scheduled shift first.")
      return
    }

    const rowsToApply = builderSelectedRows.map((row) => ({
      ...row,
      vehicle: builderEmployee.defaultVehicle || row.vehicle,
      shift_hours: row.shift_hours || builderEmployee.defaultShiftHours,
      status: builderReason,
      replacement_employee_id: null,
      replacement_vehicle: null,
      replacement_hours: row.shift_hours || builderEmployee.defaultShiftHours
    }))

    const createdAt = new Date().toISOString()
    const nextRequests: OvertimeShiftRequest[] = rowsToApply.map((row) => ({
      id: buildPatrolOvertimeRequestId(row.assignment_date, row.shift_type as ShiftType, row.position_code as PatrolPositionCode),
      source: "Patrol Open Shift",
      assignmentDate: row.assignment_date,
      shiftType: row.shift_type as ShiftType,
      positionCode: row.position_code as PatrolPositionCode,
      description: `${formatQueuePositionLabel(row.position_code as OvertimeShiftRequest["positionCode"])} time off`,
      offEmployeeId: builderEmployee.id,
      offEmployeeLastName: builderEmployee.lastName,
      offHours: row.shift_hours || builderEmployee.defaultShiftHours,
      offReason: builderReason,
      selectionActive: true,
      workflowStatus: "Open",
      status: "Open",
      assignedEmployeeId: null,
      createdAt,
      responses: []
    }))

    pushUndoSnapshot()
    setPatrolOverrideRows((current) => mergePatrolRows(current, rowsToApply))
    setOvertimeShiftRequests((current) => {
      const next = [...current]

      for (const request of nextRequests) {
        const index = next.findIndex((entry) => entry.id === request.id)
        if (index >= 0) {
          next[index] = {
            ...next[index],
            ...request,
            createdAt: next[index].createdAt || request.createdAt,
            responses: next[index].responses || []
          }
        } else {
          next.push(request)
        }
      }

      return next
    })

    invalidatePatrolScheduleCache()
    onAuditEvent(
      "Overtime Builder Time Off Saved",
      `Saved ${builderReason} for ${builderEmployee.firstName} ${builderEmployee.lastName}.`,
      `${rowsToApply.map((row) => `${row.assignment_date} ${row.shift_type} ${formatQueuePositionLabel(row.position_code as OvertimeShiftRequest["positionCode"])}`).join(" | ")}`
    )

    setBuilderSelectedShiftKeys([])
    setBuilderCalendarOpen(false)

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
            assigned_hours: request.assignedHours || null,
            selection_active: true,
            manually_queued: request.manuallyQueued ?? false,
            auto_assign_reason: request.autoAssignReason || null,
            workflow_status: "Open",
            status: "Open",
            assigned_employee_id: null,
            created_at: request.createdAt,
            responses: request.responses
          })),
          { onConflict: "id" }
        )
    ]).catch((error) => {
      console.error("Failed to save overtime builder time off selection:", error)
      window.setTimeout(() => {
        alert("Time off saved locally, but the cloud update was delayed. Refresh in a moment if needed.")
      }, 0)
    })
  }

  function pushUndoSnapshot() {
    setUndoStack((current) => [
      ...current.slice(-9),
      {
        patrolOverrideRows: patrolOverrideRows.map((row) => ({ ...row })),
        overtimeShiftRequests: overtimeShiftRequests.map((request) => ({
          ...request,
          responses: request.responses.map((response) => ({ ...response }))
        })),
        overtimeQueueIds: [...overtimeQueueIds],
        forceHistory: forceHistory.map((row) => ({ ...row }))
      }
    ])
  }

  function undoLastQueueAction() {
    const snapshot = undoStack[undoStack.length - 1]
    if (!snapshot) {
      window.alert("No overtime queue action is available to undo.")
      return
    }

    setPatrolOverrideRows(snapshot.patrolOverrideRows)
    setOvertimeShiftRequests(snapshot.overtimeShiftRequests)
    setOvertimeQueueIds(snapshot.overtimeQueueIds)
    setForceHistory(snapshot.forceHistory)
    setUndoStack((current) => current.slice(0, -1))
    invalidatePatrolScheduleCache()
    onAuditEvent("Overtime Undo", "Reverted the latest overtime queue action.")
  }

  function employeeIsSupervisor(employee: Employee) {
    return employee.rank === "Sgt"
  }

  async function syncForceHistoryForEmployees(nextRows: ForceHistoryRow[], employeeIds: string[]) {
    for (const employeeId of employeeIds) {
      await supabase
        .from("force_history")
        .delete()
        .eq("employee_id", employeeId)

      const employeeRows = nextRows.filter((row) => row.employee_id === employeeId)
      if (employeeRows.length > 0) {
        await supabase
          .from("force_history")
          .insert(
            employeeRows.map((row) => ({
              employee_id: row.employee_id,
              forced_date: row.forced_date
            }))
          )
      }
    }
  }

  function employeeCanWorkOvertimeShift(
    employee: Employee,
    request: OvertimeShiftRequest,
    reservedAssignmentsByDate: Set<string>,
    requiresSupervisor: boolean
  ) {
    if (requiresSupervisor && !employeeIsSupervisor(employee)) {
      return false
    }

    const employeeDateKey = `${request.assignmentDate}-${employee.id}`

    if (reservedAssignmentsByDate.has(employeeDateKey)) {
      return false
    }

    if (detailAssignmentsByDate.has(employeeDateKey)) {
      return false
    }

    const ownRows = employeePatrolRowsByDate.get(employeeDateKey) || []
    const hasScheduledOwnShift = ownRows.some((row) => !row.status || row.status === "Scheduled")
    const hasOffOwnShift = ownRows.some((row) => Boolean(row.status) && row.status !== "Scheduled" && row.status !== "Open Shift")

    if (hasScheduledOwnShift && !hasOffOwnShift) {
      return false
    }

    const replacementRows = replacementAssignmentsByDate.get(employeeDateKey) || []
    if (replacementRows.length > 0) {
      return false
    }

    return true
  }

  function getForceEligibility(
    employee: Employee,
    request: OvertimeShiftRequest
  ): { eligible: boolean; reason: string } {
    const targetDate = new Date(`${request.assignmentDate}T12:00:00`)
    const previousDate = new Date(targetDate)
    previousDate.setDate(previousDate.getDate() - 1)
    const nextDate = new Date(targetDate)
    nextDate.setDate(nextDate.getDate() + 1)

    const windows =
      request.shiftType === "Days"
        ? [
            { date: request.assignmentDate, shiftType: "Days" as const, label: "scheduled on the selected shift" },
            { date: previousDate.toISOString().slice(0, 10), shiftType: "Nights" as const, label: "scheduled in the previous 12 hours" },
            { date: request.assignmentDate, shiftType: "Nights" as const, label: "scheduled in the next 12 hours" }
          ]
        : [
            { date: request.assignmentDate, shiftType: "Nights" as const, label: "scheduled on the selected shift" },
            { date: request.assignmentDate, shiftType: "Days" as const, label: "scheduled in the previous 12 hours" },
            { date: nextDate.toISOString().slice(0, 10), shiftType: "Days" as const, label: "scheduled in the next 12 hours" }
          ]

    for (const window of windows) {
      const matchingRow = effectivePatrolRows.find(
        (row) =>
          row.assignment_date === window.date &&
          row.shift_type === window.shiftType &&
          row.employee_id === employee.id
      )

      if (!matchingRow) continue

      if (!matchingRow.status || matchingRow.status === "Scheduled") {
        return { eligible: false, reason: `${employee.firstName} ${employee.lastName} is ${window.label}.` }
      }

      if (matchingRow.status !== "Open Shift") {
        return { eligible: false, reason: `${employee.firstName} ${employee.lastName} is marked ${matchingRow.status} during that time.` }
      }
    }

    const replacementConflict = effectivePatrolRows.find(
      (row) =>
        row.replacement_employee_id === employee.id &&
        ((row.assignment_date === request.assignmentDate && row.shift_type === request.shiftType) ||
          (request.shiftType === "Days" &&
            ((row.assignment_date === previousDate.toISOString().slice(0, 10) && row.shift_type === "Nights") ||
              (row.assignment_date === request.assignmentDate && row.shift_type === "Nights"))) ||
          (request.shiftType === "Nights" &&
            ((row.assignment_date === request.assignmentDate && row.shift_type === "Days") ||
              (row.assignment_date === nextDate.toISOString().slice(0, 10) && row.shift_type === "Days"))))
    )

    if (replacementConflict) {
      return { eligible: false, reason: `${employee.firstName} ${employee.lastName} is already working nearby hours.` }
    }

    return { eligible: true, reason: "Eligible to be forced." }
  }

  async function applyForceAssignment(requestId: string, employeeId: string) {
    const request = overtimeShiftRequests.find((entry) => entry.id === requestId)
    const employee = employeeMap.get(employeeId)
    if (!request || !employee) return

    const assigned = assignRequestToEmployee(requestId, employeeId, "Force Assignment", { force: true })
    if (!assigned) return

    const today = new Date().toISOString().slice(0, 10)
    const nextForceRows = [{ employee_id: employeeId, forced_date: today }, ...forceHistory]
    setForceHistory(nextForceRows)
    await syncForceHistoryForEmployees(nextForceRows, [employeeId])

    onAuditEvent(
      "Force Assignment Applied",
      `Forced ${employee.firstName} ${employee.lastName} into ${request.assignmentDate} ${request.shiftType}.`,
      `${formatQueuePositionLabel(request.positionCode)} | ${request.offEmployeeLastName || "Unknown employee"}`
    )
    setForceAssignRequestId(null)
    setForceAssignEmployeeId("")
  }

  function assignRequestToEmployee(
    requestId: string,
    employeeId: string,
    reason: NonNullable<OvertimeShiftRequest["autoAssignReason"]>,
    options?: { force?: boolean; assignedHours?: string | null }
  ) {
    const request = overtimeShiftRequests.find((entry) => entry.id === requestId)
    const employee = employeeMap.get(employeeId)

    if (!request || !employee) {
      return false
    }
    const assignedHours = options?.assignedHours?.trim() || request.offHours || employee.defaultShiftHours

    const sameShiftRequests = overtimeShiftRequests.filter(
      (entry) =>
        entry.status === "Open" &&
        entry.assignmentDate === request.assignmentDate &&
        entry.shiftType === request.shiftType
    )
    const bothSupervisorsOff =
      sameShiftRequests.filter((entry) => entry.positionCode === "SUP1" || entry.positionCode === "SUP2").length >= 2

    if (!options?.force) {
      const isEligible = employeeCanWorkOvertimeShift(
        employee,
        request,
        new Set<string>(),
        bothSupervisorsOff
      )

      if (!isEligible) {
        return false
      }
    }

    pushUndoSnapshot()

    setPatrolOverrideRows((current) => {
      const next = [...current]
      const baseRow =
        next.find(
          (row) =>
            row.assignment_date === request.assignmentDate &&
            row.shift_type === request.shiftType &&
            row.position_code === request.positionCode
        ) ||
        effectivePatrolRows.find(
          (row) =>
            row.assignment_date === request.assignmentDate &&
            row.shift_type === request.shiftType &&
            row.position_code === request.positionCode
        )

      if (!baseRow) {
        return current
      }

      const replacementRow: PatrolScheduleRow = {
        ...baseRow,
        replacement_employee_id: employee.id,
        replacement_vehicle: employee.defaultVehicle,
        replacement_hours: assignedHours || baseRow.shift_hours
      }

      const existingIndex = next.findIndex(
        (row) =>
          row.assignment_date === replacementRow.assignment_date &&
          row.shift_type === replacementRow.shift_type &&
          row.position_code === replacementRow.position_code
      )

      if (existingIndex >= 0) {
        next[existingIndex] = replacementRow
      } else {
        next.push(replacementRow)
      }

      return next
    })

    setOvertimeShiftRequests((current) =>
      current.map((entry) =>
        entry.id === requestId
          ? {
              ...entry,
              assignedEmployeeId: employee.id,
              assignedHours,
              autoAssignReason: reason,
              status: "Assigned",
              responses: entry.responses.map((response) =>
                response.employeeId === employee.id
                  ? { ...response, status: "Assigned", updatedAt: new Date().toISOString() }
                  : response
              )
            }
          : entry
      )
    )

    setOvertimeQueueIds((current) => rotateQueueAfterAssignment(current, employee.id))
    invalidatePatrolScheduleCache()
    onQueueAssignmentNotice(requestId, employeeId)
    return true
  }

  function rotateQueueAfterAssignment(currentQueue: string[], chosenEmployeeId: string) {
    const chosenIndex = currentQueue.indexOf(chosenEmployeeId)

    if (chosenIndex < 0) {
      return currentQueue
    }

    const beforeChosen = currentQueue.slice(0, chosenIndex)
    const afterChosen = currentQueue.slice(chosenIndex + 1)

    return [...afterChosen, ...beforeChosen, chosenEmployeeId]
  }

  function autoAssignQueueShifts(targetRequestIds?: string[]) {
    const pendingRequests = overtimeShiftQueue
      .filter((request) => request.status === "Open")
      .filter((request) => !targetRequestIds || targetRequestIds.includes(request.id))

    if (pendingRequests.length === 0) {
      window.alert("No open queue shifts are available to auto assign.")
      return
    }

    pushUndoSnapshot()

    let queueOrder = overtimeQueueList.map((employee) => employee.id)
    const reservedAssignmentsByDate = new Set<string>()
    const assignmentUpdates = new Map<
      string,
      {
        employeeId: string
        employeeName: string
        reason: NonNullable<OvertimeShiftRequest["autoAssignReason"]>
      }
    >()

    const offSupervisorCountByShift = new Map<string, number>()
    for (const request of pendingRequests) {
      const key = `${request.assignmentDate}-${request.shiftType}`
      const current = offSupervisorCountByShift.get(key) || 0
      offSupervisorCountByShift.set(
        key,
        current + (request.positionCode === "SUP1" || request.positionCode === "SUP2" ? 1 : 0)
      )
    }

    let unassignedRequests = [...pendingRequests]

    while (unassignedRequests.length > 0) {
      const requestContexts = unassignedRequests.map((request) => {
        const shiftKey = `${request.assignmentDate}-${request.shiftType}`
        const requiresSupervisor = (offSupervisorCountByShift.get(shiftKey) || 0) >= 2
        const eligibleResponders = request.responses
          .filter((response) => response.status === "Interested" || response.status === "Accepted")
          .map((response) => ({
            response,
            employee: employeeMap.get(response.employeeId) || null
          }))
          .filter(
            (entry): entry is { response: OvertimeShiftRequest["responses"][number]; employee: Employee } =>
              Boolean(entry.employee)
          )
          .filter(({ employee }) =>
            employeeCanWorkOvertimeShift(employee, request, reservedAssignmentsByDate, requiresSupervisor)
          )

        return {
          request,
          requiresSupervisor,
          eligibleResponders
        }
      })

      const assignableContexts = requestContexts.filter((context) => context.eligibleResponders.length > 0)
      if (assignableContexts.length === 0) {
        break
      }

      assignableContexts.sort((a, b) => {
        if (a.requiresSupervisor !== b.requiresSupervisor) return a.requiresSupervisor ? -1 : 1
        if (a.eligibleResponders.length !== b.eligibleResponders.length) {
          return a.eligibleResponders.length - b.eligibleResponders.length
        }
        if (a.request.assignmentDate !== b.request.assignmentDate) {
          return a.request.assignmentDate.localeCompare(b.request.assignmentDate)
        }
        if (a.request.shiftType !== b.request.shiftType) {
          return a.request.shiftType.localeCompare(b.request.shiftType)
        }
        return a.request.positionCode.localeCompare(b.request.positionCode)
      })

      const selectedContext = assignableContexts[0]
      const availabilityCountByEmployee = new Map<string, number>()

      for (const context of assignableContexts) {
        for (const { employee } of context.eligibleResponders) {
          availabilityCountByEmployee.set(employee.id, (availabilityCountByEmployee.get(employee.id) || 0) + 1)
        }
      }

      const queueOrderedResponders = [...selectedContext.eligibleResponders].sort((a, b) => {
        const aQueueIndex = queueOrder.indexOf(a.employee.id)
        const bQueueIndex = queueOrder.indexOf(b.employee.id)
        if (aQueueIndex !== bQueueIndex) return aQueueIndex - bQueueIndex

        if (a.response.status !== b.response.status) {
          return a.response.status === "Accepted" ? -1 : 1
        }

        const aOriginalIndex = queueIndexByEmployeeId.get(a.employee.id) ?? Number.MAX_SAFE_INTEGER
        const bOriginalIndex = queueIndexByEmployeeId.get(b.employee.id) ?? Number.MAX_SAFE_INTEGER
        if (aOriginalIndex !== bOriginalIndex) return aOriginalIndex - bOriginalIndex

        return a.employee.hireDate.localeCompare(b.employee.hireDate)
      })

      const checkmarkResponder = queueOrderedResponders[0]
      const checkmarkAvailability = availabilityCountByEmployee.get(checkmarkResponder.employee.id) || 0
      const fairnessResponder =
        checkmarkAvailability > 1
          ? queueOrderedResponders.find(({ employee, response }) => {
              const opportunityCount = availabilityCountByEmployee.get(employee.id) || 0
              if (opportunityCount !== 1) return false
              return response.status === "Accepted" || response.status === "Interested"
            }) || null
          : null

      const chosenResponder = fairnessResponder || checkmarkResponder
      const assignmentReason: NonNullable<OvertimeShiftRequest["autoAssignReason"]> =
        selectedContext.requiresSupervisor
          ? "Supervisor Required"
          : fairnessResponder
            ? "Fairness Override"
            : "Checkmark Priority"

      assignmentUpdates.set(selectedContext.request.id, {
        employeeId: chosenResponder.employee.id,
        employeeName: `${chosenResponder.employee.firstName} ${chosenResponder.employee.lastName}`,
        reason: assignmentReason
      })
      reservedAssignmentsByDate.add(`${selectedContext.request.assignmentDate}-${chosenResponder.employee.id}`)
      queueOrder = rotateQueueAfterAssignment(queueOrder, chosenResponder.employee.id)
      unassignedRequests = unassignedRequests.filter((request) => request.id !== selectedContext.request.id)
    }

    if (assignmentUpdates.size === 0) {
      window.alert("No eligible interested responders were available for the selected queue shifts.")
      return
    }

    setPatrolOverrideRows((current) => {
      const next = [...current]

      for (const request of pendingRequests) {
        const update = assignmentUpdates.get(request.id)
        if (!update) continue

        const employee = employeeMap.get(update.employeeId)
        if (!employee) continue

        const baseRow =
          next.find(
            (row) =>
              row.assignment_date === request.assignmentDate &&
              row.shift_type === request.shiftType &&
              row.position_code === request.positionCode
          ) ||
          effectivePatrolRows.find(
            (row) =>
              row.assignment_date === request.assignmentDate &&
              row.shift_type === request.shiftType &&
              row.position_code === request.positionCode
          )

        if (!baseRow) continue

        const replacementRow: PatrolScheduleRow = {
          ...baseRow,
          replacement_employee_id: employee.id,
          replacement_vehicle: employee.defaultVehicle,
          replacement_hours: employee.defaultShiftHours || request.offHours || baseRow.shift_hours
        }

        const existingIndex = next.findIndex(
          (row) =>
            row.assignment_date === replacementRow.assignment_date &&
            row.shift_type === replacementRow.shift_type &&
            row.position_code === replacementRow.position_code
        )

        if (existingIndex >= 0) {
          next[existingIndex] = replacementRow
        } else {
          next.push(replacementRow)
        }
      }

      return next
    })

    setOvertimeShiftRequests((current) =>
      current.map((request) => {
        const update = assignmentUpdates.get(request.id)
        if (!update) return request

        return {
          ...request,
          assignedEmployeeId: update.employeeId,
          autoAssignReason: update.reason,
          status: "Assigned",
          responses: request.responses.map((response) =>
            response.employeeId === update.employeeId
              ? { ...response, status: "Assigned", updatedAt: new Date().toISOString() }
              : response
          )
        }
      })
    )

    setOvertimeQueueIds(queueOrder)
    invalidatePatrolScheduleCache()

    const summary = pendingRequests
      .map((request) => {
        const update = assignmentUpdates.get(request.id)
        if (!update) return null
        return `${request.assignmentDate} ${request.shiftType} ${formatQueuePositionLabel(request.positionCode)} -> ${update.employeeName}`
      })
      .filter((value): value is string => Boolean(value))

    onAuditEvent(
      "Auto Assigned Overtime Queue",
      `Auto assigned ${assignmentUpdates.size} queue shift${assignmentUpdates.size === 1 ? "" : "s"}.`,
      summary.join(" | ")
    )
    for (const [requestId, update] of assignmentUpdates.entries()) {
      onQueueAssignmentNotice(requestId, update.employeeId)
    }

    if (queueSelectMode) {
      setSelectedQueueShiftIds((current) =>
        current.filter((requestId) => !assignmentUpdates.has(requestId))
      )
    }
  }

  function saveManualAssignment(requestId: string) {
    if (!manualAssignEmployeeId) {
      window.alert("Choose an employee first.")
      return
    }

    const didAssign = assignRequestToEmployee(requestId, manualAssignEmployeeId, "Manual Assignment", {
      assignedHours: manualAssignSplitHours ? manualAssignHours : null
    })
    if (!didAssign) {
      window.alert("That employee cannot be assigned under the normal rules. Use Manual Assign if you want to override them.")
      return
    }

    const employee = employeeMap.get(manualAssignEmployeeId)
    const request = overtimeShiftRequests.find((entry) => entry.id === requestId)
    if (employee && request) {
      onAuditEvent(
        "Manual Overtime Assignment",
        `Assigned ${employee.firstName} ${employee.lastName} to ${request.assignmentDate} ${request.shiftType}.`,
        `${formatQueuePositionLabel(request.positionCode)} | ${request.offEmployeeLastName || "Unknown employee"}`
      )
    }

    setManualAssignRequestId(null)
    setManualAssignEmployeeId("")
    setManualAssignSplitHours(false)
    setManualAssignHours("")
  }

  function forceManualAssignment(requestId: string) {
    if (!manualAssignEmployeeId) {
      window.alert("Choose an employee first.")
      return
    }

    const shouldForce = window.confirm("Manual assign this employee even if the normal overtime rules would block it?")
    if (!shouldForce) return

    const didAssign = assignRequestToEmployee(requestId, manualAssignEmployeeId, "Force Assignment", {
      force: true,
      assignedHours: manualAssignSplitHours ? manualAssignHours : null
    })
    if (!didAssign) {
      window.alert("That shift could not be manually assigned.")
      return
    }

    const employee = employeeMap.get(manualAssignEmployeeId)
    const request = overtimeShiftRequests.find((entry) => entry.id === requestId)
    if (employee && request) {
      onAuditEvent(
        "Force Overtime Assignment",
        `Manual override assigned ${employee.firstName} ${employee.lastName} to ${request.assignmentDate} ${request.shiftType}.`,
        `${formatQueuePositionLabel(request.positionCode)} | ${request.offEmployeeLastName || "Unknown employee"} | ${manualAssignSplitHours ? manualAssignHours : request.offHours || "Hours TBD"}`
      )
    }

    setManualAssignRequestId(null)
    setManualAssignEmployeeId("")
    setManualAssignSplitHours(false)
    setManualAssignHours("")
  }

  async function deletePatrolTimeOffFeedItem(request: OvertimeShiftRequest) {
    const shouldDelete = window.confirm(
      `Are you sure you want to delete this patrol time off item for ${request.assignmentDate}? This will also remove it from the Patrol calendar.`
    )

    if (!shouldDelete) return
    pushUndoSnapshot()

    const matchingRow =
      patrolOverrideRows.find(
        (row) =>
          row.assignment_date === request.assignmentDate &&
          row.shift_type === request.shiftType &&
          row.position_code === request.positionCode
      ) ||
      patrolRows.find(
        (row) =>
          row.assignment_date === request.assignmentDate &&
          row.shift_type === request.shiftType &&
          row.position_code === request.positionCode
      )

    if (matchingRow) {
      const revertedRow: PatrolScheduleRow = {
        ...matchingRow,
        status: "Scheduled",
        replacement_employee_id: null,
        replacement_vehicle: null,
        replacement_hours: matchingRow.shift_hours
      }

      setPatrolOverrideRows((current) => {
        const next = [...current]
        const existingIndex = next.findIndex(
          (row) =>
            row.assignment_date === revertedRow.assignment_date &&
            row.shift_type === revertedRow.shift_type &&
            row.position_code === revertedRow.position_code
        )

        if (existingIndex >= 0) {
          next[existingIndex] = revertedRow
          return next
        }

        return [...next, revertedRow]
      })

      try {
        if (matchingRow.id) {
          await supabase
            .from("patrol_schedule")
            .update({
              status: "Scheduled",
              replacement_employee_id: null,
              replacement_vehicle: null,
              replacement_hours: matchingRow.shift_hours
            })
            .eq("id", matchingRow.id)
        } else {
          await supabase
            .from("patrol_schedule")
            .upsert({
              assignment_date: matchingRow.assignment_date,
              shift_type: matchingRow.shift_type,
              position_code: matchingRow.position_code,
              employee_id: matchingRow.employee_id,
              vehicle: matchingRow.vehicle,
              shift_hours: matchingRow.shift_hours,
              status: "Scheduled",
              replacement_employee_id: null,
              replacement_vehicle: null,
              replacement_hours: matchingRow.shift_hours
            })
        }

        await supabase
          .from("patrol_overrides")
          .upsert({
            assignment_date: matchingRow.assignment_date,
            shift_type: matchingRow.shift_type,
            position_code: matchingRow.position_code,
            employee_id: matchingRow.employee_id,
            vehicle: matchingRow.vehicle,
            shift_hours: matchingRow.shift_hours,
            status: "Scheduled",
            replacement_employee_id: null,
            replacement_vehicle: null,
            replacement_hours: matchingRow.shift_hours,
            updated_at: new Date().toISOString()
          }, { onConflict: "assignment_date,shift_type,position_code" })
      } catch (error) {
        console.error("Failed to delete patrol time off from patrol schedule:", error)
      }

      invalidatePatrolScheduleCache()
    }

    setOvertimeShiftRequests((current) => current.filter((entry) => entry.id !== request.id))
    try {
      await supabase
        .from("overtime_shift_requests")
        .delete()
        .eq("id", request.id)
    } catch (error) {
      console.error("Failed to delete patrol time off overtime request:", error)
    }
    onAuditEvent(
      "Patrol Time Off Deleted",
      `Deleted patrol time off for ${request.assignmentDate} ${request.shiftType} ${request.positionCode}.`,
      `${request.offEmployeeLastName || "Unknown employee"} | Removed from patrol feed and patrol calendar`
    )
  }

  function returnAssignedShiftToQueue(request: OvertimeShiftRequest) {
    const assignedEmployee = request.assignedEmployeeId ? employeeMap.get(request.assignedEmployeeId) || null : null
    const shouldReturn = window.confirm(
      `Are you sure you want to return ${request.assignmentDate} ${request.shiftType} ${formatQueuePositionLabel(request.positionCode)} to the queue?`
    )

    if (!shouldReturn) return
    pushUndoSnapshot()

    setPatrolOverrideRows((current) => {
      const next = [...current]
      const baseRow =
        next.find(
          (row) =>
            row.assignment_date === request.assignmentDate &&
            row.shift_type === request.shiftType &&
            row.position_code === request.positionCode
        ) ||
        effectivePatrolRows.find(
          (row) =>
            row.assignment_date === request.assignmentDate &&
            row.shift_type === request.shiftType &&
            row.position_code === request.positionCode
        )

      if (!baseRow) {
        return current
      }

      const revertedRow: PatrolScheduleRow = {
        ...baseRow,
        replacement_employee_id: null,
        replacement_vehicle: null,
        replacement_hours: baseRow.shift_hours
      }

      const existingIndex = next.findIndex(
        (row) =>
          row.assignment_date === revertedRow.assignment_date &&
          row.shift_type === revertedRow.shift_type &&
          row.position_code === revertedRow.position_code
      )

      if (existingIndex >= 0) {
        next[existingIndex] = revertedRow
      } else {
        next.push(revertedRow)
      }

      return next
    })

    setOvertimeShiftRequests((current) =>
      current.map((entry) =>
        entry.id === request.id
          ? {
              ...entry,
              assignedEmployeeId: null,
              autoAssignReason: null,
              status: "Open",
              responses: entry.responses.map((response) =>
                response.employeeId === request.assignedEmployeeId && response.status === "Assigned"
                  ? { ...response, status: "Accepted", updatedAt: new Date().toISOString() }
                  : response
              )
              ,
              assignedHours: null
            }
          : entry
      )
    )

    if (request.assignedEmployeeId) {
      setOvertimeQueueIds((current) => {
        const withoutAssigned = current.filter((employeeId) => employeeId !== request.assignedEmployeeId)
        return [...withoutAssigned, request.assignedEmployeeId!]
      })
    }

    invalidatePatrolScheduleCache()
    setSelectedQueueShiftId(request.id)
    onAuditEvent(
      "Returned Overtime Shift To Queue",
      `Returned ${request.assignmentDate} ${request.shiftType} ${formatQueuePositionLabel(request.positionCode)} to the queue.`,
      assignedEmployee ? `Removed ${assignedEmployee.firstName} ${assignedEmployee.lastName} as replacement.` : undefined
    )
  }

  function sendSelectedQueueShiftsToNotifications() {
    if (selectedQueueShiftIds.length === 0) {
      window.alert("Select one or more queue shifts first.")
      return
    }

    setSelectedNotificationRecipientIds(activeEmployees.map((employee) => employee.id))
    setQueueRecipientPickerOpen(true)
  }

  function confirmSendSelectedQueueShiftsToNotifications() {
    confirmSendSelectedQueueShiftsToNotificationsWithRecipients(selectedNotificationRecipientIds)
  }

  function confirmSendSelectedQueueShiftsToNotificationsWithRecipients(recipientIds: string[]) {
    if (selectedQueueShiftIds.length === 0) {
      window.alert("Select one or more queue shifts first.")
      return
    }

    if (recipientIds.length === 0) {
      window.alert("Choose at least one employee to notify.")
      return
    }

    onOpenNotificationsForShiftIds(selectedQueueShiftIds, recipientIds)
    onAuditEvent(
      "Queue Shifts Sent To Notifications",
      `Opened Notifications with ${selectedQueueShiftIds.length} selected queue shift${selectedQueueShiftIds.length === 1 ? "" : "s"}.`,
      `Recipients: ${recipientIds.length}`
    )
    setQueueRecipientPickerOpen(false)
  }

  useEffect(() => {
    if (typeof window === "undefined") return
    if (window.location.hash !== "#overtime-queue") return

    const frame = window.requestAnimationFrame(() => {
      queueSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [])

  function toggleManualQueue(requestId: string) {
    setOvertimeShiftRequests((current) =>
      current.map((request) =>
        request.id === requestId
          ? { ...request, manuallyQueued: !request.manuallyQueued }
          : request
      )
    )
  }

  const workspaceCheckpointPanel = (
    <Card>
      <CardHeader>
        <CardTitle>Checkpoints</CardTitle>
      </CardHeader>
      <CardContent>
        <div style={{ display: "grid", gap: "10px" }}>
          <div style={{ fontSize: "12px", color: "#475569" }}>
            Draft: {builderSelectedRows.length} selected shift{builderSelectedRows.length === 1 ? "" : "s"}
          </div>
          <div style={{ fontSize: "12px", color: "#475569" }}>
            Saved undo points: {undoStack.length}
          </div>
          <div style={{ display: "grid", gap: "8px" }}>
            <button
              onClick={() => void saveBuilderTimeOffSelection()}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "none",
                background: builderSelectedRows.length === 0 ? "#cbd5e1" : "#2563eb",
                color: "#ffffff",
                fontWeight: 700,
                cursor: builderSelectedRows.length === 0 ? "not-allowed" : "pointer",
                fontSize: "12px"
              }}
            >
              Save To Patrol Feed
            </button>
            <button
              onClick={undoLastQueueAction}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "none",
                background: "#e2e8f0",
                color: "#0f172a",
                fontWeight: 700,
                cursor: "pointer",
                fontSize: "12px"
              }}
            >
              Undo Last Saved Change
            </button>
            <button
              onClick={() => setBuilderSelectedShiftKeys([])}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "none",
                background: "#f1f5f9",
                color: "#0f172a",
                fontWeight: 700,
                cursor: "pointer",
                fontSize: "12px"
              }}
            >
              Clear Current Selection
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  )

  const workspaceOrderPanel = (
    <Card>
      <CardHeader>
        <CardTitle>Overtime Order</CardTitle>
      </CardHeader>
      <CardContent>
        <div style={{ display: "grid", gap: "10px" }}>
          <select
            value={nextUpEmployee?.id || ""}
            onChange={() => undefined}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: "8px",
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              fontSize: "12px",
              fontWeight: 600
            }}
          >
            {overtimeQueueList.map((employee, index) => (
              <option key={employee.id} value={employee.id}>
                {index === 0 ? "✓ " : `${index + 1}. `}
                {employee.firstName} {employee.lastName} | {employee.rank}
              </option>
            ))}
          </select>
          <div style={{ padding: "10px", borderRadius: "10px", background: "#eff6ff", border: "1px solid #bfdbfe" }}>
            <div style={{ fontSize: "11px", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Next Up
            </div>
            <div style={{ marginTop: "4px", fontSize: "15px", fontWeight: 800, color: "#166534" }}>
              {nextUpEmployee ? `${nextUpEmployee.firstName} ${nextUpEmployee.lastName}` : "No one in queue"}
            </div>
          </div>
          <button
            onClick={() => printElementById("overtime-list-print-section", "Overtime List")}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: "8px",
              border: "none",
              background: "#0f766e",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: "12px",
              cursor: "pointer"
            }}
          >
            Print List
          </button>
        </div>
      </CardContent>
    </Card>
  )

  const workspaceBuilderPanel = (
    <Card>
      <CardHeader>
        <CardTitle>Shift Builder</CardTitle>
      </CardHeader>
      <CardContent>
        <div style={{ display: "grid", gap: "12px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1.2fr) minmax(160px, 1fr)", gap: "10px" }}>
            <select
              value={builderEmployeeId}
              onChange={(event) => resetBuilderSelection(event.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                fontSize: "12px"
              }}
            >
              <option value="">Select employee</option>
              {alphabeticalEmployees.map((employee) => (
                <option key={`builder-${employee.id}`} value={employee.id}>
                  {employee.lastName}, {employee.firstName} | {employee.team} | {employee.rank}
                </option>
              ))}
            </select>
            <select
              value={builderReason}
              onChange={(event) => setBuilderReason(event.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                fontSize: "12px"
              }}
            >
              {TIME_OFF_REASON_OPTIONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {(["single", "multiple", "month"] as BuilderSelectionMode[]).map((mode) => (
                <button
                  key={`builder-mode-${mode}`}
                  onClick={() => setBuilderMode(mode)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "999px",
                    border: "none",
                    background: builderSelectionMode === mode ? "#0f172a" : "#e2e8f0",
                    color: builderSelectionMode === mode ? "#ffffff" : "#0f172a",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: "12px"
                  }}
                >
                  {mode === "single" ? "Single Date" : mode === "multiple" ? "Multiple Dates" : "Month"}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={() => shiftBuilderMonth(-1)}
                style={{
                  padding: "6px 10px",
                  borderRadius: "8px",
                  border: "none",
                  background: "#e2e8f0",
                  color: "#0f172a",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: "12px"
                }}
              >
                Prev
              </button>
              <div style={{ fontSize: "13px", fontWeight: 800, color: "#0f172a", minWidth: "130px", textAlign: "center" }}>
                {builderMonthAnchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </div>
              <button
                onClick={() => setBuilderMonthAnchor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
                style={{
                  padding: "6px 10px",
                  borderRadius: "8px",
                  border: "none",
                  background: "#f1f5f9",
                  color: "#0f172a",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: "12px"
                }}
              >
                Today
              </button>
              <button
                onClick={() => shiftBuilderMonth(1)}
                style={{
                  padding: "6px 10px",
                  borderRadius: "8px",
                  border: "none",
                  background: "#e2e8f0",
                  color: "#0f172a",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: "12px"
                }}
              >
                Next
              </button>
            </div>
          </div>

          {!builderEmployee && (
            <div style={{ padding: "18px", borderRadius: "12px", background: "#f8fafc", border: "1px dashed #cbd5e1", fontSize: "13px", color: "#64748b" }}>
              Choose an employee, then click the scheduled shift boxes for the dates you want to mark off. Saving here writes those shifts into the patrol overtime feed without leaving this module.
            </div>
          )}

          {builderEmployee && (
            <div style={{ display: "grid", gap: "10px" }}>
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: "12px",
                  background: "linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)",
                  border: "1px solid #bfdbfe",
                  display: "grid",
                  gap: "4px"
                }}
              >
                <div style={{ fontSize: "11px", fontWeight: 800, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Selected Employee
                </div>
                <div style={{ fontSize: "18px", fontWeight: 900, color: "#0f172a" }}>
                  {builderEmployee.firstName} {builderEmployee.lastName}
                </div>
                <div style={{ fontSize: "12px", color: "#475569" }}>
                  {builderEmployee.team} | {builderEmployee.rank} | Default {builderEmployee.defaultVehicle} | {builderEmployee.defaultShiftHours}
                </div>
                <div style={{ fontSize: "12px", color: "#334155" }}>
                  Each day below shows the full staffing picture. Click this employee’s scheduled shift box to mark it off and create overtime from this module.
                </div>
              </div>
              <div
                style={{
                  padding: "14px",
                  borderRadius: "12px",
                  border: "1px solid #dbe3ee",
                  background: "#ffffff",
                  display: "grid",
                  gap: "12px"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  <div style={{ display: "grid", gap: "4px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Patrol Calendar Picker
                    </div>
                    <div style={{ fontSize: "13px", color: "#334155" }}>
                      {builderSelectionMode === "single"
                        ? "Pick one worked shift."
                        : builderSelectionMode === "multiple"
                          ? "Jump straight into the Patrol calendar and click the employee's worked boxes there."
                          : "Review the month with every worked shift selected."}
                    </div>
                  </div>
                  <button
                    onClick={() => setBuilderCalendarOpen(true)}
                    style={{
                      padding: "10px 14px",
                      borderRadius: "10px",
                      border: "none",
                      background: "#0f766e",
                      color: "#ffffff",
                      fontWeight: 800,
                      cursor: "pointer"
                    }}
                  >
                    Open Patrol Calendar
                  </button>
                </div>
                <div style={{ fontSize: "12px", color: "#64748b" }}>
                  This popup mirrors the Patrol month layout and keeps the staffing picture visible while you click the selected employee's worked cells.
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 340px)",
                  gap: "14px",
                  alignItems: "start"
                }}
              >
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: "12px",
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    display: "grid",
                    gap: "8px"
                  }}
                >
                  <div style={{ fontSize: "11px", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Selected Shifts
                  </div>
                  {builderSelectedRows.length === 0 ? (
                    <div style={{ fontSize: "12px", color: "#64748b" }}>
                      No shifts selected yet.
                    </div>
                  ) : (
                    builderSelectedRows.map((row) => (
                      <div
                        key={`builder-selected-${getPatrolRowKey(row)}`}
                        style={{
                          padding: "8px 10px",
                          borderRadius: "10px",
                          background: "#ffffff",
                          border: "1px solid #dbe3ee",
                          display: "grid",
                          gap: "2px"
                        }}
                      >
                        <div style={{ fontSize: "12px", fontWeight: 800, color: "#0f172a" }}>
                          {formatShortDate(row.assignment_date)} | {row.shift_type} {formatQueuePositionLabel(row.position_code as OvertimeShiftRequest["positionCode"])}
                        </div>
                        <div style={{ fontSize: "11px", color: "#64748b" }}>
                          {row.vehicle || builderEmployee.defaultVehicle} | {row.shift_hours || builderEmployee.defaultShiftHours}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {workspaceCheckpointPanel}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )

  const builderCalendarModal = builderEmployee && builderCalendarOpen && (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "24px"
      }}
    >
      <div
        style={{
          width: "min(1340px, 98vw)",
          maxHeight: "96vh",
          overflow: "auto",
          background: "#ffffff",
          borderRadius: "16px",
          boxShadow: "0 20px 45px rgba(15, 23, 42, 0.28)",
          padding: "14px"
        }}
      >
        <div style={{ display: "grid", gap: "14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: "4px" }}>
              <div style={{ fontSize: "20px", fontWeight: 900, color: "#0f172a" }}>
                Patrol Calendar Shift Picker
              </div>
              <div style={{ fontSize: "13px", color: "#475569" }}>
                {builderEmployee.firstName} {builderEmployee.lastName} | {builderSelectionMode === "single" ? "Single Date" : builderSelectionMode === "multiple" ? "Multiple Dates" : "Month"}
              </div>
              <div style={{ fontSize: "12px", color: "#64748b" }}>
                Click this employee's worked Patrol boxes to mark time off. The rest of the grid shows who else is scheduled or off.
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={() => shiftBuilderMonth(-1)}
                style={{ padding: "8px 12px", borderRadius: "8px", border: "none", background: "#e2e8f0", fontWeight: 700, cursor: "pointer" }}
              >
                Prev Month
              </button>
              <div style={{ minWidth: "170px", textAlign: "center", fontSize: "16px", fontWeight: 800, color: "#0f172a" }}>
                {builderMonthAnchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </div>
              <button
                onClick={() => setBuilderMonthAnchor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
                style={{ padding: "8px 12px", borderRadius: "8px", border: "none", background: "#f1f5f9", fontWeight: 700, cursor: "pointer" }}
              >
                Today
              </button>
              <button
                onClick={() => shiftBuilderMonth(1)}
                style={{ padding: "8px 12px", borderRadius: "8px", border: "none", background: "#e2e8f0", fontWeight: 700, cursor: "pointer" }}
              >
                Next Month
              </button>
              <button
                onClick={() => setBuilderCalendarOpen(false)}
                style={{ padding: "8px 12px", borderRadius: "8px", border: "none", background: "#0f172a", color: "#ffffff", fontWeight: 700, cursor: "pointer" }}
              >
                Close
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gap: "8px" }}>
            <div
              style={{
                textAlign: "center",
                fontWeight: 700,
                background: "#e2e8f0",
                border: "1px solid #dbeafe",
                padding: "8px",
                borderRadius: "6px",
                marginBottom: "6px"
              }}
            >
              {builderMonthAnchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </div>
            {builderWeekRows.map((week, weekIndex) => (
              <div
                key={`builder-week-${weekIndex}`}
                style={{
                  border: "1px solid #dbeafe",
                  borderRadius: "10px",
                  overflow: "hidden",
                  background: "#ffffff"
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "90px repeat(7, minmax(0, 1fr))",
                    background: "#f8fafc",
                    borderBottom: "1px solid #dbeafe",
                    boxShadow: "0 2px 8px rgba(15, 23, 42, 0.08)"
                  }}
                >
                  <div style={{ padding: "8px 6px", fontWeight: 700, color: "#475569", fontSize: "12px" }}>
                    Week {weekIndex + 1}
                  </div>
                  {week.map((date) => {
                    const inCurrentMonth = date.getMonth() === builderMonthAnchor.getMonth()

                    return (
                    <div
                      key={`builder-header-${date.toISOString()}`}
                      style={{
                        padding: "4px 3px",
                        textAlign: "center",
                        borderLeft: "1px solid #dbeafe",
                        background: !inCurrentMonth ? "#f8fafc" : "#ffffff",
                        opacity: !inCurrentMonth ? 0.65 : 1
                      }}
                    >
                        <div style={{ fontSize: "9px", fontWeight: 700, color: "#475569" }}>
                          {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][date.getDay()]}
                        </div>
                        <div style={{ fontWeight: 700, fontSize: "11px" }}>
                          {date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div style={{ display: "grid", gap: 0 }}>
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
                      key={`builder-modal-row-${row.label}-${rowIndex}-${weekIndex}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "90px repeat(7, minmax(0, 1fr))",
                        borderTop: rowIndex === 0 ? "none" : "1px solid #e2e8f0"
                      }}
                    >
                      <div
                        style={{
                          padding: row.kind === "team" ? "4px 6px" : "3px 6px",
                          fontWeight: 700,
                          fontSize: row.kind === "team" ? "10px" : "11px",
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
                        const inCurrentMonth = date.getMonth() === builderMonthAnchor.getMonth()
                        const isoDate = date.toISOString().slice(0, 10)

                        if (row.kind === "team") {
                          return (
                            <div
                              key={`builder-team-${row.label}-${isoDate}`}
                              style={{
                                padding: "3px",
                                borderLeft: "1px solid #e2e8f0",
                                background: !inCurrentMonth ? "#f8fafc" : "#ffffff",
                                opacity: !inCurrentMonth ? 0.7 : 1
                              }}
                            >
                              <div
                                style={{
                                  textAlign: "center",
                                  fontSize: "11px",
                                  fontWeight: 800,
                                  color: "#1e3a8a",
                                  padding: "7px 2px",
                                  borderRadius: "8px",
                                  border: "1px solid #93c5fd",
                                  background: "linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%)",
                                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8)"
                                }}
                              >
                                {getActiveTeam(date, row.shift)}
                              </div>
                            </div>
                          )
                        }

                        const keyedRow = builderRowByKey.get(`${isoDate}-${row.shift}-${row.code}`)
                        const resolvedRow = keyedRow || null
                        const rowEmployee = resolvedRow?.employee_id ? employeeMap.get(resolvedRow.employee_id) || null : null
                        const replacementEmployee = resolvedRow?.replacement_employee_id ? employeeMap.get(resolvedRow.replacement_employee_id) || null : null
                        const isBuilderEmployeeRow = resolvedRow?.employee_id === builderEmployee.id
                        const rowKey = resolvedRow ? getPatrolRowKey(resolvedRow) : `${isoDate}-${row.shift}-${row.code}`
                        const selected = resolvedRow ? builderSelectedShiftKeySet.has(getPatrolRowKey(resolvedRow)) : false
                        const leaveLabel = formatStatusLabel(resolvedRow?.status) || resolvedRow?.shift_hours || rowEmployee?.defaultShiftHours || ""

                        return (
                          <div
                            key={`builder-cell-${rowKey}`}
                            style={{
                              padding: "2px",
                              borderLeft: "1px solid #e2e8f0",
                              background: !inCurrentMonth ? "#f8fafc" : "#ffffff",
                              opacity: !inCurrentMonth ? 0.7 : 1
                            }}
                          >
                            {!resolvedRow ? (
                              <div
                                style={{
                                  minHeight: "38px",
                                  padding: "1px 4px",
                                  border: "1px solid #e5e7eb",
                                  borderRadius: "6px",
                                  background: "#ffffff",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: "11px",
                                  fontWeight: 700
                                }}
                              >
                                OPEN
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  if (isBuilderEmployeeRow) {
                                    toggleBuilderShiftSelection(resolvedRow)
                                  }
                                }}
                                disabled={!isBuilderEmployeeRow}
                                style={{
                                  width: "100%",
                                  minHeight: "38px",
                                  padding: "1px 4px",
                                  border: isBuilderEmployeeRow
                                    ? `2px solid ${selected ? "#2563eb" : "#94a3b8"}`
                                    : "1px solid #e5e7eb",
                                  borderRadius: "6px",
                                  background: selected
                                    ? "#dbeafe"
                                    : isBuilderEmployeeRow
                                      ? "#f8fafc"
                                      : "#ffffff",
                                  display: "grid",
                                  gridTemplateRows: "auto auto",
                                  gap: "3px",
                                  cursor: isBuilderEmployeeRow ? "pointer" : "default",
                                  opacity: !isBuilderEmployeeRow && resolvedRow.status && resolvedRow.status !== "Scheduled" ? 0.9 : 1
                                }}
                              >
                                <div
                                  style={{
                                    width: "100%",
                                    fontWeight: 600,
                                    background: resolvedRow.status && resolvedRow.status !== "Scheduled" ? "#fde68a" : "transparent",
                                    border: "1px solid #d1d5db",
                                    padding: "1px 3px",
                                    borderRadius: "4px",
                                    minHeight: "14px",
                                    fontSize: "11px",
                                    lineHeight: 1,
                                    display: "grid",
                                    gridTemplateColumns: "22px minmax(0, 1fr) 26px",
                                    alignItems: "center",
                                    columnGap: "3px",
                                    textAlign: "center"
                                  }}
                                >
                                  <span style={{ textAlign: "left", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                                    {(resolvedRow.vehicle || rowEmployee?.defaultVehicle || "").trim()}
                                  </span>
                                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {rowEmployee?.lastName || "OPEN"}
                                  </span>
                                  <span style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                                    {leaveLabel}
                                  </span>
                                </div>
                                <div
                                  style={{
                                    width: "100%",
                                    border: "1px solid #d1d5db",
                                    borderRadius: "4px",
                                    padding: "1px 3px",
                                    minHeight: "14px",
                                    background: "#ffffff",
                                    display: "grid",
                                    gridTemplateColumns: "22px minmax(0, 1fr) 26px",
                                    alignItems: "center",
                                    columnGap: "3px",
                                    fontSize: "11px",
                                    lineHeight: 1,
                                    textAlign: "center",
                                    color: replacementEmployee ? "#2563eb" : "#94a3b8"
                                  }}
                                >
                                  {replacementEmployee ? (
                                    <>
                                      <span style={{ textAlign: "left", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                                        {(resolvedRow.replacement_vehicle || replacementEmployee.defaultVehicle || "").trim()}
                                      </span>
                                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {replacementEmployee.lastName}
                                      </span>
                                      <span style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                                        {resolvedRow.replacement_hours || replacementEmployee.defaultShiftHours || ""}
                                      </span>
                                    </>
                                  ) : ""}
                                </div>
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <div style={{ fontSize: "13px", color: "#475569" }}>
              {builderSelectedRows.length} shift{builderSelectedRows.length === 1 ? "" : "s"} selected
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                onClick={() => setBuilderSelectedShiftKeys([])}
                style={{ padding: "8px 12px", borderRadius: "8px", border: "none", background: "#e2e8f0", fontWeight: 700, cursor: "pointer" }}
              >
                Clear Selection
              </button>
              <button
                onClick={() => setBuilderCalendarOpen(false)}
                style={{ padding: "8px 12px", borderRadius: "8px", border: "none", background: "#cbd5e1", fontWeight: 700, cursor: "pointer" }}
              >
                Done Selecting
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ display: "grid", gap: "18px" }}>
      <Card>
        <CardHeader>
          <CardTitle>Overtime</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ display: "grid", gap: "12px" }}>
            <div style={{ fontSize: "13px", color: "#64748b" }}>
              Review Patrol time off, move qualified shifts into the queue, collect interest, and assign overtime coverage.
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {([
                { key: "preview1", label: "Preview 1", color: "#2563eb" },
                { key: "preview2", label: "Preview 2", color: "#0f766e" },
                { key: "preview3", label: "Preview 3", color: "#b45309" },
                { key: "preview4", label: "Preview 4", color: "#7c3aed" }
              ] as const).map((preview) => (
                <button
                  key={preview.key}
                  onClick={() => setLayoutPreview(preview.key)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "999px",
                    border: "none",
                    background: layoutPreview === preview.key ? preview.color : "#e2e8f0",
                    color: layoutPreview === preview.key ? "#ffffff" : "#0f172a",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: "12px"
                  }}
                >
                  {preview.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {layoutPreview === "preview2" && (
        <div
          style={{
            display: "grid",
            gap: "18px"
          }}
        >
          {workspaceBuilderPanel}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 340px) minmax(260px, 340px)", gap: "18px", justifyContent: "start" }}>
            {workspaceOrderPanel}
          </div>
        </div>
      )}

      {layoutPreview === "preview3" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(240px, 300px) minmax(0, 1.5fr) minmax(240px, 300px)",
            gap: "18px",
            alignItems: "start"
          }}
        >
          <div style={{ display: "grid", gap: "18px" }}>
            {workspaceOrderPanel}
            {workspaceCheckpointPanel}
          </div>
          {workspaceBuilderPanel}
          <Card>
            <CardHeader>
              <CardTitle>Builder Snapshot</CardTitle>
            </CardHeader>
            <CardContent>
              <div style={{ display: "grid", gap: "8px" }}>
                <div style={{ fontSize: "12px", color: "#475569" }}>
                  Employee: {builderEmployee ? `${builderEmployee.firstName} ${builderEmployee.lastName}` : "No one selected"}
                </div>
                <div style={{ fontSize: "12px", color: "#475569" }}>
                  Reason: {builderReason}
                </div>
                <div style={{ fontSize: "12px", color: "#475569" }}>
                  Mode: {builderSelectionMode === "single" ? "Single Date" : builderSelectionMode === "multiple" ? "Multiple Dates" : "Month"}
                </div>
                <div style={{ fontSize: "12px", color: "#475569" }}>
                  Selected: {builderSelectedRows.length}
                </div>
                {builderSelectedRows.slice(0, 5).map((row) => (
                  <div key={`builder-snapshot-${getPatrolRowKey(row)}`} style={{ fontSize: "11px", color: "#0f172a", padding: "6px 8px", borderRadius: "8px", background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                    {formatShortDate(row.assignment_date)} | {row.shift_type} {formatQueuePositionLabel(row.position_code as OvertimeShiftRequest["positionCode"])}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {layoutPreview === "preview4" && (
        <div
          style={{
            display: "grid",
            gap: "18px"
          }}
        >
          <div
            style={{
              ...CARD_STYLE,
              padding: "18px",
              background: "linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #334155 100%)",
              color: "#ffffff",
              display: "grid",
              gap: "14px"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "14px", alignItems: "flex-start", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: "12px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#93c5fd" }}>
                  Preview 4
                </div>
                <div style={{ fontSize: "24px", fontWeight: 900, marginTop: "4px" }}>
                  Overtime Mission Control
                </div>
                <div style={{ fontSize: "13px", color: "#cbd5e1", marginTop: "6px", maxWidth: "700px" }}>
                  Build time off, generate overtime, queue it, collect interest, and assign coverage from one control center.
                </div>
              </div>
              <div style={{ display: "grid", gap: "8px", minWidth: "220px" }}>
                <div style={{ padding: "10px 12px", borderRadius: "12px", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em", color: "#cbd5e1", fontWeight: 800 }}>
                    Open Queue
                  </div>
                  <div style={{ fontSize: "22px", fontWeight: 900, marginTop: "4px" }}>{overtimeShiftQueue.length}</div>
                </div>
                <div style={{ padding: "10px 12px", borderRadius: "12px", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em", color: "#cbd5e1", fontWeight: 800 }}>
                    Interested Responses
                  </div>
                  <div style={{ fontSize: "22px", fontWeight: 900, marginTop: "4px" }}>
                    {overtimeShiftQueue.reduce((total, request) => total + request.responses.filter((response) => response.status === "Interested").length, 0)}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.7fr) minmax(260px, 340px)", gap: "18px", alignItems: "start" }}>
            {workspaceBuilderPanel}
            <div style={{ display: "grid", gap: "18px" }}>
              {workspaceOrderPanel}
              {workspaceCheckpointPanel}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gap: "18px", opacity: layoutPreview === "preview1" ? 1 : 1 }}>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ width: "100%", maxWidth: "360px" }}>
        <Card>
          <CardHeader>
            <CardTitle>Overtime List</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              id="overtime-list-print-section"
              style={{
                display: "grid",
                gap: "8px",
                padding: "10px",
                borderRadius: "12px",
                border: "1px solid #dbe3ee",
                background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
                boxShadow: "0 8px 18px rgba(15, 23, 42, 0.05)"
              }}
            >
              <div
                style={{
                  display: "grid",
                  gap: "8px",
                  gridTemplateColumns: "1fr"
                }}
              >
              <div
                style={{
                  padding: "8px 10px",
                  borderRadius: "10px",
                  border: "1px solid #dbe3ee",
                  background: "#ffffff",
                  boxShadow: "0 6px 16px rgba(15, 23, 42, 0.04)"
                }}
              >
                <div style={{ display: "grid", gap: "8px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Overtime Order
                  </div>
                <select
                  value={nextUpEmployee?.id || ""}
                  onChange={() => undefined}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                    fontSize: "12px",
                    fontWeight: 600
                  }}
                >
                  {overtimeQueueList.map((employee, index) => (
                    <option key={employee.id} value={employee.id}>
                      {index === 0 ? "✓ " : `${index + 1}. `}
                      {employee.firstName} {employee.lastName} | {employee.rank}
                    </option>
                  ))}
                </select>
                </div>
              </div>

              <div
                style={{
                  fontSize: "12px",
                  color: "#0f172a",
                  fontWeight: 700,
                  padding: "8px 10px",
                  borderRadius: "10px",
                  border: "1px solid #dbe3ee",
                  background: "#ffffff",
                  boxShadow: "0 6px 16px rgba(15, 23, 42, 0.04)"
                }}
              >
                <div style={{ display: "grid", gap: "4px", textAlign: "center" }}>
                  <div style={{ fontSize: "11px", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Next Up For Overtime
                  </div>
                  <div style={{ fontSize: "14px", color: "#166534", fontWeight: 800 }}>
                    {nextUpEmployee ? `${nextUpEmployee.firstName} ${nextUpEmployee.lastName}` : "No one in queue"}
                  </div>
                </div>
              </div>

              <div
                style={{
                  padding: "8px 10px",
                  borderRadius: "10px",
                  border: "1px solid #dbe3ee",
                  background: "#ffffff",
                  boxShadow: "0 6px 16px rgba(15, 23, 42, 0.04)"
                }}
              >
                <div style={{ display: "grid", gap: "8px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Print
                  </div>
                <button
                  onClick={() => printElementById("overtime-list-print-section", "Overtime List")}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "8px",
                    border: "none",
                    background: "#2563eb",
                    color: "#ffffff",
                    fontWeight: 700,
                    fontSize: "12px",
                    cursor: "pointer"
                  }}
                >
                  Print List
                </button>
                </div>
              </div>
            </div>

            <div
              style={{
                position: "absolute",
                left: "-9999px",
                top: 0,
                width: "1px",
                height: "1px",
                overflow: "hidden"
              }}
            >
              {overtimeQueueList.map((employee, index) => (
                <div key={`print-${employee.id}`} style={{ padding: "4px 0", fontSize: "13px" }}>
                  {index === 0 ? "✓ " : `${index + 1}. `}
                  {employee.firstName} {employee.lastName} | {employee.rank} | Hire Date: {employee.hireDate}
                </div>
              ))}
            </div>
            </div>
          </CardContent>
        </Card>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(250px, 320px) minmax(250px, 320px) minmax(0, 1fr)",
          gap: "18px",
          alignItems: "start"
        }}
      >
        <Card>
          <CardHeader>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <CardTitle>Patrol Time Off Feed</CardTitle>
              <button
                onClick={undoLastQueueAction}
                style={{
                  padding: "5px 9px",
                  borderRadius: "8px",
                  border: "none",
                  background: "#e2e8f0",
                  color: "#0f172a",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: "12px"
                }}
              >
                Undo
              </button>
            </div>
          </CardHeader>
          <CardContent>
            <div
              style={{
                display: "grid",
                gap: "8px",
                maxHeight: "520px",
                overflowY: "auto",
                paddingRight: "4px"
              }}
            >
              {patrolTimeOffFeed.length === 0 && (
                <div style={{ fontSize: "13px", color: "#64748b" }}>
                  No patrol time-off dates have been pushed into overtime yet.
                </div>
              )}

              {patrolTimeOffFeed.map((request) => (
                (() => {
                  const isQueued = overtimeShiftQueue.some((queuedRequest) => queuedRequest.id === request.id)

                  return (
                <div
                  key={request.id}
                  style={{
                    ...CARD_STYLE,
                    padding: "8px 10px",
                    display: "grid",
                    gap: "4px"
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: "13px" }}>
                    {new Date(`${request.assignmentDate}T12:00:00`).toLocaleDateString(undefined, {
                      month: "numeric",
                      day: "numeric",
                      year: "numeric"
                    })}
                  </div>
                  <div style={{ fontSize: "12px", color: "#0f172a" }}>
                    {request.shiftType} {formatQueuePositionLabel(request.positionCode)} {request.offEmployeeLastName ? `| ${request.offEmployeeLastName}` : ""}
                  </div>
                  <div style={{ fontSize: "14px", fontWeight: 800, color: "#0f172a" }}>
                    {request.offHours || "Hours pending"}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: isQueued ? "#166534" : "#92400e"
                    }}
                  >
                    {isQueued ? "In queue" : "Not in queue"}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "8px"
                    }}
                  >
                    <div>
                      {!isQueued && (
                        <button
                          onClick={() => toggleManualQueue(request.id)}
                          style={{
                            padding: "4px 8px",
                            borderRadius: "6px",
                            border: "none",
                            background: "#e2e8f0",
                            color: "#0f172a",
                            fontWeight: 700,
                            cursor: "pointer",
                            fontSize: "11px"
                          }}
                        >
                          Send to Queue
                        </button>
                      )}
                    </div>

                    <button
                      onClick={() => void deletePatrolTimeOffFeedItem(request)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: "6px",
                        border: "none",
                        background: "#dc2626",
                        color: "#ffffff",
                        fontWeight: 700,
                        cursor: "pointer",
                        fontSize: "11px"
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                  )
                })()
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <div ref={queueSectionRef} />
          <CardHeader>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px",
                flexWrap: "wrap"
              }}
            >
              <CardTitle>Overtime Shift Queue</CardTitle>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  onClick={toggleQueueSelectMode}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "8px",
                    border: "none",
                    background: queueSelectMode ? "#2563eb" : "#e2e8f0",
                    color: queueSelectMode ? "#ffffff" : "#0f172a",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: "12px"
                  }}
                >
                  Select
                </button>

                <button
                  onClick={selectAllQueueShifts}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "8px",
                    border: "none",
                    background: "#e2e8f0",
                    color: "#0f172a",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: "12px"
                  }}
                >
                  Select All
                </button>

                <button
                  onClick={sendSelectedQueueShiftsToNotifications}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "8px",
                    border: "none",
                    background: "#0f766e",
                    color: "#ffffff",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: "12px"
                  }}
                >
                  Send Selected
                </button>

                <button
                  onClick={() =>
                    autoAssignQueueShifts(selectedQueueShiftIds.length > 0 ? selectedQueueShiftIds : undefined)
                  }
                  style={{
                    padding: "6px 10px",
                    borderRadius: "8px",
                    border: "none",
                    background: "#e2e8f0",
                    color: "#0f172a",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: "12px"
                  }}
                >
                  Auto Assign
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div
              style={{
                display: "grid",
                gap: "8px",
                maxHeight: "520px",
                overflowY: "auto",
                paddingRight: "4px"
              }}
            >
              {overtimeShiftQueue.length === 0 && (
                <div style={{ fontSize: "13px", color: "#64748b" }}>
                  No shifts qualify for the queue yet under the current staffing rules.
                </div>
              )}

              {overtimeShiftQueue.map((request) => (
                (() => {
                  const interestedResponders = request.responses
                    .filter((response) => response.status === "Interested")
                    .map((response) => ({
                      response,
                      employee: employeeMap.get(response.employeeId) || null
                    }))
                    .filter((entry): entry is { response: OvertimeShiftRequest["responses"][number]; employee: Employee } => Boolean(entry.employee))
                  const assignOptions = employees
                    .filter((employee) => employee.status === "Active")
                    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))

                  return (
                <div
                  key={`queue-${request.id}`}
                  onClick={() => setSelectedQueueShiftId(request.id)}
                  style={{
                    ...CARD_STYLE,
                    padding: "8px 10px",
                    display: "grid",
                    gap: "4px",
                    borderColor:
                      request.id === selectedQueueShiftId
                        ? "#2563eb"
                        : request.manuallyQueued
                          ? "#2563eb"
                          : "#dbe3ee",
                    background: request.id === selectedQueueShiftId ? "#eff6ff" : "#ffffff",
                    cursor: "pointer",
                    position: "relative"
                  }}
                >
                  {queueSelectMode && (
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        toggleQueueShiftSelection(request.id)
                      }}
                      style={{
                        position: "absolute",
                        top: "8px",
                        right: "8px",
                        width: "18px",
                        height: "18px",
                        borderRadius: "4px",
                        border: `2px solid ${selectedQueueShiftIds.includes(request.id) ? "#2563eb" : "#94a3b8"}`,
                        background: selectedQueueShiftIds.includes(request.id) ? "#2563eb" : "#ffffff",
                        color: "#ffffff",
                        fontSize: "11px",
                        fontWeight: 800,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        padding: 0
                      }}
                      aria-label={`Select ${request.assignmentDate} ${request.shiftType} ${request.positionCode}`}
                    >
                      {selectedQueueShiftIds.includes(request.id) ? "✓" : ""}
                    </button>
                  )}

                  <div style={{ fontWeight: 700, fontSize: "13px" }}>
                    {new Date(`${request.assignmentDate}T12:00:00`).toLocaleDateString(undefined, {
                      month: "numeric",
                      day: "numeric",
                      year: "numeric"
                    })}
                  </div>
                  <div style={{ fontSize: "12px", color: "#0f172a" }}>
                    {request.shiftType} {formatQueuePositionLabel(request.positionCode)} {request.offEmployeeLastName ? `| ${request.offEmployeeLastName}` : ""}
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>
                    {request.manuallyQueued
                      ? "Entered manually"
                      : "Entered automatically because staffing rules were not met"}
                  </div>
                  <div style={{ fontSize: "14px", fontWeight: 800, color: "#0f172a" }}>
                    {request.offHours || "Hours pending"}
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gap: "4px",
                      padding: "8px 10px",
                      borderRadius: "8px",
                      background: interestedResponders.length > 0 ? "#eff6ff" : "#f8fafc",
                      border: `1px solid ${interestedResponders.length > 0 ? "#93c5fd" : "#e2e8f0"}`
                    }}
                  >
                    <div style={{ fontSize: "10px", fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "#475569" }}>
                      Total Interested Responses
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px" }}>
                      <span
                        style={{
                          fontSize: "24px",
                          lineHeight: 1,
                          fontWeight: 900,
                          color: interestedResponders.length > 0 ? "#1d4ed8" : "#475569"
                        }}
                      >
                        {interestedResponders.length}
                      </span>
                      <span style={{ fontSize: "10px", fontWeight: 700, color: "#64748b", textAlign: "right" }}>
                        Click this card to view interested employees
                      </span>
                    </div>
                  </div>
                  {request.assignedEmployeeId && request.autoAssignReason && (
                    <div
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        color: "#1d4ed8"
                      }}
                    >
                      {request.autoAssignReason}
                    </div>
                  )}
                    <div style={{ display: "flex", justifyContent: "flex-start", gap: "6px", flexWrap: "wrap" }}>
                      <button
                        onClick={(event) => {
                          event.stopPropagation()
                        if (manualAssignRequestId === request.id) {
                          setManualAssignRequestId(null)
                          setManualAssignEmployeeId("")
                          setManualAssignSplitHours(false)
                          setManualAssignHours("")
                          return
                        }
                        setManualAssignRequestId(request.id)
                        setManualAssignEmployeeId(request.assignedEmployeeId || "")
                        setManualAssignSplitHours(false)
                        setManualAssignHours(request.offHours || "")
                      }}
                      style={{
                        padding: "4px 8px",
                        borderRadius: "6px",
                        border: "none",
                        background: "#e2e8f0",
                        color: "#0f172a",
                        fontWeight: 700,
                        cursor: "pointer",
                        fontSize: "11px"
                      }}
                      >
                        Assign
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation()
                          setForceAssignRequestId(request.id)
                          setForceAssignEmployeeId("")
                        }}
                        style={{
                          padding: "4px 8px",
                          borderRadius: "6px",
                          border: "none",
                          background: "#dc2626",
                          color: "#ffffff",
                          fontWeight: 700,
                          cursor: "pointer",
                          fontSize: "11px"
                        }}
                      >
                        Force
                      </button>
                    </div>
                  {manualAssignRequestId === request.id && (
                    <div
                      onClick={(event) => event.stopPropagation()}
                      style={{
                        marginTop: "4px",
                        display: "grid",
                        gap: "6px",
                        padding: "8px",
                        borderRadius: "8px",
                        background: "#f8fafc",
                        border: "1px solid #cbd5e1"
                      }}
                    >
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "#334155" }}>
                        Choose a replacement for this shift.
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#334155" }}>
                        <input
                          type="checkbox"
                          checked={manualAssignSplitHours}
                          onChange={(event) => {
                            setManualAssignSplitHours(event.target.checked)
                            if (!event.target.checked) {
                              setManualAssignHours(request.offHours || "")
                            }
                          }}
                        />
                        Split shift / custom hours
                      </label>
                      {manualAssignSplitHours && (
                        <input
                          value={manualAssignHours}
                          onChange={(event) => setManualAssignHours(event.target.value)}
                          placeholder={request.offHours || "Enter hours"}
                          style={{
                            width: "100%",
                            padding: "7px 8px",
                            borderRadius: "6px",
                            border: "1px solid #cbd5e1",
                            background: "#ffffff",
                            fontSize: "12px"
                          }}
                        />
                      )}
                      <select
                        value={manualAssignEmployeeId}
                        onChange={(event) => setManualAssignEmployeeId(event.target.value)}
                        style={{
                          width: "100%",
                          padding: "7px 8px",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          background: "#ffffff",
                          fontSize: "12px"
                        }}
                      >
                        <option value="">Select employee</option>
                        {interestedResponders.length > 0 && (
                          <optgroup label="Interested Responders">
                            {interestedResponders.map(({ employee, response }) => (
                              <option key={`interested-${request.id}-${employee.id}`} value={employee.id}>
                                {employee.firstName} {employee.lastName} | {response.status} | Priority Responder
                              </option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label="All Employees">
                          {assignOptions.map((employee) => (
                            <option key={`assign-${request.id}-${employee.id}`} value={employee.id}>
                              {employee.firstName} {employee.lastName} | {employee.rank} | General List
                            </option>
                          ))}
                        </optgroup>
                      </select>
                      <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                        <button
                          onClick={() => {
                            setManualAssignRequestId(null)
                            setManualAssignEmployeeId("")
                            setManualAssignSplitHours(false)
                            setManualAssignHours("")
                          }}
                          style={{
                            padding: "4px 8px",
                            borderRadius: "6px",
                            border: "none",
                            background: "#e2e8f0",
                            color: "#0f172a",
                            fontWeight: 700,
                            cursor: "pointer",
                            fontSize: "11px"
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => saveManualAssignment(request.id)}
                          style={{
                            padding: "4px 8px",
                            borderRadius: "6px",
                            border: "none",
                            background: "#2563eb",
                            color: "#ffffff",
                            fontWeight: 700,
                            cursor: "pointer",
                            fontSize: "11px"
                          }}
                        >
                          Save
                        </button>
                        <button
                          onClick={() => forceManualAssignment(request.id)}
                          style={{
                            padding: "4px 8px",
                            borderRadius: "6px",
                            border: "none",
                            background: "#dc2626",
                            color: "#ffffff",
                            fontWeight: 700,
                            cursor: "pointer",
                            fontSize: "11px"
                          }}
                        >
                          Manual Assign
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                  )
                })()
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Interested Responders</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              style={{
                display: "grid",
                gap: "8px",
                maxHeight: "520px",
                overflowY: "auto",
                paddingRight: "4px"
              }}
            >
              {interestedRespondersByQueue.length === 0 && (
                <div style={{ fontSize: "13px", color: "#64748b" }}>
                  No queued shifts are waiting on responder review yet.
                </div>
              )}

              {!selectedQueueEntry && interestedRespondersByQueue.length > 0 && (
                <div style={{ fontSize: "13px", color: "#64748b" }}>
                  Click a shift in the overtime queue to see who responded for that shift.
                </div>
              )}

              {selectedQueueEntry && (
                <div
                  key={`responders-${selectedQueueEntry.request.id}`}
                  style={{
                    ...CARD_STYLE,
                    padding: "8px 10px",
                    display: "grid",
                    gap: "5px"
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: "13px" }}>
                    {new Date(`${selectedQueueEntry.request.assignmentDate}T12:00:00`).toLocaleDateString(undefined, {
                      month: "numeric",
                      day: "numeric",
                      year: "numeric"
                    })}
                  </div>
                  <div style={{ fontSize: "12px", color: "#0f172a" }}>
                    {selectedQueueEntry.request.shiftType} {formatQueuePositionLabel(selectedQueueEntry.request.positionCode)} {selectedQueueEntry.request.offEmployeeLastName ? `| ${selectedQueueEntry.request.offEmployeeLastName}` : ""}
                  </div>

                  {selectedQueueEntry.responders.length === 0 ? (
                    <div style={{ fontSize: "11px", color: "#64748b" }}>
                      No interested employees yet for this shift.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: "4px" }}>
                      {selectedQueueEntry.responders.map(({ response, employee }) => (
                        <div
                          key={`${selectedQueueEntry.request.id}-${response.employeeId}`}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: "8px",
                            fontSize: "11px",
                            borderRadius: "6px",
                            background: "#eff6ff",
                            color: "#1d4ed8",
                            padding: "4px 6px"
                          }}
                        >
                          <span style={{ fontWeight: 700 }}>
                            {employee ? `${employee.firstName} ${employee.lastName}` : response.employeeId}
                          </span>
                          <span>{response.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
      <Card>
        <CardHeader>
          <CardTitle>Assigned Queue Shifts</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
              gap: "10px"
            }}
          >
            {assignedQueueShifts.length === 0 && (
              <div style={{ fontSize: "13px", color: "#64748b" }}>
                No queue shifts have been assigned yet.
              </div>
            )}

            {assignedQueueShifts.map((request) => {
              const assignedEmployee = request.assignedEmployeeId
                ? employeeMap.get(request.assignedEmployeeId) || null
                : null

              return (
                <div
                  key={`assigned-${request.id}`}
                  style={{
                    ...CARD_STYLE,
                    padding: "10px 12px",
                    display: "grid",
                    gap: "4px",
                    background: "#f8fafc"
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: "13px" }}>
                    {new Date(`${request.assignmentDate}T12:00:00`).toLocaleDateString(undefined, {
                      month: "numeric",
                      day: "numeric",
                      year: "numeric"
                    })}
                  </div>
                  <div style={{ fontSize: "12px", color: "#0f172a" }}>
                    {request.shiftType} {formatQueuePositionLabel(request.positionCode)} {request.offEmployeeLastName ? `| ${request.offEmployeeLastName}` : ""}
                  </div>
                  <div style={{ fontSize: "14px", fontWeight: 800, color: "#0f172a" }}>
                    {request.assignedHours || request.offHours || "Hours pending"}
                  </div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#166534" }}>
                    Assigned: {assignedEmployee ? `${assignedEmployee.firstName} ${assignedEmployee.lastName}` : "Unknown"}
                  </div>
                  {request.autoAssignReason && (
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#1d4ed8" }}>
                      {request.autoAssignReason}
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      onClick={() => returnAssignedShiftToQueue(request)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: "6px",
                        border: "none",
                        background: "#e2e8f0",
                        color: "#0f172a",
                        fontWeight: 700,
                        cursor: "pointer",
                        fontSize: "11px"
                      }}
                    >
                      Return to Queue
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
      </div>

      </div>

      {queueRecipientPickerOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.38)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            zIndex: 70
          }}
        >
          <div
            style={{
              width: "min(560px, 100%)",
              maxHeight: "80vh",
              overflow: "hidden",
              borderRadius: "16px",
              background: "#ffffff",
              border: "1px solid #dbe3ee",
              boxShadow: "0 24px 60px rgba(15, 23, 42, 0.18)",
              display: "grid",
              gap: "0"
            }}
          >
            <div
              style={{
                padding: "14px 16px",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px"
              }}
            >
              <div>
                <div style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a" }}>
                  Send Selected Queue Shifts
                </div>
                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                  Choose everyone or pick specific employees.
                </div>
              </div>
              <button
                onClick={() => setQueueRecipientPickerOpen(false)}
                style={{
                  border: "none",
                  background: "#e2e8f0",
                  color: "#0f172a",
                  borderRadius: "999px",
                  padding: "6px 10px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer"
                }}
              >
                Close
              </button>
            </div>

            <div style={{ padding: "16px", display: "grid", gap: "12px" }}>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  onClick={() => {
                    const allRecipientIds = activeEmployees.map((employee) => employee.id)
                    setSelectedNotificationRecipientIds(allRecipientIds)
                    confirmSendSelectedQueueShiftsToNotificationsWithRecipients(allRecipientIds)
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "10px",
                    border: "none",
                    background: "#0f766e",
                    color: "#ffffff",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: "12px"
                  }}
                >
                  Send To Everyone
                </button>
                <button
                  onClick={() => setSelectedNotificationRecipientIds([])}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "10px",
                    border: "none",
                    background: "#e2e8f0",
                    color: "#0f172a",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: "12px"
                  }}
                >
                  Pick And Choose
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: "8px",
                  maxHeight: "320px",
                  overflowY: "auto",
                  paddingRight: "4px"
                }}
              >
                {activeEmployees.map((employee) => (
                  <label
                    key={`notify-${employee.id}`}
                    style={{
                      display: "flex",
                      gap: "8px",
                      alignItems: "center",
                      border: "1px solid #dbe3ee",
                      borderRadius: "10px",
                      padding: "10px",
                      background: "#ffffff"
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedNotificationRecipientIds.includes(employee.id)}
                      onChange={() => toggleNotificationRecipient(employee.id)}
                    />
                    <div style={{ display: "grid", gap: "2px" }}>
                      <div style={{ fontWeight: 700 }}>
                        {employee.firstName} {employee.lastName}
                      </div>
                      <div style={{ fontSize: "12px", color: "#64748b" }}>
                        {employee.team} | {employee.rank}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div
              style={{
                padding: "14px 16px",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "flex-end",
                gap: "8px"
              }}
            >
              <button
                onClick={() => setQueueRecipientPickerOpen(false)}
                style={{
                  padding: "8px 12px",
                  borderRadius: "10px",
                  border: "none",
                  background: "#e2e8f0",
                  color: "#0f172a",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: "12px"
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmSendSelectedQueueShiftsToNotifications}
                style={{
                  padding: "8px 12px",
                  borderRadius: "10px",
                  border: "none",
                  background: "#2563eb",
                  color: "#ffffff",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: "12px"
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {forceAssignRequestId && (
        (() => {
          const request = overtimeShiftQueue.find((entry) => entry.id === forceAssignRequestId) || overtimeShiftRequests.find((entry) => entry.id === forceAssignRequestId) || null
          if (!request) return null

          const forceCandidates = forceRotationList.map((employee) => ({
            employee,
            eligibility: getForceEligibility(employee, request)
          }))
          const recommendedCandidate = forceCandidates.find((candidate) => candidate.eligibility.eligible) || null
          const topCandidates = forceCandidates.slice(0, 3)

          return (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(15, 23, 42, 0.38)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "24px",
                zIndex: 80
              }}
            >
              <div
                style={{
                  width: "min(640px, 100%)",
                  maxHeight: "82vh",
                  overflow: "hidden",
                  borderRadius: "16px",
                  background: "#ffffff",
                  border: "1px solid #dbe3ee",
                  boxShadow: "0 24px 60px rgba(15, 23, 42, 0.18)",
                  display: "grid"
                }}
              >
                <div
                  style={{
                    padding: "14px 16px",
                    borderBottom: "1px solid #e2e8f0",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "12px"
                  }}
                >
                  <div>
                    <div style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a" }}>
                      Force Assignment
                    </div>
                    <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                      {new Date(`${request.assignmentDate}T12:00:00`).toLocaleDateString(undefined, {
                        month: "numeric",
                        day: "numeric",
                        year: "numeric"
                      })} | {request.shiftType} {formatQueuePositionLabel(request.positionCode)}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setForceAssignRequestId(null)
                      setForceAssignEmployeeId("")
                    }}
                    style={{
                      border: "none",
                      background: "#e2e8f0",
                      color: "#0f172a",
                      borderRadius: "999px",
                      padding: "6px 10px",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer"
                    }}
                  >
                    Close
                  </button>
                </div>

                <div style={{ padding: "16px", display: "grid", gap: "14px", overflowY: "auto" }}>
                  <div style={{ display: "grid", gap: "8px" }}>
                    <div style={{ fontWeight: 800, color: "#0f172a" }}>Force List Snapshot</div>
                    {topCandidates.map((candidate, index) => {
                      const forceSummary = getEmployeeForceSummary(forceHistory, candidate.employee.id)
                      return (
                        <div
                          key={`force-top-${candidate.employee.id}`}
                          style={{
                            border: "1px solid #dbe3ee",
                            borderRadius: "10px",
                            padding: "10px",
                            background: index === 0 ? "#eff6ff" : "#ffffff",
                            display: "grid",
                            gap: "4px"
                          }}
                        >
                          <div style={{ fontWeight: 800 }}>
                            {index === 0 ? "Next To Be Forced" : index === 1 ? "Then Next" : "Then Next"}: {candidate.employee.firstName} {candidate.employee.lastName}
                          </div>
                          <div style={{ fontSize: "12px", color: "#475569" }}>
                            Last Force: {forceSummary.last1} | Previous Force: {forceSummary.last2}
                          </div>
                          <div style={{ fontSize: "12px", color: candidate.eligibility.eligible ? "#166534" : "#b91c1c", fontWeight: 700 }}>
                            {candidate.eligibility.eligible ? "Eligible" : candidate.eligibility.reason}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <div
                    style={{
                      border: "1px solid #bfdbfe",
                      borderRadius: "12px",
                      padding: "12px",
                      background: "#eff6ff",
                      display: "grid",
                      gap: "6px"
                    }}
                  >
                    <div style={{ fontWeight: 800, color: "#1d4ed8" }}>Recommendation</div>
                    <div style={{ fontSize: "13px", color: "#334155" }}>
                      {recommendedCandidate
                        ? `${recommendedCandidate.employee.firstName} ${recommendedCandidate.employee.lastName} should be forced next because they are the first eligible employee in the current Force rotation.`
                        : "No employee in the current Force rotation meets the eligibility rules for this shift."}
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: "6px" }}>
                    <div style={{ fontWeight: 700 }}>Manual Select Employee</div>
                    <select
                      value={forceAssignEmployeeId}
                      onChange={(event) => setForceAssignEmployeeId(event.target.value)}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: "8px",
                        border: "1px solid #cbd5e1",
                        background: "#ffffff",
                        fontSize: "12px"
                      }}
                    >
                      <option value="">Select employee</option>
                      {forceRotationList.map((employee) => {
                        const eligibility = getForceEligibility(employee, request)
                        return (
                          <option key={`force-select-${employee.id}`} value={employee.id}>
                            {employee.firstName} {employee.lastName} | {eligibility.eligible ? "Eligible" : "Not Eligible"}
                          </option>
                        )
                      })}
                    </select>
                    <div
                      style={{
                        display: "grid",
                        gap: "6px",
                        maxHeight: "180px",
                        overflowY: "auto",
                        paddingRight: "4px"
                      }}
                    >
                      {forceRotationList.map((employee) => {
                        const eligibility = getForceEligibility(employee, request)
                        return (
                          <div
                            key={`force-eligibility-${request.id}-${employee.id}`}
                            style={{
                              border: "1px solid #dbe3ee",
                              borderRadius: "10px",
                              padding: "8px 10px",
                              background: forceAssignEmployeeId === employee.id ? "#eff6ff" : "#ffffff",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              gap: "10px"
                            }}
                          >
                            <div style={{ display: "grid", gap: "2px" }}>
                              <div style={{ fontWeight: 700, fontSize: "12px" }}>
                                {employee.firstName} {employee.lastName}
                              </div>
                              <div style={{ fontSize: "11px", color: "#64748b" }}>
                                {eligibility.reason}
                              </div>
                            </div>
                            <div
                              style={{
                                fontSize: "11px",
                                fontWeight: 800,
                                color: eligibility.eligible ? "#166534" : "#b91c1c",
                                background: eligibility.eligible ? "#ecfdf5" : "#fff1f2",
                                borderRadius: "999px",
                                padding: "4px 8px",
                                whiteSpace: "nowrap"
                              }}
                            >
                              {eligibility.eligible ? "Eligible" : "Not Eligible"}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    padding: "14px 16px",
                    borderTop: "1px solid #e2e8f0",
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "8px"
                  }}
                >
                  <button
                    onClick={() => {
                      if (!recommendedCandidate) {
                        window.alert("No eligible employee is available to be forced for this shift.")
                        return
                      }
                      void applyForceAssignment(request.id, recommendedCandidate.employee.id)
                    }}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "10px",
                      border: "none",
                      background: "#2563eb",
                      color: "#ffffff",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontSize: "12px"
                    }}
                  >
                    Force Recommended
                  </button>
                  <button
                    onClick={() => {
                      if (!forceAssignEmployeeId) {
                        window.alert("Choose an employee first.")
                        return
                      }
                      void applyForceAssignment(request.id, forceAssignEmployeeId)
                    }}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "10px",
                      border: "none",
                      background: "#dc2626",
                      color: "#ffffff",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontSize: "12px"
                    }}
                  >
                    Force Selected Employee
                  </button>
                </div>
              </div>
            </div>
          )
        })()
      )}
      {builderCalendarModal}
    </div>
  )
}

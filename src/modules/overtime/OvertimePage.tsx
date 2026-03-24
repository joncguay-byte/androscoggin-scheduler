import { useEffect, useMemo, useRef, useState } from "react"

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  Select,
  SelectItem
} from "../../components/ui/simple-ui"
import { fetchPatrolScheduleRange, invalidatePatrolScheduleCache } from "../../lib/patrol-schedule"
import type {
  AppRole,
  DetailRecord,
  Employee,
  OvertimeAvailabilityStatus,
  OvertimeShiftRequest,
  PatrolPositionCode,
  PatrolScheduleRow,
  ShiftType
} from "../../types"

type OvertimePageProps = {
  employees: Employee[]
  currentUserRole: AppRole
  patrolRows: PatrolScheduleRow[]
  patrolOverrideRows: PatrolScheduleRow[]
  setPatrolOverrideRows: React.Dispatch<React.SetStateAction<PatrolScheduleRow[]>>
  detailRecords: DetailRecord[]
  overtimeQueueIds: string[]
  setOvertimeQueueIds: React.Dispatch<React.SetStateAction<string[]>>
  overtimeShiftRequests: OvertimeShiftRequest[]
  setOvertimeShiftRequests: React.Dispatch<React.SetStateAction<OvertimeShiftRequest[]>>
  onAuditEvent: (action: string, summary: string, details?: string) => void
}

const POSITION_LABELS: Record<PatrolPositionCode, string> = {
  SUP1: "Supervisor",
  SUP2: "Supervisor",
  DEP1: "Deputy",
  DEP2: "Deputy",
  POL: "Poland"
}
const OFF_REASONS = ["Vacation", "Sick", "Court", "Training", "Bereavement", "Call Out", "Detail"] as const
const OVERTIME_CARD_STYLE = {
  border: "1px solid #dbe3ee",
  borderRadius: "10px",
  background: "#ffffff"
} as const
const LOCAL_PATROL_OVERRIDES_KEY = "androscoggin-local-patrol-overrides"
const OVERTIME_SHIFT_REQUESTS_STORAGE_KEY = "androscoggin-overtime-shift-requests"

function toIsoDate(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

function formatLongDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: "2-digit",
    day: "2-digit",
    year: "numeric"
  })
}

function getRowKey(row: Pick<PatrolScheduleRow, "assignment_date" | "shift_type" | "position_code">) {
  return `${row.assignment_date}-${row.shift_type}-${row.position_code}`
}

function getCalendarDayDiff(date: Date, anchor: Date) {
  const utcDate = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const utcAnchor = Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
  return Math.round((utcDate - utcAnchor) / 86400000)
}

function buildMonthGridDates(year: number, month: number) {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const gridStart = new Date(firstDay)
  gridStart.setDate(firstDay.getDate() - firstDay.getDay())
  gridStart.setHours(0, 0, 0, 0)
  const gridEnd = new Date(lastDay)
  gridEnd.setDate(lastDay.getDate() + (6 - lastDay.getDay()))
  gridEnd.setHours(0, 0, 0, 0)

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

function getActiveTeam(date: Date, shift: ShiftType) {
  const pitman = [0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0]
  const start = new Date("2026-03-01T12:00:00")
  const diff = getCalendarDayDiff(date, start)
  const idx = pitman[((diff % pitman.length) + pitman.length) % pitman.length]

  if (shift === "Days") return idx ? "Days A" : "Days B"
  return idx ? "Nights A" : "Nights B"
}

function getDefaultEmployeeForPosition(
  employees: Employee[],
  date: Date,
  shift: ShiftType,
  positionCode: PatrolPositionCode
) {
  const activeTeam = getActiveTeam(date, shift)
  const teamEmployees = employees.filter(
    (employee) => employee.status === "Active" && employee.team === activeTeam
  )

  switch (positionCode) {
    case "SUP1":
      return teamEmployees.find((employee) => employee.rank === "Sgt") || null
    case "SUP2":
      return teamEmployees.find((employee) => employee.rank === "Cpl") || null
    case "DEP1":
      return teamEmployees.filter((employee) => employee.rank === "Deputy")[0] || null
    case "DEP2":
      return teamEmployees.filter((employee) => employee.rank === "Deputy")[1] || null
    case "POL":
      return teamEmployees.find((employee) => employee.rank === "Poland Deputy") || null
    default:
      return null
  }
}

export function OvertimePage({
  employees,
  setOvertimeQueueIds,
  overtimeQueueIds,
  patrolRows,
  patrolOverrideRows,
  setPatrolOverrideRows,
  overtimeShiftRequests,
  setOvertimeShiftRequests,
  onAuditEvent
}: OvertimePageProps) {
  const [selectedDate] = useState(() => toIsoDate(new Date()))
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [offReason, setOffReason] = useState<(typeof OFF_REASONS)[number]>("Vacation")
  const [selectedOffDates, setSelectedOffDates] = useState<string[]>([])
  const [initialOffDates, setInitialOffDates] = useState<string[]>([])
  const [editorMonth, setEditorMonth] = useState(() => new Date().getMonth())
  const [editorYear, setEditorYear] = useState(() => new Date().getFullYear())
  const [liveSelectedDateRows, setLiveSelectedDateRows] = useState<PatrolScheduleRow[]>([])
  const [overtimeUndoStack, setOvertimeUndoStack] = useState<Array<{
    requests: OvertimeShiftRequest[]
    overrides: PatrolScheduleRow[]
    queueIds: string[]
  }>>([])
  const selectedWeekRef = useRef<HTMLDivElement | null>(null)
  const overtimeRequestsRef = useRef<OvertimeShiftRequest[]>(overtimeShiftRequests)
  const localOverridesRef = useRef<PatrolScheduleRow[]>(patrolOverrideRows)
  const overtimeQueueRef = useRef<string[]>(overtimeQueueIds)

  useEffect(() => {
    let active = true

    async function loadSelectedDateRows() {
      const { data } = await fetchPatrolScheduleRange(selectedDate, selectedDate)
      if (active) {
        setLiveSelectedDateRows((data || []) as PatrolScheduleRow[])
      }
    }

    void loadSelectedDateRows()

    return () => {
      active = false
    }
  }, [selectedDate])

  const employeeMap = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee])),
    [employees]
  )

  useEffect(() => {
    overtimeRequestsRef.current = overtimeShiftRequests
  }, [overtimeShiftRequests])

  useEffect(() => {
    localOverridesRef.current = patrolOverrideRows
  }, [patrolOverrideRows])

  useEffect(() => {
    overtimeQueueRef.current = overtimeQueueIds
  }, [overtimeQueueIds])

  const effectivePatrolRows = useMemo(() => {
    const merged = new Map<string, PatrolScheduleRow>()
    for (const row of patrolRows) merged.set(getRowKey(row), row)
    for (const row of liveSelectedDateRows) merged.set(getRowKey(row), row)
    for (const row of patrolOverrideRows) merged.set(getRowKey(row), row)
    return [...merged.values()]
  }, [liveSelectedDateRows, patrolOverrideRows, patrolRows])

  const shiftRosterRows = useMemo(() => {
    const rankOrder = new Map([
      ["Sgt", 0],
      ["Cpl", 1],
      ["Deputy", 2],
      ["Poland Deputy", 3]
    ])

    const sortEmployees = (left: Employee, right: Employee) => {
      const leftTeamOrder = left.team.startsWith("Days") ? 0 : 1
      const rightTeamOrder = right.team.startsWith("Days") ? 0 : 1
      if (leftTeamOrder !== rightTeamOrder) return leftTeamOrder - rightTeamOrder

      const leftRank = rankOrder.get(left.rank) ?? 99
      const rightRank = rankOrder.get(right.rank) ?? 99
      if (leftRank !== rightRank) return leftRank - rightRank

      return left.lastName.localeCompare(right.lastName)
    }

    return [
      {
        key: "A",
        label: "A Shift",
        employees: employees
          .filter((employee) => employee.status === "Active" && (employee.team === "Days A" || employee.team === "Nights A"))
          .sort(sortEmployees)
      },
      {
        key: "B",
        label: "B Shift",
        employees: employees
          .filter((employee) => employee.status === "Active" && (employee.team === "Days B" || employee.team === "Nights B"))
          .sort(sortEmployees)
      }
    ]
  }, [employees])

  const selectedEmployee = selectedEmployeeId ? employeeMap.get(selectedEmployeeId) || null : null
  const sortedOvertimeRequests = useMemo(
    () =>
      [...overtimeShiftRequests]
        .filter((request) => {
          if (request.status === "Closed") return false
          if (request.source !== "Patrol Open Shift") return true
          return request.selectionActive === true
        })
        .sort(
        (a, b) =>
          a.assignmentDate.localeCompare(b.assignmentDate) ||
          a.shiftType.localeCompare(b.shiftType) ||
          a.positionCode.localeCompare(b.positionCode)
        ),
      [overtimeShiftRequests]
    )

  const activeFillRequest = useMemo(
    () => sortedOvertimeRequests.find((request) => request.workflowStatus === "Fill") || null,
    [sortedOvertimeRequests]
  )

  const focusedRequest = activeFillRequest || sortedOvertimeRequests[0] || null

  const recommendationByRequestId = useMemo(() => {
    const recommendations = new Map<string, string[]>()
    const patrolRanks = new Set(["Sgt", "Cpl", "Deputy", "Poland Deputy"])

    function previousDate(dateValue: string) {
      const date = new Date(`${dateValue}T12:00:00`)
      date.setDate(date.getDate() - 1)
      return toIsoDate(date)
    }

    function nextDate(dateValue: string) {
      const date = new Date(`${dateValue}T12:00:00`)
      date.setDate(date.getDate() + 1)
      return toIsoDate(date)
    }

    function employeeWorksFallbackShift(employee: Employee, dateValue: string, shiftType: ShiftType) {
      if (!patrolRanks.has(employee.rank)) return false
      const date = new Date(`${dateValue}T12:00:00`)
      return employee.team === getActiveTeam(date, shiftType)
    }

    function employeeWorkingShift(employeeId: string, dateValue: string, shiftType: ShiftType) {
      const explicitRows = effectivePatrolRows.filter(
        (row) => row.assignment_date === dateValue && row.shift_type === shiftType
      )

      const explicitWorking = explicitRows.some((row) =>
        row.replacement_employee_id === employeeId ||
        (row.employee_id === employeeId && row.status === "Scheduled")
      )

      if (explicitWorking) return true

      const employee = employeeMap.get(employeeId)
      if (!employee) return false
      return employeeWorksFallbackShift(employee, dateValue, shiftType)
    }

    function employeeHasSameDayConflict(employeeId: string, dateValue: string) {
      return employeeWorkingShift(employeeId, dateValue, "Days") || employeeWorkingShift(employeeId, dateValue, "Nights")
    }

    function employeeHasTurnaroundConflict(employeeId: string, dateValue: string, shiftType: ShiftType) {
      if (shiftType === "Days") {
        return employeeWorkingShift(employeeId, previousDate(dateValue), "Nights")
      }
      return employeeWorkingShift(employeeId, nextDate(dateValue), "Days")
    }

    for (const request of sortedOvertimeRequests) {
      const ranked = request.responses
        .filter((response) => response.status === "Interested" || response.status === "Accepted")
        .map((response) => {
          const employee = employeeMap.get(response.employeeId)
          if (!employee) return null
          if (request.offEmployeeId === employee.id) return null

          const sameDayConflict = employeeHasSameDayConflict(employee.id, request.assignmentDate)
          const turnaroundConflict = employeeHasTurnaroundConflict(employee.id, request.assignmentDate, request.shiftType)
          const eligible = !sameDayConflict && !turnaroundConflict
          const overtimeListPosition = overtimeQueueIds.indexOf(employee.id)
          const listPriority = overtimeListPosition >= 0 ? overtimeListPosition : Number.MAX_SAFE_INTEGER
          const responsePriority = response.status === "Accepted" ? 0 : 1

          return {
            employee,
            eligible,
            overtimeListPosition,
            listPriority,
            responsePriority
          }
        })
        .filter((entry): entry is {
          employee: Employee
          eligible: boolean
          overtimeListPosition: number
          listPriority: number
          responsePriority: number
        } => Boolean(entry))
        .filter((entry) => entry.eligible)
        .sort((left, right) =>
          left.listPriority - right.listPriority ||
          left.responsePriority - right.responsePriority ||
          left.employee.hireDate.localeCompare(right.employee.hireDate) ||
          left.employee.lastName.localeCompare(right.employee.lastName)
        )
        .slice(0, 3)
        .map((entry) => entry.employee.lastName)

      recommendations.set(request.id, ranked)
    }

    return recommendations
  }, [effectivePatrolRows, employeeMap, overtimeQueueIds, sortedOvertimeRequests])

  function employeeRespondedAvailable(request: OvertimeShiftRequest | null, employeeId: string) {
    if (!request) return false
    return request.responses.some(
      (response) =>
        response.employeeId === employeeId &&
        (response.status === "Interested" || response.status === "Accepted")
    )
  }

  const overtimeQueueList = useMemo(() => {
    const queueEmployees = overtimeQueueIds
      .map((employeeId) => employeeMap.get(employeeId))
      .filter((employee): employee is Employee => Boolean(employee))

    const missingActiveEmployees = employees
      .filter((employee) => employee.status === "Active" && !overtimeQueueIds.includes(employee.id))
      .sort((a, b) => a.hireDate.localeCompare(b.hireDate))

    return [...queueEmployees, ...missingActiveEmployees]
  }, [employeeMap, employees, overtimeQueueIds])

  function advanceEmployeeToQueueBottom(employeeId: string) {
    setOvertimeQueueIds((current) => {
      if (!current.includes(employeeId)) return current
      return [...current.filter((id) => id !== employeeId), employeeId]
    })
  }

  function setEmployeeResponseForRequest(
    requestId: string,
    employeeId: string,
    status: OvertimeAvailabilityStatus
  ) {
    pushUndoSnapshot()
    const now = new Date().toISOString()

    updateOvertimeRequests((current) =>
      current.map((request) => {
        if (request.id !== requestId) return request

        const existingIndex = request.responses.findIndex((response) => response.employeeId === employeeId)
        const nextResponses = [...request.responses]

        if (existingIndex >= 0) {
          nextResponses[existingIndex] = {
            employeeId,
            status,
            updatedAt: now
          }
        } else {
          nextResponses.push({
            employeeId,
            status,
            updatedAt: now
          })
        }

        return {
          ...request,
          responses: nextResponses
        }
      })
    )

    if (status === "Accepted" || status === "Declined" || status === "No Response" || status === "Assigned") {
      advanceEmployeeToQueueBottom(employeeId)
    }

    const employee = employeeMap.get(employeeId)
    onAuditEvent(
      "Overtime Response Recorded",
      `${employee ? `${employee.firstName} ${employee.lastName}` : "Employee"} marked ${status} for overtime shift.`,
      requestId
    )
  }

  useEffect(() => {
    updateOvertimeRequests((current) => {
      const next = current.flatMap((request) => {
        if (request.source !== "Patrol Open Shift") return [request]

        const matchingRow =
          effectivePatrolRows.find(
            (row) =>
              row.assignment_date === request.assignmentDate &&
              row.shift_type === request.shiftType &&
              row.position_code === request.positionCode
          ) || null

        if (!matchingRow) return []
        if (!matchingRow.status || matchingRow.status === "Scheduled") return []
        if (request.offEmployeeId && matchingRow.employee_id !== request.offEmployeeId) return []

        const offEmployee = matchingRow.employee_id
          ? employeeMap.get(matchingRow.employee_id) || null
          : null

        return [{
          ...request,
          offEmployeeId: matchingRow.employee_id ?? request.offEmployeeId ?? null,
          offEmployeeLastName: offEmployee?.lastName || request.offEmployeeLastName || null,
          offHours: matchingRow.shift_hours || request.offHours || null,
          assignedEmployeeId: matchingRow.replacement_employee_id || request.assignedEmployeeId || null,
          selectionActive: true
        }]
      })

      const unchanged =
        next.length === current.length &&
        next.every((request, index) => JSON.stringify(request) === JSON.stringify(current[index]))

      return unchanged ? current : next
    })
  }, [effectivePatrolRows, employeeMap])

  const editorDays = useMemo(() => {
    const lastDay = new Date(editorYear, editorMonth + 1, 0)
    return Array.from({ length: lastDay.getDate() }, (_, index) => toIsoDate(new Date(editorYear, editorMonth, index + 1)))
  }, [editorMonth, editorYear])

  const editorVisibleWeeks = useMemo(
    () => chunkDates(buildMonthGridDates(editorYear, editorMonth), 7),
    [editorMonth, editorYear]
  )

  const selectedEmployeeSchedule = useMemo(() => {
    if (!selectedEmployeeId) return []

    return editorDays.flatMap((dateValue) => {
      const date = new Date(`${dateValue}T12:00:00`)
      const rowsForEmployee = effectivePatrolRows.filter(
        (row) => row.assignment_date === dateValue && row.employee_id === selectedEmployeeId
      )

      if (rowsForEmployee.length > 0) return rowsForEmployee

      const defaultRows: PatrolScheduleRow[] = []
      for (const shiftType of ["Days", "Nights"] as ShiftType[]) {
        for (const positionCode of ["SUP1", "SUP2", "DEP1", "DEP2", "POL"] as PatrolPositionCode[]) {
          const defaultEmployee = getDefaultEmployeeForPosition(employees, date, shiftType, positionCode)
          if (defaultEmployee?.id === selectedEmployeeId) {
            defaultRows.push({
              assignment_date: dateValue,
              shift_type: shiftType,
              position_code: positionCode,
              employee_id: defaultEmployee.id,
              vehicle: defaultEmployee.defaultVehicle,
              shift_hours: defaultEmployee.defaultShiftHours,
              status: "Scheduled",
              replacement_employee_id: null,
              replacement_vehicle: null,
              replacement_hours: defaultEmployee.defaultShiftHours
            })
          }
        }
      }

      return defaultRows
    })
  }, [editorDays, effectivePatrolRows, employees, selectedEmployeeId])

  const scheduleByDate = useMemo(() => {
    const grouped = new Map<string, PatrolScheduleRow[]>()
    for (const row of selectedEmployeeSchedule) {
      const current = grouped.get(row.assignment_date) || []
      current.push(row)
      grouped.set(row.assignment_date, current)
    }
    return grouped
  }, [selectedEmployeeSchedule])

  function toggleOffDate(dateValue: string) {
    if (!scheduleByDate.has(dateValue)) return
    setSelectedOffDates((current) =>
      current.includes(dateValue)
        ? current.filter((entry) => entry !== dateValue)
        : [...current, dateValue].sort()
    )
  }

  function shiftEditorMonth(direction: -1 | 1) {
    const next = new Date(editorYear, editorMonth + direction, 1)
    setEditorMonth(next.getMonth())
    setEditorYear(next.getFullYear())
  }

  function startEmployeeEditor(employeeId: string | null) {
    if (!employeeId) return
    setSelectedEmployeeId(employeeId)
    const anchor = new Date(`${selectedDate}T12:00:00`)
    setEditorMonth(anchor.getMonth())
    setEditorYear(anchor.getFullYear())
  }

  useEffect(() => {
    if (!selectedEmployeeId) {
      setSelectedOffDates([])
      setInitialOffDates([])
      return
    }

    const offDates = new Set<string>()

    for (const row of selectedEmployeeSchedule) {
      if (row.employee_id === selectedEmployeeId && row.status && row.status !== "Scheduled") {
        offDates.add(row.assignment_date)
      }
    }

    const nextOffDates = [...offDates].sort()
    setSelectedOffDates(nextOffDates)
    setInitialOffDates(nextOffDates)
  }, [selectedEmployeeId, selectedEmployeeSchedule])

  useEffect(() => {
    if (!selectedEmployeeId || !selectedWeekRef.current) return
    selectedWeekRef.current.scrollIntoView({ block: "start", behavior: "smooth" })
  }, [editorVisibleWeeks, selectedDate, selectedEmployeeId])

  function updateOvertimeRequests(
    updater: (current: OvertimeShiftRequest[]) => OvertimeShiftRequest[]
  ) {
    setOvertimeShiftRequests((current) => {
      const next = updater(current)
      overtimeRequestsRef.current = next
      return next
    })
  }

  function pushUndoSnapshot() {
    const requestSnapshot = overtimeRequestsRef.current.map((request) => ({ ...request, responses: [...request.responses] }))
    const overrideSnapshot = localOverridesRef.current.map((row) => ({ ...row }))
    const queueSnapshot = [...overtimeQueueRef.current]
    setOvertimeUndoStack((stack) => [
      { requests: requestSnapshot, overrides: overrideSnapshot, queueIds: queueSnapshot },
      ...stack
    ].slice(0, 10))
  }

  function normalizeRequestsAgainstOverrides(
    requests: OvertimeShiftRequest[],
    overrides: PatrolScheduleRow[]
  ) {
    return requests.map((request) => {
      const matchingOverride = overrides.find(
        (row) =>
          row.assignment_date === request.assignmentDate &&
          row.shift_type === request.shiftType &&
          row.position_code === request.positionCode
      ) || null

      const assignedEmployeeId = matchingOverride?.replacement_employee_id || null
      const shouldClearSelection =
        request.workflowStatus === "Fill" ||
        request.status === "Assigned" ||
        !!request.assignedEmployeeId
      const nextWorkflowStatus: OvertimeShiftRequest["workflowStatus"] =
        assignedEmployeeId
          ? "Fill"
          : request.workflowStatus === "Close" || request.workflowStatus === "Force"
            ? request.workflowStatus
            : "Open"
      const nextStatus: OvertimeShiftRequest["status"] =
        request.workflowStatus === "Close"
          ? "Closed"
          : assignedEmployeeId
            ? "Assigned"
            : "Open"

      return {
        ...request,
        assignedEmployeeId: assignedEmployeeId || (shouldClearSelection ? null : request.assignedEmployeeId),
        workflowStatus: nextWorkflowStatus,
        status: nextStatus
      }
    })
  }

  function applyEmployeeOffDates() {
    if (!selectedEmployeeId) return

    pushUndoSnapshot()
    const updatedRows: PatrolScheduleRow[] = []
    const requestsToUpsert = new Map<string, OvertimeShiftRequest>()
    const requestKeysToRemove = new Set<string>()
    const selectedDatesSet = new Set(selectedOffDates)

    let nextRequestsSnapshot: OvertimeShiftRequest[] = []

    updateOvertimeRequests((current) => {
      const nextRequests = [...current]

      for (const [dateValue, rows] of scheduleByDate.entries()) {
        for (const row of rows) {
          const key = `${row.assignment_date}-${row.shift_type}-${row.position_code}`
          const offEmployee = employeeMap.get(selectedEmployeeId)
          const isSelected = selectedDatesSet.has(dateValue)

          updatedRows.push({
            ...row,
            status: isSelected ? offReason : "Scheduled",
            replacement_employee_id: isSelected ? row.replacement_employee_id : null,
            replacement_vehicle: isSelected ? row.replacement_vehicle : null,
            replacement_hours: isSelected ? row.replacement_hours : row.shift_hours
          })

          if (isSelected) {
            const existingIndex = nextRequests.findIndex(
              (request) =>
                `${request.assignmentDate}-${request.shiftType}-${request.positionCode}` === key
            )

            if (existingIndex >= 0) {
              nextRequests[existingIndex] = {
                ...nextRequests[existingIndex],
                description: `${POSITION_LABELS[row.position_code]} coverage needed for ${employeeName(employeeMap.get(selectedEmployeeId))}`,
                offEmployeeId: selectedEmployeeId,
                offEmployeeLastName: offEmployee?.lastName || null,
                offHours: row.shift_hours || offEmployee?.defaultShiftHours || null,
                selectionActive: true,
                workflowStatus: "Open",
                status: "Open"
              }
            } else if (!requestsToUpsert.has(key)) {
              requestsToUpsert.set(key, {
                id: crypto.randomUUID(),
                source: "Patrol Open Shift",
                assignmentDate: row.assignment_date,
                shiftType: row.shift_type,
                positionCode: row.position_code,
                description: `${POSITION_LABELS[row.position_code]} coverage needed for ${employeeName(employeeMap.get(selectedEmployeeId))}`,
                offEmployeeId: selectedEmployeeId,
                offEmployeeLastName: offEmployee?.lastName || null,
                offHours: row.shift_hours || offEmployee?.defaultShiftHours || null,
                selectionActive: true,
                workflowStatus: "Open",
                status: "Open",
                assignedEmployeeId: null,
                createdAt: new Date().toISOString(),
                responses: []
              })
            }
          } else {
            requestKeysToRemove.add(key)
          }
        }
      }

      nextRequestsSnapshot = [...nextRequests, ...requestsToUpsert.values()]
        .filter((request) => {
          const key = `${request.assignmentDate}-${request.shiftType}-${request.positionCode}`
          if (!requestKeysToRemove.has(key)) return true
          if (request.offEmployeeId !== selectedEmployeeId) return true
          if (request.source !== "Patrol Open Shift") return true
          return false
        })
        .sort(
        (a, b) =>
          a.assignmentDate.localeCompare(b.assignmentDate) ||
          a.shiftType.localeCompare(b.shiftType) ||
          a.positionCode.localeCompare(b.positionCode)
      )

      return nextRequestsSnapshot
    })

    if (updatedRows.length > 0) {
      const merged = new Map<string, PatrolScheduleRow>()
      for (const row of localOverridesRef.current) merged.set(getRowKey(row), row)
      for (const row of updatedRows) merged.set(getRowKey(row), row)
      const nextOverrides = [...merged.values()]
      localOverridesRef.current = nextOverrides
      invalidatePatrolScheduleCache()
      setPatrolOverrideRows(nextOverrides)

      if (typeof window !== "undefined") {
        window.localStorage.setItem(LOCAL_PATROL_OVERRIDES_KEY, JSON.stringify(nextOverrides))
      }
    }

    if (typeof window !== "undefined" && nextRequestsSnapshot.length > 0) {
      window.localStorage.setItem(OVERTIME_SHIFT_REQUESTS_STORAGE_KEY, JSON.stringify(nextRequestsSnapshot))
    }

    onAuditEvent(
      "Employee Marked Off",
      `${employeeName(employeeMap.get(selectedEmployeeId))} marked off in Overtime module.`,
      `${offReason} | ${selectedOffDates.join(", ")}`
    )

    setSelectedEmployeeId(null)
    setSelectedOffDates([])
    setInitialOffDates([])
  }

  function employeeName(employee?: Employee | null) {
    if (!employee) return "Unknown Employee"
    return `${employee.firstName} ${employee.lastName}`
  }

  function hasOffDateChanges() {
    if (selectedOffDates.length !== initialOffDates.length) return true
    return selectedOffDates.some((date, index) => date !== initialOffDates[index])
  }

  function handleCloseWindow() {
    setSelectedEmployeeId(null)
    setSelectedOffDates([])
    setInitialOffDates([])
  }

  function setOvertimeRequestStatus(requestId: string, workflowStatus: "Open" | "Fill" | "Force" | "Close") {
    pushUndoSnapshot()
    updateOvertimeRequests((current) =>
      current.map((request) =>
        request.id === requestId
          ? (() => {
              const nextWorkflowStatus =
                request.workflowStatus === workflowStatus
                  ? "Open"
                  : workflowStatus

              return {
                ...request,
                workflowStatus: nextWorkflowStatus,
                status:
                  nextWorkflowStatus === "Open"
                    ? "Open"
                    : nextWorkflowStatus === "Close"
                      ? "Closed"
                      : "Assigned"
              }
            })()
          : request
      )
    )

    onAuditEvent(
      "Overtime Shift Status Updated",
      `Overtime shift marked ${workflowStatus}.`,
      requestId
    )
  }

  function undoOvertimeAction() {
    setOvertimeUndoStack((current) => {
      if (current.length === 0) return current
      const [previous, ...rest] = current
      const normalizedRequests = normalizeRequestsAgainstOverrides(previous.requests, previous.overrides)
      overtimeRequestsRef.current = normalizedRequests
      localOverridesRef.current = previous.overrides
      overtimeQueueRef.current = previous.queueIds
      setOvertimeShiftRequests(normalizedRequests)
      setPatrolOverrideRows(previous.overrides)
      setOvertimeQueueIds(previous.queueIds)
      invalidatePatrolScheduleCache()
      onAuditEvent("Overtime Undo", "Undid the previous overtime action.")
      return rest
    })
  }

  function assignEmployeeToRequest(requestId: string, employeeId: string) {
    pushUndoSnapshot()
    updateOvertimeRequests((current) =>
      current.map((request) =>
        request.id === requestId
          ? {
              ...request,
              assignedEmployeeId: request.assignedEmployeeId === employeeId ? null : employeeId
            }
          : request
      )
    )

    const employee = employeeMap.get(employeeId)
    onAuditEvent(
      "Overtime Shift Candidate Selected",
      `${employee ? `${employee.firstName} ${employee.lastName}` : "Employee"} selected for overtime shift.`,
      requestId
    )
  }

  function saveReplacementToPatrol(request: OvertimeShiftRequest) {
    pushUndoSnapshot()
    const replacementEmployee = request.assignedEmployeeId
      ? employeeMap.get(request.assignedEmployeeId) || null
      : null

    const existingRow =
      effectivePatrolRows.find(
        (row) =>
          row.assignment_date === request.assignmentDate &&
          row.shift_type === request.shiftType &&
          row.position_code === request.positionCode
      ) || null

    const nextRow: PatrolScheduleRow = {
      id: existingRow?.id,
      assignment_date: request.assignmentDate,
      shift_type: request.shiftType,
      position_code: request.positionCode,
      employee_id: request.offEmployeeId || existingRow?.employee_id || null,
      vehicle: existingRow?.vehicle || null,
      shift_hours:
        existingRow?.shift_hours ||
        request.offHours ||
        replacementEmployee?.defaultShiftHours ||
        null,
      status: existingRow?.status || "Scheduled",
      replacement_employee_id: replacementEmployee?.id || null,
      replacement_vehicle: replacementEmployee?.defaultVehicle || null,
      replacement_hours:
        replacementEmployee
          ? existingRow?.shift_hours || request.offHours || replacementEmployee.defaultShiftHours
          : null
    }

    const merged = new Map<string, PatrolScheduleRow>()
    for (const row of localOverridesRef.current) merged.set(getRowKey(row), row)
    merged.set(getRowKey(nextRow), nextRow)
    const nextOverrides = [...merged.values()]

    localOverridesRef.current = nextOverrides
    invalidatePatrolScheduleCache()
    setPatrolOverrideRows(nextOverrides)

    updateOvertimeRequests((current) =>
      current.map((entry) =>
        entry.id === request.id
          ? {
              ...entry,
              status: replacementEmployee ? "Assigned" : "Open",
              workflowStatus: replacementEmployee ? "Fill" : "Open",
              assignedEmployeeId: replacementEmployee?.id || null,
              responses: replacementEmployee
                ? (() => {
                    const now = new Date().toISOString()
                    const existingIndex = entry.responses.findIndex(
                      (response) => response.employeeId === replacementEmployee.id
                    )
                    if (existingIndex >= 0) {
                      const nextResponses = [...entry.responses]
                      nextResponses[existingIndex] = {
                        employeeId: replacementEmployee.id,
                        status: "Assigned",
                        updatedAt: now
                      }
                      return nextResponses
                    }

                    return [
                      ...entry.responses,
                      {
                        employeeId: replacementEmployee.id,
                        status: "Assigned" as const,
                        updatedAt: now
                      }
                    ]
                  })()
                : entry.responses
            }
          : entry
      )
    )

    if (replacementEmployee) {
      advanceEmployeeToQueueBottom(replacementEmployee.id)
      onAuditEvent(
        "Overtime Replacement Saved",
        `${replacementEmployee.firstName} ${replacementEmployee.lastName} saved as Patrol replacement.`,
        `${request.assignmentDate} | ${request.shiftType} | ${POSITION_LABELS[request.positionCode]}`
      )
    } else {
      onAuditEvent(
        "Overtime Replacement Cleared",
        "Removed the saved Patrol replacement from the overtime shift.",
        `${request.assignmentDate} | ${request.shiftType} | ${POSITION_LABELS[request.positionCode]}`
      )
    }
  }

  const overtimeShiftsColumn = (
    <Card>
      <CardHeader>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <CardTitle>Available Overtime Shifts</CardTitle>
          <Button onClick={undoOvertimeAction} disabled={overtimeUndoStack.length === 0}>
            Undo
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div style={{ display: "grid", gap: "8px" }}>
          {sortedOvertimeRequests.length === 0 && (
            <div style={{ color: "#64748b", fontSize: "13px" }}>
              No overtime shifts generated yet.
            </div>
          )}

          {sortedOvertimeRequests.map((request) => (
            (() => {
              const patrolRow =
                effectivePatrolRows.find(
                  (row) =>
                    row.assignment_date === request.assignmentDate &&
                    row.shift_type === request.shiftType &&
                    row.position_code === request.positionCode
                ) || null
              const offEmployee = patrolRow?.employee_id ? employeeMap.get(patrolRow.employee_id) : null
              const offEmployeeLastName = offEmployee?.lastName || request.offEmployeeLastName || ""
              const offHours = patrolRow?.shift_hours || offEmployee?.defaultShiftHours || request.offHours || ""
              const replacementName =
                patrolRow?.replacement_employee_id
                  ? employeeMap.get(patrolRow.replacement_employee_id)?.lastName || ""
                  : request.assignedEmployeeId
                    ? employeeMap.get(request.assignedEmployeeId)?.lastName || ""
                    : ""
              const interestedResponders = request.responses
                .filter((response) => response.status === "Interested" || response.status === "Accepted")
                .map((response) => employeeMap.get(response.employeeId))
                .filter((employee): employee is Employee => Boolean(employee))
                .map((employee) => employee.lastName)
              const recommendedResponders = recommendationByRequestId.get(request.id) || []

              return (
                <div
                  key={request.id}
                  style={{
                    ...OVERTIME_CARD_STYLE,
                    padding: "12px",
                    display: "grid",
                    gap: "6px"
                  }}
                >
                  <div style={{ fontSize: "13px", color: "#0f172a", lineHeight: 1.25, fontWeight: 700 }}>
                    {formatLongDate(request.assignmentDate)}, {getActiveTeam(new Date(`${request.assignmentDate}T12:00:00`), request.shiftType)}, {POSITION_LABELS[request.positionCode]}, {offEmployeeLastName}, {offHours}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                    {[
                      { label: "Open", value: "Open" as const },
                      { label: "Fill", value: "Fill" as const },
                      { label: "Force", value: "Force" as const },
                      { label: "Close", value: "Close" as const }
                    ].map((option) => {
                      const active = (request.workflowStatus || "Open") === option.value
                      const palette =
                        option.value === "Open"
                          ? { activeBg: "#2563eb", activeBorder: "#2563eb", activeColor: "#ffffff" }
                          : option.value === "Fill"
                            ? { activeBg: "#facc15", activeBorder: "#eab308", activeColor: "#1f2937" }
                            : option.value === "Force"
                              ? { activeBg: "#dc2626", activeBorder: "#dc2626", activeColor: "#ffffff" }
                              : { activeBg: "#9ca3af", activeBorder: "#6b7280", activeColor: "#ffffff" }

                      return (
                          <button
                            key={`${request.id}-${option.label}`}
                            onClick={() => setOvertimeRequestStatus(request.id, option.value)}
                            style={{
                              minWidth: "70px",
                              padding: "7px 12px",
                              borderRadius: "8px",
                              border: active ? `1px solid ${palette.activeBorder}` : "1px solid #cbd5e1",
                              background: active ? palette.activeBg : "#ffffff",
                              color: active ? palette.activeColor : "#0f172a",
                              fontSize: "13px",
                              fontWeight: 700,
                              lineHeight: 1,
                              cursor: "pointer"
                            }}
                        >
                          {option.label}
                        </button>
                      )
                    })}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", fontSize: "12px", color: "#64748b" }}>
                    <div>
                      Responses: {interestedResponders.length > 0 ? interestedResponders.join(", ") : "None"}
                    </div>
                    <div>
                      Recommendation: {recommendedResponders.length > 0 ? recommendedResponders.join(", ") : "None"}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", fontSize: "12px", color: "#64748b" }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "#334155" }}>
                      Replacement: {replacementName}
                    </div>
                    <Button
                      onClick={() => saveReplacementToPatrol(request)}
                      disabled={!request.assignedEmployeeId && !patrolRow?.replacement_employee_id}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              )
            })()
          ))}
        </div>
      </CardContent>
    </Card>
  )

  const availableRespondersColumn = (
    <Card>
      <CardHeader>
        <CardTitle>Available Responders</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          style={{
            display: "grid",
            gap: "8px",
            maxHeight: "420px",
            overflowY: "auto",
            paddingRight: "4px"
          }}
        >
          {!focusedRequest && (
            <div style={{ color: "#64748b", fontSize: "13px" }}>
              Set a shift to Fill to record responses and compare available employees.
            </div>
          )}
          {focusedRequest && overtimeQueueList.map((employee) => {
            const response =
              focusedRequest.responses.find((entry) => entry.employeeId === employee.id) || null
            const respondedAvailable =
              response?.status === "Interested" || response?.status === "Accepted"
            const responseButtons: OvertimeAvailabilityStatus[] = ["Interested", "Accepted", "Declined", "No Response"]

            return (
            <div
              key={employee.id}
              style={{
                ...OVERTIME_CARD_STYLE,
                padding: "10px",
                display: "grid",
                gap: "6px"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                <div style={{ fontWeight: 700 }}>{employee.firstName} {employee.lastName}</div>
                <div style={{ fontSize: "11px", color: respondedAvailable ? "#15803d" : "#64748b", fontWeight: 700 }}>
                  {response?.status || "Pending"}
                </div>
              </div>
              <div style={{ fontSize: "11px", color: "#64748b" }}>
                Queue position: {Math.max(overtimeQueueIds.indexOf(employee.id) + 1, 1)}
              </div>
              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                {responseButtons.map((status) => {
                  const active = response?.status === status
                  return (
                    <button
                      key={`${employee.id}-${status}`}
                      onClick={() => setEmployeeResponseForRequest(focusedRequest.id, employee.id, status)}
                      style={{
                        border: active ? "1px solid #1d4ed8" : "1px solid #cbd5e1",
                        background: active ? "#eff6ff" : "#ffffff",
                        color: active ? "#1d4ed8" : "#334155",
                        borderRadius: "8px",
                        padding: "4px 7px",
                        fontSize: "10px",
                        fontWeight: 700,
                        cursor: "pointer"
                      }}
                    >
                      {status}
                    </button>
                  )
                })}
              </div>
              {activeFillRequest && employeeRespondedAvailable(activeFillRequest, employee.id) ? (
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "11px",
                    color: "#334155",
                    marginTop: "2px"
                  }}
                >
                  <input
                    type="checkbox"
                    checked={activeFillRequest.assignedEmployeeId === employee.id}
                    onChange={() => assignEmployeeToRequest(activeFillRequest.id, employee.id)}
                  />
                  Available for selected fill shift
                </label>
              ) : null}
            </div>
          )})}
        </div>
      </CardContent>
    </Card>
  )

  const overtimeQueueColumn = (
    <Card>
      <CardHeader>
        <CardTitle>Overtime List</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          style={{
            display: "grid",
            gap: "8px",
            maxHeight: "420px",
            overflowY: "auto",
            paddingRight: "4px"
          }}
        >
          {overtimeQueueList.length === 0 && (
            <div style={{ color: "#64748b", fontSize: "13px" }}>
              No employees are on the overtime list yet.
            </div>
          )}

          {overtimeQueueList.map((employee, index) => (
            <div
              key={employee.id}
              style={{
                border: index === 0 ? "2px solid #16a34a" : OVERTIME_CARD_STYLE.border,
                borderRadius: "10px",
                background: index === 0 ? "#f0fdf4" : "#ffffff",
                padding: "7px 8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px"
              }}
            >
              <div style={{ display: "grid", gap: "2px" }}>
                <div style={{ fontWeight: 700, fontSize: "12px", lineHeight: 1.1 }}>
                  {employee.firstName} {employee.lastName}
                </div>
                <div style={{ fontSize: "10px", color: "#64748b", lineHeight: 1.1 }}>
                  {employee.rank}
                </div>
              </div>
              <div
                style={{
                  fontSize: index === 0 ? "16px" : "10px",
                  fontWeight: 800,
                  color: index === 0 ? "#16a34a" : "#94a3b8",
                  minWidth: "16px",
                  textAlign: "center"
                }}
              >
                {index === 0 ? "✓" : `${index + 1}`}
              </div>
              {activeFillRequest ? (
                <div
                  style={{
                    gridColumn: "1 / -1",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "10px",
                    color: "#334155",
                    marginTop: "2px"
                  }}
                >
                  <input
                    type="checkbox"
                    checked={activeFillRequest.assignedEmployeeId === employee.id}
                    onChange={() => assignEmployeeToRequest(activeFillRequest.id, employee.id)}
                  />
                  Select for active fill shift
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )

  const employeeEditorOverlay = selectedEmployee ? (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        zIndex: 1000,
        padding: "18px",
        overflowY: "auto"
      }}
    >
      <div
        style={{
          maxWidth: "1220px",
          margin: "0 auto"
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Patrol Schedule View For {employeeName(selectedEmployee)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ display: "grid", gap: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                <Button onClick={() => shiftEditorMonth(-1)}>Previous Month</Button>
                <div style={{ fontWeight: 700 }}>
                  {new Date(editorYear, editorMonth, 1).toLocaleDateString(undefined, {
                    month: "long",
                    year: "numeric"
                  })}
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <Button onClick={() => shiftEditorMonth(1)}>Next Month</Button>
                  <Button onClick={handleCloseWindow}>
                    Close Window
                  </Button>
                </div>
              </div>

              <div style={{ maxWidth: "220px", justifySelf: "center", width: "100%" }}>
                <Label>Reason</Label>
                <Select value={offReason} onValueChange={(value) => setOffReason(value as (typeof OFF_REASONS)[number])}>
                  {OFF_REASONS.map((reason) => (
                    <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                  ))}
                </Select>
              </div>

              <div
                style={{
                  position: "sticky",
                  top: "10px",
                  zIndex: 5,
                  display: "flex",
                  justifyContent: "center",
                  gap: "8px",
                  padding: "8px 0",
                  background: "rgba(255,255,255,0.96)"
                }}
              >
                <Button onClick={() => shiftEditorMonth(-1)}>
                  Prev Month
                </Button>
                <Button onClick={applyEmployeeOffDates} disabled={!hasOffDateChanges()}>
                  Save
                </Button>
                <Button onClick={handleCloseWindow}>
                  Close
                </Button>
                <Button onClick={() => shiftEditorMonth(1)}>
                  Next Month
                </Button>
              </div>

              <div style={{ display: "grid", gap: "10px" }}>
                {editorVisibleWeeks.map((weekDates, weekIndex) => (
                  <div
                    key={`week-${weekIndex}`}
                    ref={weekDates.some((date) => toIsoDate(date) === selectedDate) ? selectedWeekRef : null}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "112px repeat(7, minmax(0, 1fr))",
                      gap: "4px",
                      alignItems: "stretch"
                    }}
                  >
                    <div
                      style={{
                        position: "sticky",
                        top: "58px",
                        zIndex: 4,
                        background: "#ffffff"
                      }}
                    />
                    {weekDates.map((date) => (
                      <div
                        key={toIsoDate(date)}
                        style={{
                          position: "sticky",
                          top: "58px",
                          zIndex: 4,
                          border: "1px solid #dbe3ee",
                          borderRadius: "8px",
                          background: "#f8fafc",
                          padding: "6px",
                          textAlign: "center",
                          fontWeight: 700,
                          color: "#0f172a",
                          fontSize: "12px",
                          boxShadow: "0 2px 6px rgba(15, 23, 42, 0.08)"
                        }}
                      >
                        <div>{date.toLocaleDateString(undefined, { weekday: "short" })}</div>
                        <div>{date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</div>
                      </div>
                    ))}

                    {[
                      { key: "days-team", label: "Days Team", shiftType: "Days" as ShiftType, positionCode: null },
                      { key: "days-sup1", label: "Supervisor", shiftType: "Days" as ShiftType, positionCode: "SUP1" as PatrolPositionCode },
                      { key: "days-sup2", label: "Supervisor", shiftType: "Days" as ShiftType, positionCode: "SUP2" as PatrolPositionCode },
                      { key: "days-dep1", label: "Deputy", shiftType: "Days" as ShiftType, positionCode: "DEP1" as PatrolPositionCode },
                      { key: "days-dep2", label: "Deputy", shiftType: "Days" as ShiftType, positionCode: "DEP2" as PatrolPositionCode },
                      { key: "days-pol", label: "Poland", shiftType: "Days" as ShiftType, positionCode: "POL" as PatrolPositionCode },
                      { key: "nights-team", label: "Nights Team", shiftType: "Nights" as ShiftType, positionCode: null },
                      { key: "nights-sup1", label: "Supervisor", shiftType: "Nights" as ShiftType, positionCode: "SUP1" as PatrolPositionCode },
                      { key: "nights-sup2", label: "Supervisor", shiftType: "Nights" as ShiftType, positionCode: "SUP2" as PatrolPositionCode },
                      { key: "nights-dep1", label: "Deputy", shiftType: "Nights" as ShiftType, positionCode: "DEP1" as PatrolPositionCode },
                      { key: "nights-dep2", label: "Deputy", shiftType: "Nights" as ShiftType, positionCode: "DEP2" as PatrolPositionCode },
                      { key: "nights-pol", label: "Poland", shiftType: "Nights" as ShiftType, positionCode: "POL" as PatrolPositionCode }
                    ].map((rowDef) => (
                      <div key={`${rowDef.key}-week-${weekIndex}`} style={{ display: "contents" }}>
                        <div
                          style={{
                            border: "1px solid #dbe3ee",
                            borderRadius: "8px",
                            background: rowDef.positionCode ? "#ffffff" : "#eaf1fb",
                            padding: "6px",
                            fontWeight: 700,
                            fontSize: "12px",
                            color: rowDef.positionCode ? "#0f172a" : "#1e3a8a",
                            display: "flex",
                            alignItems: "center"
                          }}
                        >
                          {rowDef.label}
                        </div>
                        {weekDates.map((date) => {
                          const dateValue = toIsoDate(date)
                          const selected = selectedOffDates.includes(dateValue)
                          const activeTeam = getActiveTeam(date, rowDef.shiftType)

                          if (!rowDef.positionCode) {
                            return (
                              <div
                                key={`${rowDef.key}-${dateValue}`}
                                style={{
                                  border: "1px solid #dbe3ee",
                                  borderRadius: "8px",
                                  background: "#f8fafc",
                                  padding: "6px",
                                  textAlign: "center",
                                  fontWeight: 700,
                                  fontSize: "12px",
                                  color: "#475569"
                                }}
                              >
                                {activeTeam}
                              </div>
                            )
                          }

                          const row =
                            effectivePatrolRows.find(
                              (entry) =>
                                entry.assignment_date === dateValue &&
                                entry.shift_type === rowDef.shiftType &&
                                entry.position_code === rowDef.positionCode
                            ) || null

                          const replacementEmployee = row?.replacement_employee_id
                            ? employeeMap.get(row.replacement_employee_id)
                            : null
                          const assignedEmployee = row?.employee_id
                            ? employeeMap.get(row.employee_id)
                            : null
                          const fallbackEmployee =
                            !row?.employee_id && !row?.replacement_employee_id
                              ? getDefaultEmployeeForPosition(employees, date, rowDef.shiftType, rowDef.positionCode)
                              : null
                          const displayEmployee = replacementEmployee || assignedEmployee || fallbackEmployee || null
                          const isSelectedEmployee =
                            displayEmployee?.id === selectedEmployee.id ||
                            assignedEmployee?.id === selectedEmployee.id
                          const canToggle = (scheduleByDate.get(dateValue) || []).some(
                            (entry) =>
                              entry.shift_type === rowDef.shiftType &&
                              entry.position_code === rowDef.positionCode
                          )

                          return (
                            <button
                              key={`${rowDef.key}-${dateValue}`}
                              type="button"
                              onClick={() => toggleOffDate(dateValue)}
                              disabled={!canToggle}
                              style={{
                                border: selected && canToggle ? "2px solid #1d4ed8" : isSelectedEmployee ? "2px solid #f59e0b" : "1px solid #dbe3ee",
                                borderRadius: "8px",
                                background: selected && canToggle ? "#eff6ff" : isSelectedEmployee ? "#fffbeb" : "#ffffff",
                                padding: "4px",
                                minHeight: "44px",
                                display: "grid",
                                gap: "1px",
                                alignContent: "center",
                                textAlign: "center",
                                cursor: canToggle ? "pointer" : "default",
                                opacity: canToggle ? 1 : 0.72
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  gap: "5px",
                                  fontWeight: 700,
                                  fontSize: "11px",
                                  color: "#0f172a",
                                  lineHeight: 1.1
                                }}
                              >
                                {isSelectedEmployee ? (
                                  <span
                                    style={{
                                      width: "11px",
                                      height: "11px",
                                      borderRadius: "3px",
                                      border: selected ? "2px solid #1d4ed8" : "1px solid #94a3b8",
                                      background: selected ? "#1d4ed8" : "#ffffff",
                                      display: "inline-block",
                                      flex: "0 0 auto"
                                    }}
                                  />
                                ) : null}
                                <span>{displayEmployee ? displayEmployee.lastName : "OPEN"}</span>
                              </div>
                              <div style={{ fontSize: "9px", color: "#64748b", lineHeight: 1.1 }}>
                                {row?.status && row.status !== "Scheduled"
                                  ? row.status
                                  : replacementEmployee
                                    ? row?.replacement_hours || replacementEmployee.defaultShiftHours
                                    : row?.shift_hours || displayEmployee?.defaultShiftHours || ""}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                ))}
              </div>

            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  ) : null

  return (
    <div style={{ display: "grid", gap: "16px" }}>
        <Card>
          <CardHeader>
            <CardTitle>Employees Working</CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ display: "grid", gap: "12px" }}>
              {shiftRosterRows.map((row) => (
                <div key={row.key} style={{ display: "grid", gap: "8px" }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: `120px repeat(${Math.max(row.employees.length, 1)}, minmax(0, 1fr))`,
                      gap: "8px"
                    }}
                  >
                    <div
                      style={{
                        border: "1px solid #dbe3ee",
                        borderRadius: "10px",
                        background: "#f8fafc",
                        padding: "8px",
                        display: "flex",
                        alignItems: "center",
                        fontWeight: 700,
                        color: "#334155"
                      }}
                    >
                      {row.label}
                    </div>
                    {row.employees.map((employee) => (
                      <button
                        key={`${row.key}-${employee.id}`}
                        onClick={() => startEmployeeEditor(employee.id)}
                        style={{
                          border: "1px solid #dbe3ee",
                          borderRadius: "10px",
                          background: "#ffffff",
                          padding: "8px",
                          minHeight: "68px",
                          display: "grid",
                          gridTemplateRows: "18px 18px 16px",
                          gap: "2px",
                          alignItems: "start",
                          cursor: "pointer",
                          textAlign: "left"
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: "11px", color: "#475569", lineHeight: 1.1 }}>
                          {employee.team}
                        </div>
                        <div style={{ fontWeight: 800, color: "#0f172a", fontSize: "13px", lineHeight: 1.1 }}>
                          {employee.lastName}
                        </div>
                        <div style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.1 }}>
                          {employee.rank}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <div style={{ padding: "6px 10px", borderBottom: "1px solid #e2e8f0", fontWeight: 600 }}>
            <CardTitle>Assign Overtime Shift</CardTitle>
          </div>
          <div style={{ padding: "8px 10px" }}>
            <div style={{ color: "#64748b", fontSize: "13px", display: "grid", gap: "2px" }}>
              <div>1. Pick an employee from A Shift or B Shift and mark time off in Patrol view.</div>
              <div>2. The opening appears in Available Overtime Shifts.</div>
              <div>3. Record responses, then Fill and Save the replacement.</div>
            </div>
          </div>
        </Card>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "360px 320px 320px",
            gap: "16px",
            alignItems: "start"
          }}
        >
          <div
            style={{
              width: "360px",
              maxWidth: "100%"
            }}
          >
            {overtimeShiftsColumn}
          </div>
          <div
            style={{
              width: "320px",
              maxWidth: "100%"
            }}
          >
            {availableRespondersColumn}
          </div>
          <div
            style={{
              width: "320px",
              maxWidth: "100%"
            }}
          >
            {overtimeQueueColumn}
          </div>
        </div>

        {employeeEditorOverlay}
      </div>
  )
}

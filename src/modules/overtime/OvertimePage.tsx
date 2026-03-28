import { useEffect, useMemo, useRef, useState } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/simple-ui"
import { buildForceRotationOrder, getEmployeeForceSummary } from "../../lib/force-rotation"
import { invalidatePatrolScheduleCache } from "../../lib/patrol-schedule"
import { printElementById } from "../../lib/print"
import { supabase } from "../../lib/supabase"
import type {
  AppRole,
  DetailRecord,
  Employee,
  ForceHistoryRow,
  OvertimeShiftRequest,
  PatrolScheduleRow
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
  onQueueAssignmentNotice: (requestId: string, employeeId: string) => void
  onAuditEvent: (action: string, summary: string, details?: string) => void
}

const CARD_STYLE = {
  border: "1px solid #dbe3ee",
  borderRadius: "10px",
  background: "#ffffff"
} as const

function formatQueuePositionLabel(positionCode: OvertimeShiftRequest["positionCode"]) {
  if (positionCode === "SUP1" || positionCode === "SUP2") return "Supervisor"
  if (positionCode === "DEP1" || positionCode === "DEP2") return "Deputy"
  if (positionCode === "POL") return "Poland"
  return positionCode
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

  return (
    <div style={{ display: "grid", gap: "18px" }}>
      <Card>
        <CardHeader>
          <CardTitle>Overtime</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ fontSize: "13px", color: "#64748b" }}>
            Review Patrol time off, move qualified shifts into the queue, collect interest, and assign overtime coverage.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Overtime List</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            id="overtime-list-print-section"
            style={{
              display: "grid",
              gap: "12px"
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: "12px",
                alignItems: "center"
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "center"
                }}
              >
                <select
                  value={nextUpEmployee?.id || ""}
                  onChange={() => undefined}
                  style={{
                    width: "100%",
                    maxWidth: "320px",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                    fontSize: "13px"
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

              <div
                style={{
                  fontSize: "13px",
                  color: "#0f172a",
                  fontWeight: 700,
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  textAlign: "center"
                }}
              >
                <div style={{ width: "100%", maxWidth: "320px", textAlign: "center" }}>
                  Next Up For Overtime:{" "}
                  <span style={{ color: "#166534" }}>
                    {nextUpEmployee ? `${nextUpEmployee.firstName} ${nextUpEmployee.lastName}` : "No one in queue"}
                  </span>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "center"
                }}
              >
                <button
                  onClick={() => printElementById("overtime-list-print-section", "Overtime List")}
                  style={{
                    width: "100%",
                    maxWidth: "320px",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "none",
                    background: "#2563eb",
                    color: "#ffffff",
                    fontWeight: 700,
                    cursor: "pointer"
                  }}
                >
                  Print List
                </button>
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
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "8px",
                      padding: "6px 8px",
                      borderRadius: "8px",
                      background: interestedResponders.length > 0 ? "#eff6ff" : "#f8fafc",
                      border: `1px solid ${interestedResponders.length > 0 ? "#bfdbfe" : "#e2e8f0"}`
                    }}
                  >
                    <span style={{ fontSize: "11px", fontWeight: 800, color: "#334155" }}>
                      Interested Employees
                    </span>
                    <span
                      style={{
                        minWidth: "24px",
                        textAlign: "center",
                        padding: "2px 8px",
                        borderRadius: "999px",
                        background: interestedResponders.length > 0 ? "#2563eb" : "#cbd5e1",
                        color: "#ffffff",
                        fontSize: "11px",
                        fontWeight: 800
                      }}
                    >
                      {interestedResponders.length}
                    </span>
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
    </div>
  )
}

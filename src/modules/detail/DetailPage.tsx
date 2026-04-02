import { useMemo, useState } from "react"
import type { Dispatch, SetStateAction } from "react"
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input
} from "../../components/ui/simple-ui"
import { printElementById } from "../../lib/print"
import type {
  AppRole,
  DetailQueueEvent,
  DetailQueueEventType,
  DetailRecord,
  DetailRecordStatus,
  Employee
} from "../../types"

type DetailPageProps = {
  employees: Employee[]
  currentUserRole: AppRole
  detailRecords: DetailRecord[]
  setDetailRecords: Dispatch<SetStateAction<DetailRecord[]>>
  detailQueueEvents: DetailQueueEvent[]
  setDetailQueueEvents: Dispatch<SetStateAction<DetailQueueEvent[]>>
  detailQueueIds: string[]
  setDetailQueueIds: Dispatch<SetStateAction<string[]>>
  onAuditEvent?: (action: string, summary: string, details?: string) => void
}

type DetailDraft = {
  date: string
  description: string
  hours: string
}

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  })
}

function formatDateTime(date: string) {
  return new Date(date).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  })
}

function sortEmployeesByQueue(employees: Employee[], queueIds: string[]) {
  const employeeMap = new Map(employees.map((employee) => [employee.id, employee]))

  return queueIds
    .map((id) => employeeMap.get(id))
    .filter((employee): employee is Employee => Boolean(employee))
}

function getLastAcceptedDetail(employeeId: string, detailRecords: DetailRecord[]) {
  return detailRecords
    .filter((detail) => detail.employeeId === employeeId && detail.status === "Accepted")
    .sort((a, b) => b.date.localeCompare(a.date))[0] || null
}

function getTotalAcceptedHours(employeeId: string, detailRecords: DetailRecord[]) {
  return detailRecords
    .filter((detail) => detail.employeeId === employeeId && detail.status === "Accepted")
    .reduce((total, detail) => total + detail.hours, 0)
}

function hasOverlappingDetail(employeeId: string, date: string, detailRecords: DetailRecord[]) {
  return detailRecords.some(
    (detail) =>
      detail.employeeId === employeeId &&
      detail.date === date &&
      detail.status !== "Refused"
  )
}

function moveEmployeeToBottom(queueIds: string[], employeeId: string) {
  return [
    ...queueIds.filter((id) => id !== employeeId),
    employeeId
  ]
}

function buildEvent(
  type: DetailQueueEventType,
  employeeId: string,
  date: string,
  description: string,
  detailId?: string
): DetailQueueEvent {
  return {
    id: crypto.randomUUID(),
    type,
    employeeId,
    detailId,
    date,
    description,
    createdAt: new Date().toISOString()
  }
}

const eventColors: Record<DetailQueueEventType, string> = {
  Assigned: "#1d4ed8",
  Accepted: "#166534",
  Refused: "#991b1b",
  Skipped: "#92400e",
  Deleted: "#6b7280"
}

export function DetailPage({
  employees,
  currentUserRole,
  detailRecords,
  setDetailRecords,
  detailQueueEvents,
  setDetailQueueEvents,
  detailQueueIds,
  setDetailQueueIds,
  onAuditEvent
}: DetailPageProps) {
  const canEdit = currentUserRole === "admin" || currentUserRole === "sergeant"
  const [undoStack, setUndoStack] = useState<Array<{
    detailRecords: DetailRecord[]
    detailQueueEvents: DetailQueueEvent[]
    detailQueueIds: string[]
    message: string
  }>>([])
  const [draft, setDraft] = useState<DetailDraft>({
    date: "",
    description: "",
    hours: ""
  })
  const [message, setMessage] = useState("")

  const orderedEmployees = useMemo(
    () => sortEmployeesByQueue(employees, detailQueueIds),
    [employees, detailQueueIds]
  )

  const nextEligibleEmployee = useMemo(() => {
    if (!draft.date) return null

    return (
      orderedEmployees.find(
        (employee) => !hasOverlappingDetail(employee.id, draft.date, detailRecords)
      ) || null
    )
  }, [draft.date, orderedEmployees, detailRecords])

  const detailLog = useMemo(
    () =>
      [...detailRecords].sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date)
        return a.assignedAt.localeCompare(b.assignedAt)
      }),
    [detailRecords]
  )

  const queueHistory = useMemo(
    () => [...detailQueueEvents].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [detailQueueEvents]
  )
  const assignedCount = detailRecords.filter((detail) => detail.status === "Assigned").length
  const acceptedCount = detailRecords.filter((detail) => detail.status === "Accepted").length
  const refusedCount = detailRecords.filter((detail) => detail.status === "Refused").length
  const totalAcceptedHours = detailRecords
    .filter((detail) => detail.status === "Accepted")
    .reduce((total, detail) => total + detail.hours, 0)

  function updateDraft<K extends keyof DetailDraft>(key: K, value: DetailDraft[K]) {
    setDraft((current) => ({
      ...current,
      [key]: value
    }))
  }

  function pushQueueEvent(event: DetailQueueEvent) {
    setDetailQueueEvents((current) => [event, ...current])
  }

  function pushUndoSnapshot() {
    setUndoStack((current) => [
      {
        detailRecords: detailRecords.map((record) => ({ ...record })),
        detailQueueEvents: detailQueueEvents.map((event) => ({ ...event })),
        detailQueueIds: [...detailQueueIds],
        message
      },
      ...current
    ].slice(0, 20))
  }

  function assignNextDetail() {
    const hours = Number(draft.hours)

    if (!draft.date || !draft.description.trim() || !hours) {
      setMessage("Add a date, description, and hours before assigning.")
      return
    }

    if (!nextEligibleEmployee) {
      setMessage("No eligible employee is available for that detail date.")
      return
    }

    pushUndoSnapshot()

    const detail: DetailRecord = {
      id: crypto.randomUUID(),
      employeeId: nextEligibleEmployee.id,
      date: draft.date,
      description: draft.description.trim(),
      hours,
      status: "Assigned",
      assignedAt: new Date().toISOString()
    }

    setDetailRecords((current) => [...current, detail])
    pushQueueEvent(
      buildEvent(
        "Assigned",
        nextEligibleEmployee.id,
        detail.date,
        detail.description,
        detail.id
      )
    )
    setDraft({
      date: draft.date,
      description: "",
      hours: ""
    })
    onAuditEvent?.(
      "Detail Assigned",
      `Assigned detail to ${nextEligibleEmployee.firstName} ${nextEligibleEmployee.lastName}.`,
      `${detail.date} | ${detail.description} | ${detail.hours} hours`
    )
    setMessage(`${nextEligibleEmployee.firstName} ${nextEligibleEmployee.lastName} is now assigned.`)
  }

  function skipNextForDate() {
    if (!draft.date || !draft.description.trim()) {
      setMessage("Pick a date and description before logging a skip.")
      return
    }

    if (!nextEligibleEmployee) {
      setMessage("There is no eligible employee to skip right now.")
      return
    }

    pushUndoSnapshot()

    pushQueueEvent(
      buildEvent(
        "Skipped",
        nextEligibleEmployee.id,
        draft.date,
        draft.description.trim()
      )
    )
    onAuditEvent?.(
      "Detail Skipped",
      `Skipped ${nextEligibleEmployee.firstName} ${nextEligibleEmployee.lastName} and kept queue position.`,
      `${draft.date} | ${draft.description.trim()}`
    )
    setMessage(`${nextEligibleEmployee.firstName} ${nextEligibleEmployee.lastName} was skipped and remains next in line.`)
  }

  function updateDetailStatus(detailId: string, status: DetailRecordStatus) {
    const detail = detailRecords.find((record) => record.id === detailId)
    if (!detail) return

    pushUndoSnapshot()

    setDetailRecords((current) =>
      current.map((record) =>
        record.id === detailId
          ? { ...record, status }
          : record
      )
    )

    pushQueueEvent(
      buildEvent(status, detail.employeeId, detail.date, detail.description, detail.id)
    )

    if (status === "Accepted" || status === "Refused") {
      setDetailQueueIds((current) => moveEmployeeToBottom(current, detail.employeeId))
    }

    const employee = employees.find((record) => record.id === detail.employeeId)
    onAuditEvent?.(
      `Detail ${status}`,
      `${employee ? `${employee.firstName} ${employee.lastName}` : "Unknown employee"} marked detail as ${status}.`,
      `${detail.date} | ${detail.description}`
    )
  }

  function deleteDetail(detailId: string) {
    const detail = detailRecords.find((record) => record.id === detailId)
    if (!detail) return

    pushUndoSnapshot()

    setDetailRecords((current) => current.filter((record) => record.id !== detailId))
    pushQueueEvent(
      buildEvent("Deleted", detail.employeeId, detail.date, detail.description, detail.id)
    )
    const employee = employees.find((record) => record.id === detail.employeeId)
    onAuditEvent?.(
      "Detail Deleted",
      `Deleted detail for ${employee ? `${employee.firstName} ${employee.lastName}` : "Unknown employee"}.`,
      `${detail.date} | ${detail.description}`
    )
  }

  function undoLastDetailAction() {
    const previous = undoStack[0]
    if (!previous) return

    setUndoStack((current) => current.slice(1))
    setDetailRecords(previous.detailRecords)
    setDetailQueueEvents(previous.detailQueueEvents)
    setDetailQueueIds(previous.detailQueueIds)
    setMessage(previous.message)

    onAuditEvent?.(
      "Detail Undo",
      "Undid the previous detail action."
    )
  }

  return (
    <div id="detail-print-section" style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: "18px" }}>
      <div style={{ display: "grid", gap: "18px" }}>
        <Card>
          <CardContent>
            <div
              style={{
                display: "grid",
                gap: "14px",
                padding: "18px",
                background: "linear-gradient(180deg, #f8fbff 0%, #eef4ff 100%)",
                borderRadius: "16px",
                border: "1px solid #dbeafe"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ display: "grid", gap: "4px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#1d4ed8" }}>
                    Detail Operations
                  </div>
                  <div style={{ fontSize: "28px", lineHeight: 1.05, fontWeight: 800, color: "#0f172a" }}>
                    Detail Rotation Board
                  </div>
                  <div style={{ fontSize: "13px", color: "#475569" }}>
                    Assign fairly, keep the queue moving, and track detail outcomes in one board.
                  </div>
                </div>
                <Button
                  data-no-print="true"
                  onClick={() => printElementById("detail-print-section", "Detail Rotation Board")}
                >
                  Print Detail
                </Button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px" }}>
                {[
                  { label: "Next Up", value: nextEligibleEmployee ? `${nextEligibleEmployee.lastName}, ${nextEligibleEmployee.firstName}` : "Waiting", tone: "#1d4ed8", bg: "#eff6ff" },
                  { label: "Assigned", value: String(assignedCount), tone: "#7c3aed", bg: "#f5f3ff" },
                  { label: "Accepted", value: String(acceptedCount), tone: "#166534", bg: "#ecfdf5" },
                  { label: "Refused", value: String(refusedCount), tone: "#be123c", bg: "#fff1f2" },
                  { label: "Accepted Hours", value: totalAcceptedHours.toFixed(1), tone: "#92400e", bg: "#fffbeb" }
                ].map((card) => (
                  <div
                    key={card.label}
                    style={{
                      border: "1px solid rgba(148, 163, 184, 0.22)",
                      borderRadius: "12px",
                      padding: "12px 14px",
                      background: card.bg,
                      display: "grid",
                      gap: "4px"
                    }}
                  >
                    <div style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>
                      {card.label}
                    </div>
                    <div style={{ fontSize: card.label === "Next Up" ? "17px" : "26px", lineHeight: 1.05, fontWeight: 800, color: card.tone }}>
                      {card.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
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
              <CardTitle>Queue Order</CardTitle>
            </div>
          </CardHeader>

          <CardContent>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "90px 1.5fr 1fr 1.6fr 120px",
                gap: "8px",
                padding: "12px 14px",
                borderBottom: "1px solid #e2e8f0",
                fontSize: "12px",
                fontWeight: 700,
                color: "#7a6640",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                background: "linear-gradient(180deg, #fff9ec 0%, #fff4d8 100%)",
                borderRadius: "12px 12px 0 0"
              }}
            >
              <div>Queue</div>
              <div>Employee</div>
              <div>Hire Date</div>
              <div>Last Detail</div>
              <div>Total Hours</div>
            </div>

            {orderedEmployees.map((employee, index) => {
              const lastDetail = getLastAcceptedDetail(employee.id, detailRecords)
              const totalHours = getTotalAcceptedHours(employee.id, detailRecords)
              const isBlocked = draft.date
                ? hasOverlappingDetail(employee.id, draft.date, detailRecords)
                : false
              const isNextUp = nextEligibleEmployee?.id === employee.id

              return (
                <div
                  key={employee.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "90px 1.5fr 1fr 1.6fr 120px",
                    gap: "8px",
                    padding: "14px",
                    borderBottom: "1px solid #edf2f7",
                    background: isNextUp
                      ? "linear-gradient(90deg, #fff6db 0%, #fffdf7 100%)"
                      : index % 2 === 0
                        ? "#fffdf7"
                        : "#ffffff",
                    opacity: isBlocked ? 0.68 : 1
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 800, color: isNextUp ? "#92400e" : "#334155" }}>
                      #{index + 1}
                    </div>
                    {isNextUp && (
                      <div style={{ fontSize: "11px", color: "#92400e", fontWeight: 700 }}>
                        Next up
                      </div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontWeight: 700 }}>
                      {employee.lastName}, {employee.firstName}
                    </div>
                    <div style={{ fontSize: "12px", color: "#64748b" }}>
                      {isBlocked
                        ? "Unavailable on selected date"
                        : "Eligible"}
                    </div>
                  </div>

                  <div style={{ fontSize: "13px", color: "#334155" }}>
                    {employee.hireDate || "TBD"}
                  </div>

                  <div style={{ fontSize: "13px", color: "#334155" }}>
                    {lastDetail
                      ? `${formatDate(lastDetail.date)} - ${lastDetail.description}`
                      : "No accepted detail yet"}
                  </div>

                  <div style={{ fontWeight: 800, color: "#0f172a" }}>
                    {totalHours.toFixed(1)}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Queue History</CardTitle>
          </CardHeader>

          <CardContent>
            <div style={{ display: "grid", gap: "10px" }}>
              {queueHistory.length === 0 && (
                <div style={{ fontSize: "13px", color: "#64748b" }}>
                  No queue activity yet.
                </div>
              )}

              {queueHistory.map((event) => {
                const employee = employees.find((record) => record.id === event.employeeId)

                return (
                  <div
                    key={event.id}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: "12px",
                      padding: "12px",
                      background: "#ffffff"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                      <div style={{ fontWeight: 700 }}>
                        {employee ? `${employee.firstName} ${employee.lastName}` : "Unknown Employee"}
                      </div>
                      <div style={{ fontWeight: 700, color: eventColors[event.type] }}>
                        {event.type}
                      </div>
                    </div>

                    <div style={{ fontSize: "13px", color: "#475569", marginTop: "6px" }}>
                      {formatDate(event.date)} · {event.description}
                    </div>

                    <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "4px" }}>
                      {formatDateTime(event.createdAt)}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <div style={{ display: "grid", gap: "18px" }}>
        <Card>
          <CardHeader>
            <CardTitle>Assign Detail</CardTitle>
          </CardHeader>

          <CardContent>
            <div
              style={{
                border: "1px solid #d8c79d",
                borderRadius: "16px",
                padding: "14px",
                background: "linear-gradient(180deg, #fffdf7 0%, #fff7e7 100%)",
                marginBottom: "14px"
              }}
            >
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#7a6640", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Detail Assignment Rules
              </div>
              <div style={{ marginTop: "8px", fontSize: "13px", color: "#475569", display: "grid", gap: "4px" }}>
                <div>Queue starts by hire date and only moves after acceptance or refusal.</div>
                <div>Skipped employees stay in line until it is their turn again.</div>
                <div>Same-date detail overlaps are blocked.</div>
              </div>
            </div>

            <div style={{ display: "grid", gap: "12px" }}>
              <label>
                <div style={{ fontWeight: 700, marginBottom: "4px" }}>Date</div>
                <Input
                  type="date"
                  value={draft.date}
                  onChange={(event) => updateDraft("date", event.target.value)}
                />
              </label>

              <label>
                <div style={{ fontWeight: 700, marginBottom: "4px" }}>Description</div>
                <Input
                  value={draft.description}
                  onChange={(event) => updateDraft("description", event.target.value)}
                  placeholder="Road race, festival detail, overtime detail"
                />
              </label>

              <label>
                <div style={{ fontWeight: 700, marginBottom: "4px" }}>Hours</div>
                <Input
                  type="number"
                  min="1"
                  step="0.5"
                  value={draft.hours}
                  onChange={(event) => updateDraft("hours", event.target.value)}
                />
              </label>

              <div
                style={{
                  border: "1px solid #dbeafe",
                  borderRadius: "12px",
                  padding: "12px",
                  background: "#f8fbff"
                }}
              >
                <div style={{ fontSize: "12px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>
                  Next Eligible
                </div>
                <div style={{ marginTop: "6px", fontWeight: 800, fontSize: "18px" }}>
                  {nextEligibleEmployee
                    ? `${nextEligibleEmployee.firstName} ${nextEligibleEmployee.lastName}`
                    : "Pick a date to evaluate the queue"}
                </div>
              </div>

              {canEdit ? (
                <div style={{ display: "grid", gap: "8px" }}>
                  <Button onClick={assignNextDetail}>
                    Assign Next Detail
                  </Button>
                  <Button onClick={undoLastDetailAction} disabled={undoStack.length === 0}>
                    Undo
                  </Button>
                  <Button onClick={skipNextForDate}>
                    Log Skip And Keep Position
                  </Button>
                </div>
              ) : (
                <div style={{ fontSize: "13px", color: "#64748b" }}>
                  Read-only. Only admins and sergeants can assign details.
                </div>
              )}

              {message && (
                <div
                  style={{
                    fontSize: "13px",
                    color: "#475569",
                    border: "1px solid #dbeafe",
                    borderRadius: "10px",
                    padding: "10px",
                    background: "#f8fbff"
                  }}
                >
                  {message}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Detail Log</CardTitle>
          </CardHeader>

          <CardContent>
            <div style={{ display: "grid", gap: "10px" }}>
              {detailLog.length === 0 && (
                <div style={{ fontSize: "13px", color: "#64748b" }}>
                  No details assigned yet.
                </div>
              )}

              {detailLog.map((detail) => {
                const employee = employees.find((record) => record.id === detail.employeeId)
                const statusColor =
                  detail.status === "Accepted"
                    ? "#166534"
                    : detail.status === "Refused"
                      ? "#991b1b"
                      : "#1d4ed8"

                return (
                  <div
                    key={detail.id}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: "12px",
                      padding: "12px",
                      background: "#ffffff"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                      <div style={{ fontWeight: 700 }}>
                        {employee ? `${employee.firstName} ${employee.lastName}` : "Unknown Employee"}
                      </div>
                      <div style={{ color: statusColor, fontWeight: 700 }}>
                        {detail.status}
                      </div>
                    </div>

                    <div style={{ fontSize: "13px", color: "#475569", marginTop: "6px" }}>
                      {formatDate(detail.date)} · {detail.description} · {detail.hours} hrs
                    </div>

                    {canEdit && (
                      <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
                        {detail.status === "Assigned" && (
                          <>
                            <Button onClick={() => updateDetailStatus(detail.id, "Accepted")}>
                              Mark Accepted
                            </Button>
                            <Button onClick={() => updateDetailStatus(detail.id, "Refused")}>
                              Mark Refused
                            </Button>
                          </>
                        )}

                        <Button onClick={() => deleteDetail(detail.id)}>
                          Delete
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

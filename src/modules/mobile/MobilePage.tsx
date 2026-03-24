import { useMemo, useState } from "react"

import { Button, Card, CardContent, CardHeader, CardTitle, Select, SelectItem } from "../../components/ui/simple-ui"
import type { DetailRecord, Employee, ForceHistoryRow, NotificationDelivery, OvertimeAvailabilityStatus, OvertimeShiftRequest, PatrolScheduleRow } from "../../types"

type MobilePageProps = {
  employees: Employee[]
  patrolRows: PatrolScheduleRow[]
  detailRecords: DetailRecord[]
  forceHistory: ForceHistoryRow[]
  overtimeShiftRequests: OvertimeShiftRequest[]
  setOvertimeShiftRequests: React.Dispatch<React.SetStateAction<OvertimeShiftRequest[]>>
  notificationDeliveries: NotificationDelivery[]
  initialResponseToken?: string
  onClearResponseToken?: () => void
  onAuditEvent?: (action: string, summary: string, details?: string) => void
}

type MobileView = "patrol" | "force" | "detail" | "overtime"

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "2-digit"
  })
}

export function MobilePage({
  employees,
  patrolRows,
  detailRecords,
  forceHistory,
  overtimeShiftRequests,
  setOvertimeShiftRequests,
  notificationDeliveries,
  initialResponseToken = "",
  onClearResponseToken,
  onAuditEvent
}: MobilePageProps) {
  const previewEmployees = useMemo(
    () => employees.filter((employee) => employee.status === "Active").sort((a, b) => a.lastName.localeCompare(b.lastName)),
    [employees]
  )
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(previewEmployees[0]?.id || "")
  const [mobileView, setMobileView] = useState<MobileView>("patrol")
  const [responseToken, setResponseToken] = useState(initialResponseToken)

  const activeResponseDelivery = useMemo(
    () => notificationDeliveries.find((delivery) => delivery.responseToken === responseToken) || null,
    [notificationDeliveries, responseToken]
  )

  const responseEmployee = activeResponseDelivery
    ? previewEmployees.find((employee) => employee.id === activeResponseDelivery.employeeId) || null
    : null

  const selectedEmployee = previewEmployees.find((employee) => employee.id === selectedEmployeeId) || null
  const effectiveSelectedEmployee = responseEmployee || selectedEmployee

  const patrolPreview = useMemo(() => {
    if (!effectiveSelectedEmployee) return []

    return patrolRows
      .filter((row) => row.employee_id === effectiveSelectedEmployee.id || row.replacement_employee_id === effectiveSelectedEmployee.id)
      .sort((a, b) => a.assignment_date.localeCompare(b.assignment_date) || a.shift_type.localeCompare(b.shift_type))
      .slice(0, 12)
      .map((row) => ({
        id: `${row.assignment_date}-${row.shift_type}-${row.position_code}`,
        date: row.assignment_date,
        label: `${row.shift_type} | ${row.position_code.replace("SUP", "Supervisor ").replace("DEP", "Deputy ").replace("POL", "Poland")}`,
        status:
          row.replacement_employee_id === effectiveSelectedEmployee.id
            ? `Replacement | ${row.replacement_hours || row.shift_hours || ""}`
            : `${row.status || "Scheduled"} | ${row.shift_hours || ""}`
      }))
  }, [effectiveSelectedEmployee, patrolRows])

  const forcePreview = useMemo(() => {
    if (!effectiveSelectedEmployee) return []

    return forceHistory
      .filter((row) => row.employee_id === effectiveSelectedEmployee.id)
      .sort((a, b) => b.forced_date.localeCompare(a.forced_date))
      .slice(0, 8)
  }, [effectiveSelectedEmployee, forceHistory])

  const detailPreview = useMemo(() => {
    if (!effectiveSelectedEmployee) return []

    return detailRecords
      .filter((detail) => detail.employeeId === effectiveSelectedEmployee.id)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 8)
  }, [detailRecords, effectiveSelectedEmployee])

  const overtimePreview = useMemo(() => {
    if (!effectiveSelectedEmployee) return []

    return overtimeShiftRequests
      .filter((request) => request.status === "Open")
      .sort((a, b) => a.assignmentDate.localeCompare(b.assignmentDate) || a.shiftType.localeCompare(b.shiftType))
      .slice(0, 10)
      .map((request) => {
        const response = request.responses.find((entry) => entry.employeeId === effectiveSelectedEmployee.id)
        return {
          ...request,
          responseStatus: response?.status || "Pending"
        }
      })
  }, [effectiveSelectedEmployee, overtimeShiftRequests])

  const responseShifts = useMemo(() => {
    if (!activeResponseDelivery) return []
    return activeResponseDelivery.shiftRequestIds
      .map((shiftId) => overtimeShiftRequests.find((request) => request.id === shiftId) || null)
      .filter((request): request is OvertimeShiftRequest => !!request)
  }, [activeResponseDelivery, overtimeShiftRequests])

  function setResponse(requestId: string, employeeId: string, status: OvertimeAvailabilityStatus) {
    setOvertimeShiftRequests((current) =>
      current.map((request) => {
        if (request.id !== requestId) return request
        const nextResponses = [...request.responses]
        const existingIndex = nextResponses.findIndex((entry) => entry.employeeId === employeeId)

        if (existingIndex >= 0) {
          nextResponses[existingIndex] = { employeeId, status, updatedAt: new Date().toISOString() }
        } else {
          nextResponses.push({ employeeId, status, updatedAt: new Date().toISOString() })
        }

        return { ...request, responses: nextResponses }
      })
    )

    const employee = previewEmployees.find((entry) => entry.id === employeeId)
    onAuditEvent?.(
      "Mobile Response Submitted",
      `${employee ? `${employee.firstName} ${employee.lastName}` : "Employee"} marked ${status}.`,
      requestId
    )
  }

  return (
    <div style={{ display: "grid", gap: "18px" }}>
      <Card>
        <CardHeader>
          <CardTitle>Mobile Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ display: "grid", gridTemplateColumns: "260px minmax(0, 1fr)", gap: "18px", alignItems: "start" }}>
            <div style={{ display: "grid", gap: "12px" }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: "4px" }}>Preview Employee</div>
                <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                  {previewEmployees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.firstName} {employee.lastName}
                    </SelectItem>
                  ))}
                </Select>
              </div>

              <div style={{ fontSize: "13px", color: "#475569", lineHeight: 1.35 }}>
                This is the employee-facing mobile view for Patrol, Force, Detail, and Overtime. It gives you a phone-style preview before we connect it to a true mobile login flow.
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: "4px" }}>Response Link Token</div>
                <input
                  value={responseToken}
                  onChange={(event) => setResponseToken(event.target.value)}
                  placeholder="Paste response token or open response link"
                  style={{ width: "100%", padding: 6, border: "1px solid #cbd5e1", borderRadius: 6 }}
                />
              </div>

              {activeResponseDelivery && responseEmployee && (
                <div style={{ border: "1px solid #bfdbfe", borderRadius: "12px", padding: "10px", background: "#eff6ff", display: "grid", gap: "8px" }}>
                  <div style={{ fontWeight: 800, color: "#1d4ed8" }}>Overtime Response View</div>
                  <div style={{ fontSize: "12px", color: "#334155" }}>
                    {responseEmployee.firstName} {responseEmployee.lastName} can respond to {responseShifts.length} overtime shift(s) from this phone view.
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <Button
                      onClick={() => {
                        setResponseToken("")
                        onClearResponseToken?.()
                      }}
                    >
                      Exit Response View
                    </Button>
                    <Button onClick={() => setMobileView("overtime")}>Open OT</Button>
                  </div>
                </div>
              )}
            </div>

            <div
              style={{
                width: "360px",
                maxWidth: "100%",
                margin: "0 auto",
                border: "10px solid #0f172a",
                borderRadius: "28px",
                background: "#f8fafc",
                overflow: "hidden",
                boxShadow: "0 20px 36px rgba(15, 23, 42, 0.18)"
              }}
            >
              <div style={{ padding: "10px 14px", background: "#0f172a", color: "#f8fafc", fontWeight: 700 }}>
                {effectiveSelectedEmployee ? `${effectiveSelectedEmployee.firstName} ${effectiveSelectedEmployee.lastName}` : "Mobile Preview"}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", borderBottom: "1px solid #dbe3ee" }}>
                {([
                  ["patrol", "Patrol"],
                  ["force", "Force"],
                  ["detail", "Detail"],
                  ["overtime", "OT"]
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setMobileView(value)}
                    style={{
                      border: "none",
                      borderRight: "1px solid #dbe3ee",
                      background: mobileView === value ? "#e0ecff" : "#ffffff",
                      color: "#0f172a",
                      padding: "10px 6px",
                      fontWeight: 700,
                      cursor: "pointer"
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div style={{ padding: "12px", display: "grid", gap: "10px", maxHeight: "620px", overflowY: "auto" }}>
                {mobileView === "patrol" && (
                  <>
                    {patrolPreview.length === 0 && <div style={{ color: "#64748b", fontSize: "13px" }}>No Patrol rows found for this employee.</div>}
                    {patrolPreview.map((entry) => (
                      <div key={entry.id} style={{ border: "1px solid #dbe3ee", borderRadius: "12px", padding: "10px", background: "#ffffff" }}>
                        <div style={{ fontWeight: 800 }}>{formatDate(entry.date)}</div>
                        <div style={{ marginTop: "4px", fontSize: "13px", color: "#334155" }}>{entry.label}</div>
                        <div style={{ marginTop: "4px", fontSize: "12px", color: "#64748b" }}>{entry.status}</div>
                      </div>
                    ))}
                  </>
                )}

                {mobileView === "force" && (
                  <>
                    <div style={{ border: "1px solid #dbe3ee", borderRadius: "12px", padding: "10px", background: "#ffffff" }}>
                      <div style={{ fontSize: "12px", color: "#64748b" }}>Total Force Entries</div>
                      <div style={{ fontSize: "22px", fontWeight: 800 }}>{forcePreview.length}</div>
                    </div>
                    {forcePreview.map((row) => (
                      <div key={`${row.employee_id}-${row.forced_date}`} style={{ border: "1px solid #dbe3ee", borderRadius: "12px", padding: "10px", background: "#ffffff" }}>
                        <div style={{ fontWeight: 700 }}>Forced Assignment</div>
                        <div style={{ marginTop: "4px", color: "#475569", fontSize: "13px" }}>{formatDate(row.forced_date)}</div>
                      </div>
                    ))}
                  </>
                )}

                {mobileView === "detail" && (
                  <>
                    {detailPreview.length === 0 && <div style={{ color: "#64748b", fontSize: "13px" }}>No detail records yet.</div>}
                    {detailPreview.map((detail) => (
                      <div key={detail.id} style={{ border: "1px solid #dbe3ee", borderRadius: "12px", padding: "10px", background: "#ffffff" }}>
                        <div style={{ fontWeight: 800 }}>{detail.description}</div>
                        <div style={{ marginTop: "4px", color: "#475569", fontSize: "13px" }}>{formatDate(detail.date)} | {detail.hours} hrs</div>
                        <div style={{ marginTop: "4px", color: "#64748b", fontSize: "12px" }}>{detail.status}</div>
                      </div>
                    ))}
                  </>
                )}

                {mobileView === "overtime" && (
                  <>
                    {activeResponseDelivery && responseEmployee && (
                      <>
                        <div style={{ border: "1px solid #bfdbfe", borderRadius: "12px", padding: "10px", background: "#eff6ff", display: "grid", gap: "8px" }}>
                          <div style={{ fontWeight: 800, color: "#1d4ed8" }}>Respond To Overtime Availability</div>
                          <div style={{ fontSize: "12px", color: "#334155" }}>
                            Choose your status for each available shift below.
                          </div>
                        </div>

                        {responseShifts.map((request) => {
                          const response = request.responses.find((entry) => entry.employeeId === responseEmployee.id)
                          return (
                            <div key={`response-${request.id}`} style={{ border: "1px solid #dbe3ee", borderRadius: "12px", padding: "10px", background: "#ffffff", display: "grid", gap: "8px" }}>
                              <div style={{ fontWeight: 800 }}>{formatDate(request.assignmentDate)}</div>
                              <div style={{ color: "#334155", fontSize: "13px" }}>
                                {request.shiftType} | {request.description}
                              </div>
                              <div style={{ fontSize: "12px", color: "#64748b" }}>
                                Current Response: {response?.status || "Pending"}
                              </div>
                              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                {(["Interested", "Accepted", "Declined"] as OvertimeAvailabilityStatus[]).map((status) => (
                                  <button
                                    key={`${request.id}-${status}`}
                                    onClick={() => setResponse(request.id, responseEmployee.id, status)}
                                    style={{
                                      border: response?.status === status ? "1px solid #1d4ed8" : "1px solid #cbd5e1",
                                      background: response?.status === status ? "#eff6ff" : "#ffffff",
                                      color: response?.status === status ? "#1d4ed8" : "#334155",
                                      borderRadius: "8px",
                                      padding: "6px 8px",
                                      fontSize: "11px",
                                      fontWeight: 700,
                                      cursor: "pointer"
                                    }}
                                  >
                                    {status}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )
                        })}
                      </>
                    )}

                    {overtimePreview.length === 0 && <div style={{ color: "#64748b", fontSize: "13px" }}>No open overtime shifts are visible right now.</div>}
                    {overtimePreview.map((request) => (
                      <div key={request.id} style={{ border: "1px solid #dbe3ee", borderRadius: "12px", padding: "10px", background: "#ffffff" }}>
                        <div style={{ fontWeight: 800 }}>{formatDate(request.assignmentDate)}</div>
                        <div style={{ marginTop: "4px", color: "#334155", fontSize: "13px" }}>
                          {request.shiftType} | {request.description}
                        </div>
                        <div style={{ marginTop: "6px", fontSize: "12px", color: "#64748b" }}>
                          Response: {request.responseStatus}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

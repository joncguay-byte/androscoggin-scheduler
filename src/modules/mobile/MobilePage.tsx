import { useEffect, useMemo, useState } from "react"

import { Button, Card, CardContent, CardHeader, CardTitle, Select, SelectItem } from "../../components/ui/simple-ui"
import { supabase } from "../../lib/supabase"
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
  currentUserDisplayName?: string
  currentUserEmail?: string
  onClearResponseToken?: () => void
  onOpenFullApp?: () => void
  onAuditEvent?: (action: string, summary: string, details?: string) => void
}

type MobileView = "home" | "patrol" | "force" | "detail" | "overtime"

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "2-digit"
  })
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit"
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
  currentUserDisplayName = "",
  currentUserEmail = "",
  onClearResponseToken,
  onOpenFullApp,
  onAuditEvent
}: MobilePageProps) {
  const previewEmployees = useMemo(
    () => employees.filter((employee) => employee.status === "Active").sort((a, b) => a.lastName.localeCompare(b.lastName)),
    [employees]
  )
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(previewEmployees[0]?.id || "")
  const [mobileView, setMobileView] = useState<MobileView>("home")
  const [responseToken, setResponseToken] = useState(initialResponseToken)
  const [isCompactPhoneLayout, setIsCompactPhoneLayout] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 900 : true
  )
  const [fetchedResponseDelivery, setFetchedResponseDelivery] = useState<NotificationDelivery | null>(null)
  const [fetchedResponseShifts, setFetchedResponseShifts] = useState<OvertimeShiftRequest[]>([])
  const [responseLookupState, setResponseLookupState] = useState<"idle" | "loading" | "loaded" | "missing">("idle")

  useEffect(() => {
    if (initialResponseToken) {
      setResponseToken(initialResponseToken)
      setMobileView("overtime")
    }
  }, [initialResponseToken])

  useEffect(() => {
    if (typeof window === "undefined") return

    const updateLayoutMode = () => setIsCompactPhoneLayout(window.innerWidth < 900)
    updateLayoutMode()
    window.addEventListener("resize", updateLayoutMode)
    return () => window.removeEventListener("resize", updateLayoutMode)
  }, [])

  const activeResponseDelivery = useMemo(
    () => notificationDeliveries.find((delivery) => delivery.responseToken === responseToken) || fetchedResponseDelivery || null,
    [fetchedResponseDelivery, notificationDeliveries, responseToken]
  )

  const responseEmployee = activeResponseDelivery
    ? previewEmployees.find((employee) => employee.id === activeResponseDelivery.employeeId) || null
    : null
  const hasResponseToken = responseToken.trim().length > 0
  const inResponsePortal = !!activeResponseDelivery && !!responseEmployee

  useEffect(() => {
    if (responseEmployee) {
      setSelectedEmployeeId(responseEmployee.id)
    }
  }, [responseEmployee])

  useEffect(() => {
    if (previewEmployees.length === 0 || responseEmployee) return

    const normalizedDisplayName = currentUserDisplayName.trim().toLowerCase()
    const normalizedEmail = currentUserEmail.trim().toLowerCase()
    const emailLocalPart = normalizedEmail.includes("@") ? normalizedEmail.split("@")[0] : normalizedEmail

    const matchedEmployee = previewEmployees.find((employee) => {
      const fullName = `${employee.firstName} ${employee.lastName}`.trim().toLowerCase()
      const reverseName = `${employee.lastName} ${employee.firstName}`.trim().toLowerCase()
      const lastNameOnly = employee.lastName.trim().toLowerCase()
      return (
        (normalizedDisplayName && (fullName === normalizedDisplayName || reverseName === normalizedDisplayName || lastNameOnly === normalizedDisplayName)) ||
        (emailLocalPart && (fullName.replace(/\s+/g, ".") === emailLocalPart || fullName.replace(/\s+/g, "") === emailLocalPart))
      )
    })

    if (matchedEmployee) {
      setSelectedEmployeeId(matchedEmployee.id)
    }
  }, [currentUserDisplayName, currentUserEmail, previewEmployees, responseEmployee])

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

  const upcomingPatrolPreview = patrolPreview.slice(0, 3)

  const forcePreview = useMemo(() => {
    if (!effectiveSelectedEmployee) return []

    return forceHistory
      .filter((row) => row.employee_id === effectiveSelectedEmployee.id)
      .sort((a, b) => b.forced_date.localeCompare(a.forced_date))
      .slice(0, 8)
  }, [effectiveSelectedEmployee, forceHistory])

  const latestForceEntry = forcePreview[0] || null

  const detailPreview = useMemo(() => {
    if (!effectiveSelectedEmployee) return []

    return detailRecords
      .filter((detail) => detail.employeeId === effectiveSelectedEmployee.id)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 8)
  }, [detailRecords, effectiveSelectedEmployee])

  const latestDetailPreview = detailPreview[0] || null

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

  const pendingOvertimePreview = overtimePreview.filter((request) => request.responseStatus === "Pending")
  const interestedOvertimePreview = overtimePreview.filter((request) => request.responseStatus === "Interested")

  const responseShifts = useMemo(() => {
    if (!activeResponseDelivery) return []
    const shiftsFromState = activeResponseDelivery.shiftRequestIds
      .map((shiftId) => overtimeShiftRequests.find((request) => request.id === shiftId) || null)
      .filter((request): request is OvertimeShiftRequest => !!request)

    return shiftsFromState.length > 0 ? shiftsFromState : fetchedResponseShifts
  }, [activeResponseDelivery, fetchedResponseShifts, overtimeShiftRequests])

  useEffect(() => {
    if (!responseToken.trim()) {
      setFetchedResponseDelivery(null)
      setFetchedResponseShifts([])
      setResponseLookupState("idle")
      return
    }

    if (notificationDeliveries.some((delivery) => delivery.responseToken === responseToken)) {
      setFetchedResponseDelivery(null)
      setFetchedResponseShifts([])
      setResponseLookupState("loaded")
      return
    }

    let active = true

    async function loadResponseDelivery() {
      setResponseLookupState("loading")

      const deliveryResult = await supabase
        .from("notification_deliveries")
        .select("*")
        .eq("response_token", responseToken)
        .maybeSingle()

      if (!active) return

      const row = deliveryResult.data
      if (!row) {
        setFetchedResponseDelivery(null)
        setFetchedResponseShifts([])
        setResponseLookupState("missing")
        return
      }

      const delivery: NotificationDelivery = {
        id: String(row.id),
        campaignId: String(row.campaign_id),
        employeeId: String(row.employee_id),
        channel: row.channel as NotificationDelivery["channel"],
        destination: String(row.destination || ""),
        shiftRequestIds: Array.isArray(row.shift_request_ids) ? row.shift_request_ids.map((value: unknown) => String(value)) : [],
        responseToken: (row.response_token as string | null) || null,
        subject: String(row.subject || ""),
        body: String(row.body || ""),
        status: row.status as NotificationDelivery["status"],
        providerMode: row.provider_mode as NotificationDelivery["providerMode"],
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        sentAt: (row.sent_at as string | null) || null,
        errorMessage: (row.error_message as string | null) || null
      }

      setFetchedResponseDelivery(delivery)

      if (delivery.shiftRequestIds.length === 0) {
        setFetchedResponseShifts([])
        setResponseLookupState("loaded")
        return
      }

      const shiftsResult = await supabase
        .from("overtime_shift_requests")
        .select("*")
        .in("id", delivery.shiftRequestIds)

      if (!active) return

      const shifts = ((shiftsResult.data || []) as Array<Record<string, unknown>>).map((requestRow) => ({
        id: String(requestRow.id),
        source: (requestRow.source as OvertimeShiftRequest["source"]) || "Manual",
        batchId: (requestRow.batch_id as string | null) || null,
        batchName: (requestRow.batch_name as string | null) || null,
        assignmentDate: String(requestRow.assignment_date),
        shiftType: requestRow.shift_type as OvertimeShiftRequest["shiftType"],
        positionCode: requestRow.position_code as OvertimeShiftRequest["positionCode"],
        description: String(requestRow.description || ""),
        offEmployeeId: (requestRow.off_employee_id as string | null) || null,
        offEmployeeLastName: (requestRow.off_employee_last_name as string | null) || null,
        offHours: (requestRow.off_hours as string | null) || null,
        selectionActive: Boolean(requestRow.selection_active),
        workflowStatus: (requestRow.workflow_status as OvertimeShiftRequest["workflowStatus"]) || undefined,
        status: requestRow.status as OvertimeShiftRequest["status"],
        assignedEmployeeId: (requestRow.assigned_employee_id as string | null) || null,
        manuallyQueued: false,
        assignedHours: (requestRow.assigned_hours as string | null) || null,
        autoAssignReason: null,
        createdAt: String(requestRow.created_at),
        responses: Array.isArray(requestRow.responses)
          ? requestRow.responses.map((entry) => {
              const record = entry as Record<string, unknown>
              return {
                employeeId: String(record.employeeId || record.employee_id || ""),
                status: String(record.status || "Pending") as OvertimeAvailabilityStatus,
                updatedAt: String(record.updatedAt || record.updated_at || new Date().toISOString())
              }
            }).filter((entry) => entry.employeeId)
          : []
      }))

      setFetchedResponseShifts(shifts)
      setResponseLookupState("loaded")
    }

    void loadResponseDelivery()

    return () => {
      active = false
    }
  }, [notificationDeliveries, responseToken])

  const responseSummary = useMemo(() => {
    if (!responseEmployee) return null

    const summary = {
      pending: 0,
      interested: 0,
      accepted: 0,
      declined: 0
    }

    for (const request of responseShifts) {
      const response = request.responses.find((entry) => entry.employeeId === responseEmployee.id)
      switch (response?.status) {
        case "Interested":
          summary.interested += 1
          break
        case "Accepted":
          summary.accepted += 1
          break
        case "Declined":
          summary.declined += 1
          break
        default:
          summary.pending += 1
      }
    }

    return summary
  }, [responseEmployee, responseShifts])

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

  const mobileTabButtons: Array<{ value: MobileView; label: string }> = [
    { value: "home", label: "Home" },
    { value: "patrol", label: "Patrol" },
    { value: "overtime", label: "OT" },
    { value: "detail", label: "Detail" },
    { value: "force", label: "Force" }
  ]

  return (
    <div style={{ display: "grid", gap: "18px" }}>
      <Card>
        <CardHeader>
          <CardTitle>{hasResponseToken ? "Overtime Response" : "Mobile Preview"}</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ display: "grid", gridTemplateColumns: hasResponseToken || isCompactPhoneLayout ? "minmax(0, 1fr)" : "260px minmax(0, 1fr)", gap: "18px", alignItems: "start" }}>
            {!hasResponseToken && (
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
            )}

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
                <div style={{ padding: "12px 14px", background: "#0f172a", color: "#f8fafc", fontWeight: 700, display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center" }}>
                  <span>
                    {hasResponseToken
                      ? "Overtime Response"
                      : (effectiveSelectedEmployee ? `${effectiveSelectedEmployee.firstName} ${effectiveSelectedEmployee.lastName}` : "Mobile Preview")}
                  </span>
                  {hasResponseToken && (
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <button
                        onClick={() => onOpenFullApp?.()}
                        style={{
                          border: "1px solid rgba(255,255,255,0.35)",
                          background: "rgba(255,255,255,0.08)",
                          color: "#f8fafc",
                          borderRadius: "999px",
                          padding: "4px 10px",
                          fontSize: "11px",
                          fontWeight: 700,
                          cursor: "pointer"
                        }}
                      >
                        Open Full App
                      </button>
                      <button
                        onClick={() => {
                          setResponseToken("")
                          onClearResponseToken?.()
                        }}
                        style={{
                          border: "1px solid rgba(255,255,255,0.35)",
                          background: "transparent",
                          color: "#f8fafc",
                          borderRadius: "999px",
                          padding: "4px 10px",
                          fontSize: "11px",
                          fontWeight: 700,
                          cursor: "pointer"
                        }}
                      >
                        Exit
                      </button>
                    </div>
                )}
              </div>

                {!hasResponseToken && effectiveSelectedEmployee && (
                  <div
                    style={{
                      padding: "14px 14px 12px 14px",
                      borderBottom: "1px solid #dbe3ee",
                      background: "linear-gradient(180deg, #f8fbff 0%, #eef4ff 100%)",
                      display: "grid",
                      gap: "10px"
                    }}
                  >
                    <div style={{ display: "grid", gap: "2px" }}>
                      <div style={{ fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#64748b" }}>
                        Dashboard
                      </div>
                      <div style={{ fontSize: "18px", fontWeight: 900, color: "#0f172a" }}>
                        {effectiveSelectedEmployee.firstName} {effectiveSelectedEmployee.lastName}
                      </div>
                      <div style={{ fontSize: "12px", color: "#475569" }}>
                        {effectiveSelectedEmployee.rank} | {effectiveSelectedEmployee.team}
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px" }}>
                      <div style={{ borderRadius: "12px", background: "#ffffff", padding: "10px", border: "1px solid #dbe3ee" }}>
                        <div style={{ fontSize: "10px", fontWeight: 800, textTransform: "uppercase", color: "#64748b" }}>Pending OT</div>
                        <div style={{ fontSize: "20px", fontWeight: 900, color: "#1d4ed8", lineHeight: 1.1 }}>{pendingOvertimePreview.length}</div>
                      </div>
                      <div style={{ borderRadius: "12px", background: "#ffffff", padding: "10px", border: "1px solid #dbe3ee" }}>
                        <div style={{ fontSize: "10px", fontWeight: 800, textTransform: "uppercase", color: "#64748b" }}>Interested</div>
                        <div style={{ fontSize: "20px", fontWeight: 900, color: "#0f766e", lineHeight: 1.1 }}>{interestedOvertimePreview.length}</div>
                      </div>
                      <div style={{ borderRadius: "12px", background: "#ffffff", padding: "10px", border: "1px solid #dbe3ee" }}>
                        <div style={{ fontSize: "10px", fontWeight: 800, textTransform: "uppercase", color: "#64748b" }}>Detail</div>
                        <div style={{ fontSize: "20px", fontWeight: 900, color: "#7c3aed", lineHeight: 1.1 }}>{detailPreview.length}</div>
                      </div>
                    </div>
                  </div>
                )}

                {!hasResponseToken && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", borderBottom: "1px solid #dbe3ee", background: "#ffffff" }}>
                    {mobileTabButtons.map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => setMobileView(value)}
                      style={{
                        border: "none",
                        borderRight: "1px solid #dbe3ee",
                        background: mobileView === value ? "#e0ecff" : "#ffffff",
                        color: "#0f172a",
                        padding: "12px 4px",
                        fontWeight: 700,
                        fontSize: "11px",
                        cursor: "pointer"
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              <div style={{ padding: "12px", display: "grid", gap: "10px", maxHeight: "620px", overflowY: "auto", background: "#f4f7fb" }}>
                {hasResponseToken && !inResponsePortal && (
                  <div style={{ border: "1px solid #dbe3ee", borderRadius: "14px", padding: "12px", background: "#ffffff", display: "grid", gap: "8px" }}>
                    <div style={{ fontWeight: 800, color: "#1d4ed8" }}>
                      {responseLookupState === "missing" ? "Response Link Not Found" : "Loading Overtime Response"}
                    </div>
                    <div style={{ fontSize: "13px", color: "#475569", lineHeight: 1.5 }}>
                      {responseLookupState === "missing"
                        ? "This response link could not be matched to a live overtime delivery."
                        : "We found a response link and are loading the matching overtime delivery for this employee."}
                    </div>
                    <div style={{ fontSize: "12px", color: "#64748b", wordBreak: "break-all" }}>
                      Token: {responseToken}
                    </div>
                  </div>
                )}

                {activeResponseDelivery && responseEmployee && responseSummary && (
                  <div style={{ border: "1px solid #bfdbfe", borderRadius: "14px", padding: "12px", background: "#eff6ff", display: "grid", gap: "8px" }}>
                    <div style={{ fontWeight: 800, color: "#1d4ed8" }}>Overtime Response Portal</div>
                    <div style={{ fontSize: "12px", color: "#334155" }}>
                      {responseEmployee.firstName} {responseEmployee.lastName} is responding to {responseShifts.length} shift(s).
                    </div>
                    <div style={{ fontSize: "12px", color: "#475569", lineHeight: 1.5 }}>
                      Shifts in this notification: sent {formatDateTime(activeResponseDelivery.createdAt)}.
                      Desktop overtime may have changed since this message was sent.
                    </div>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {[
                        ["Pending", responseSummary.pending, "#f8fafc", "#475569"],
                        ["Interested", responseSummary.interested, "#eff6ff", "#1d4ed8"],
                        ["Declined", responseSummary.declined, "#fff1f2", "#be123c"]
                      ].map(([label, count, background, color]) => (
                        <div
                          key={label as string}
                          style={{
                            padding: "4px 8px",
                            borderRadius: "999px",
                            background: background as string,
                            color: color as string,
                            fontSize: "11px",
                            fontWeight: 800
                          }}
                        >
                          {label}: {count as number}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {hasResponseToken && inResponsePortal && (
                  <div style={{ fontSize: "12px", color: "#475569", lineHeight: 1.5 }}>
                    Choose your interest below. This view is only for the shifts in this notification.
                  </div>
                )}

                {mobileView === "home" && !hasResponseToken && effectiveSelectedEmployee && (
                  <>
                    <div style={{ display: "grid", gap: "10px" }}>
                      <div style={{ border: "1px solid #dbe3ee", borderRadius: "16px", padding: "14px", background: "#ffffff", display: "grid", gap: "10px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                          <div>
                            <div style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>Next Patrol</div>
                            <div style={{ fontSize: "16px", fontWeight: 900, color: "#0f172a" }}>
                              {upcomingPatrolPreview[0] ? formatDate(upcomingPatrolPreview[0].date) : "No upcoming row"}
                            </div>
                          </div>
                          <button
                            onClick={() => setMobileView("patrol")}
                            style={{ border: "none", background: "#eff6ff", color: "#1d4ed8", borderRadius: "999px", padding: "6px 10px", fontSize: "11px", fontWeight: 800, cursor: "pointer" }}
                          >
                            Open Patrol
                          </button>
                        </div>
                        {upcomingPatrolPreview[0] ? (
                          <div style={{ fontSize: "13px", color: "#334155", lineHeight: 1.5 }}>
                            {upcomingPatrolPreview[0].label}
                            <div style={{ marginTop: "4px", color: "#64748b", fontSize: "12px" }}>{upcomingPatrolPreview[0].status}</div>
                          </div>
                        ) : (
                          <div style={{ fontSize: "13px", color: "#64748b" }}>No Patrol rows found for this employee.</div>
                        )}
                      </div>

                      <div style={{ border: "1px solid #dbe3ee", borderRadius: "16px", padding: "14px", background: "#ffffff", display: "grid", gap: "10px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                          <div>
                            <div style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>Open Overtime</div>
                            <div style={{ fontSize: "16px", fontWeight: 900, color: "#0f172a" }}>
                              {pendingOvertimePreview.length} pending shift{pendingOvertimePreview.length === 1 ? "" : "s"}
                            </div>
                          </div>
                          <button
                            onClick={() => setMobileView("overtime")}
                            style={{ border: "none", background: "#eff6ff", color: "#1d4ed8", borderRadius: "999px", padding: "6px 10px", fontSize: "11px", fontWeight: 800, cursor: "pointer" }}
                          >
                            Open OT
                          </button>
                        </div>
                        <div style={{ fontSize: "13px", color: "#475569", lineHeight: 1.5 }}>
                          {pendingOvertimePreview[0]
                            ? `${formatDate(pendingOvertimePreview[0].assignmentDate)} | ${pendingOvertimePreview[0].shiftType} | ${pendingOvertimePreview[0].description}`
                            : "No pending overtime responses right now."}
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px" }}>
                        <div style={{ border: "1px solid #dbe3ee", borderRadius: "16px", padding: "14px", background: "#ffffff", display: "grid", gap: "6px" }}>
                          <div style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>Detail</div>
                          <div style={{ fontSize: "18px", fontWeight: 900, color: "#0f172a" }}>{detailPreview.length}</div>
                          <div style={{ fontSize: "12px", color: "#64748b" }}>
                            {latestDetailPreview ? latestDetailPreview.description : "No detail records"}
                          </div>
                        </div>

                        <div style={{ border: "1px solid #dbe3ee", borderRadius: "16px", padding: "14px", background: "#ffffff", display: "grid", gap: "6px" }}>
                          <div style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>Force</div>
                          <div style={{ fontSize: "18px", fontWeight: 900, color: "#0f172a" }}>{forcePreview.length}</div>
                          <div style={{ fontSize: "12px", color: "#64748b" }}>
                            {latestForceEntry ? `Last forced ${formatDate(latestForceEntry.forced_date)}` : "No force entries"}
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {mobileView === "patrol" && (
                  <>
                    {patrolPreview.length === 0 && <div style={{ color: "#64748b", fontSize: "13px" }}>No Patrol rows found for this employee.</div>}
                    {patrolPreview.map((entry) => (
                      <div key={entry.id} style={{ border: "1px solid #dbe3ee", borderRadius: "16px", padding: "12px", background: "#ffffff" }}>
                        <div style={{ fontWeight: 800 }}>{formatDate(entry.date)}</div>
                        <div style={{ marginTop: "6px", fontSize: "13px", color: "#334155", lineHeight: 1.45 }}>{entry.label}</div>
                        <div style={{ marginTop: "6px", fontSize: "12px", color: "#64748b" }}>{entry.status}</div>
                      </div>
                    ))}
                  </>
                )}

                {mobileView === "force" && (
                  <>
                    <div style={{ border: "1px solid #dbe3ee", borderRadius: "16px", padding: "12px", background: "#ffffff" }}>
                      <div style={{ fontSize: "12px", color: "#64748b" }}>Total Force Entries</div>
                      <div style={{ fontSize: "22px", fontWeight: 800 }}>{forcePreview.length}</div>
                    </div>
                    {forcePreview.map((row) => (
                      <div key={`${row.employee_id}-${row.forced_date}`} style={{ border: "1px solid #dbe3ee", borderRadius: "16px", padding: "12px", background: "#ffffff" }}>
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
                      <div key={detail.id} style={{ border: "1px solid #dbe3ee", borderRadius: "16px", padding: "12px", background: "#ffffff" }}>
                        <div style={{ fontWeight: 800 }}>{detail.description}</div>
                        <div style={{ marginTop: "4px", color: "#475569", fontSize: "13px" }}>{formatDate(detail.date)} | {detail.hours} hrs</div>
                        <div style={{ marginTop: "4px", color: "#64748b", fontSize: "12px" }}>{detail.status}</div>
                      </div>
                    ))}
                  </>
                )}

                {(mobileView === "overtime" || inResponsePortal) && (
                  <>
                    {activeResponseDelivery && responseEmployee && (
                      <>
                        <div style={{ border: "1px solid #bfdbfe", borderRadius: "16px", padding: "12px", background: "#eff6ff", display: "grid", gap: "8px" }}>
                          <div style={{ fontWeight: 800, color: "#1d4ed8" }}>Respond To Shifts In This Notification</div>
                          <div style={{ fontSize: "12px", color: "#334155" }}>
                            Choose your status for each shift below. Only the shifts attached to this email are shown here.
                          </div>
                        </div>

                        {responseShifts.map((request) => {
                          const response = request.responses.find((entry) => entry.employeeId === responseEmployee.id)
                          return (
                            <div key={`response-${request.id}`} style={{ border: "1px solid #dbe3ee", borderRadius: "16px", padding: "12px", background: "#ffffff", display: "grid", gap: "10px" }}>
                              <div style={{ display: "grid", gap: "3px" }}>
                                <div style={{ fontWeight: 800 }}>{formatDate(request.assignmentDate)}</div>
                                <div style={{ color: "#334155", fontSize: "13px" }}>
                                  {request.shiftType} | {request.description}
                                </div>
                              </div>
                              <div style={{ fontSize: "12px", color: "#64748b" }}>
                                Current Response: {response?.status || "Pending"}
                              </div>
                              <div style={{ display: "grid", gap: "6px" }}>
                                {([
                                  ["Interested", "#eff6ff", "#1d4ed8"],
                                  ["Declined", "#fff1f2", "#be123c"]
                                ] as const).map(([status, background, color]) => (
                                  <button
                                    key={`${request.id}-${status}`}
                                    onClick={() => setResponse(request.id, responseEmployee.id, status)}
                                    style={{
                                      border: response?.status === status ? `1px solid ${color}` : "1px solid #cbd5e1",
                                      background: response?.status === status ? background : "#ffffff",
                                      color: response?.status === status ? color : "#334155",
                                      borderRadius: "10px",
                                      padding: "9px 10px",
                                      fontSize: "12px",
                                      fontWeight: 700,
                                      cursor: "pointer",
                                      textAlign: "left"
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

                    {!inResponsePortal && overtimePreview.length === 0 && <div style={{ color: "#64748b", fontSize: "13px" }}>No open overtime shifts are visible right now.</div>}
                    {!inResponsePortal && overtimePreview.map((request) => (
                      <div key={request.id} style={{ border: "1px solid #dbe3ee", borderRadius: "16px", padding: "12px", background: "#ffffff" }}>
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

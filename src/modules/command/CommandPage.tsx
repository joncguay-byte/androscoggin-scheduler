import { useMemo } from "react"

import { Button, Card, CardContent } from "../../components/ui/simple-ui"
import { printElementById } from "../../lib/print"
import { isForceRequired, isShiftCovered } from "../../lib/staffing-engine"
import type { AppRole, AuditEvent, DetailQueueEvent, DetailRecord, Employee, ForceHistoryRow, OvertimeEntry } from "../../types"

type ModuleKey =
  | "patrol"
  | "overtime"
  | "cid"
  | "force"
  | "detail"
  | "reports"
  | "employees"
  | "settings"

type PatrolScheduleSummaryRow = {
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

type CommandPageProps = {
  currentUserRole: AppRole
  employees: Employee[]
  patrolRows: PatrolScheduleSummaryRow[]
  cidOnCallName: string
  detailRecords: DetailRecord[]
  detailQueueEvents: DetailQueueEvent[]
  detailQueueIds: string[]
  overtimeEntries: OvertimeEntry[]
  forceHistory: ForceHistoryRow[]
  auditEvents: AuditEvent[]
  onOpenModule: (module: ModuleKey) => void
}

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  })
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  })
}

function resolvePositionLabel(code: PatrolScheduleSummaryRow["position_code"]) {
  const labels: Record<PatrolScheduleSummaryRow["position_code"], string> = {
    SUP1: "Supervisor 1",
    SUP2: "Supervisor 2",
    DEP1: "Deputy 1",
    DEP2: "Deputy 2",
    POL: "Poland"
  }

  return labels[code]
}

function formatRelativeActivity(createdAt: string) {
  const diffMinutes = Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 60000))
  if (diffMinutes < 1) return "just now"
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return `${Math.round(diffHours / 24)}d ago`
}

const shellCardStyle = {
  border: "1px solid #dbe3ee",
  borderRadius: "18px",
  background: "#ffffff",
  boxShadow: "0 16px 36px rgba(15, 23, 42, 0.08)"
} as const

const quickLinkStyle = {
  border: "1px solid #dbe3ee",
  borderRadius: "14px",
  background: "#ffffff",
  padding: "12px 14px",
  textAlign: "left" as const,
  cursor: "pointer",
  boxShadow: "0 10px 22px rgba(15, 23, 42, 0.05)",
  transition: "transform 140ms ease, box-shadow 140ms ease"
}

export function CommandPage({
  currentUserRole,
  employees,
  patrolRows,
  cidOnCallName,
  detailRecords,
  detailQueueEvents,
  detailQueueIds,
  overtimeEntries,
  forceHistory,
  auditEvents,
  onOpenModule
}: CommandPageProps) {
  const canAccess = currentUserRole === "admin" || currentUserRole === "sergeant"

  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)
  const upcomingLimit = new Date(today)
  upcomingLimit.setDate(upcomingLimit.getDate() + 14)
  const upcomingLimitIso = upcomingLimit.toISOString().slice(0, 10)

  const upcomingOpenShifts = useMemo(
    () =>
      patrolRows.filter((row) => {
        if (row.assignment_date < todayIso || row.assignment_date > upcomingLimitIso) return false
        if (row.status === "Off") return false
        return !isShiftCovered(row)
      }),
    [patrolRows, todayIso, upcomingLimitIso]
  )

  const staffingAlerts = useMemo(() => {
    const grouped = new Map<string, PatrolScheduleSummaryRow[]>()

    for (const row of patrolRows) {
      if (row.assignment_date < todayIso || row.assignment_date > upcomingLimitIso) continue
      const key = `${row.assignment_date}-${row.shift_type}`
      const rows = grouped.get(key) || []
      rows.push(row)
      grouped.set(key, rows)
    }

    return [...grouped.entries()]
      .flatMap(([key, rows]) => {
        if (!rows[0] || !isForceRequired(rows[0], rows)) return []

        const coveredRows = rows.filter((row) => isShiftCovered(row))
        const supervisorCount = coveredRows.filter((row) => row.position_code === "SUP1" || row.position_code === "SUP2").length
        const reasons: string[] = []

        if (supervisorCount === 0) reasons.push("No supervisor on duty")
        if (coveredRows.length < 4) reasons.push(`Only ${coveredRows.length} covered employees`)

        return [{
          key,
          assignmentDate: rows[0].assignment_date,
          shiftType: rows[0].shift_type,
          reasons
        }]
      })
      .sort((a, b) => a.assignmentDate.localeCompare(b.assignmentDate) || a.shiftType.localeCompare(b.shiftType))
  }, [patrolRows, todayIso, upcomingLimitIso])

  const nextEligibleDetailEmployee = useMemo(() => {
    const employeeMap = new Map(employees.map((employee) => [employee.id, employee]))
    return detailQueueIds.map((id) => employeeMap.get(id)).find(Boolean) || null
  }, [detailQueueIds, employees])

  const detailSnapshot = useMemo(() => {
    const assigned = detailRecords.filter((detail) => detail.status === "Assigned").length
    const acceptedHours = detailRecords
      .filter((detail) => detail.status === "Accepted")
      .reduce((total, detail) => total + detail.hours, 0)

    return {
      assigned,
      acceptedHours
    }
  }, [detailRecords])

  const overtimeSnapshot = useMemo(() => {
    const manualHours = overtimeEntries.reduce((total, entry) => total + entry.hours, 0)
    const detailHours = detailRecords
      .filter((detail) => detail.status === "Accepted")
      .reduce((total, detail) => total + detail.hours, 0)

    return {
      totalHours: manualHours + detailHours,
      manualHours,
      detailHours
    }
  }, [detailRecords, overtimeEntries])

  const forceSnapshot = useMemo(() => {
    return employees
      .map((employee) => {
        const history = forceHistory
          .filter((row) => row.employee_id === employee.id)
          .sort((a, b) => b.forced_date.localeCompare(a.forced_date))

        const totalOvertime = overtimeEntries
          .filter((entry) => entry.employeeId === employee.id)
          .reduce((total, entry) => total + entry.hours, 0) +
          detailRecords
            .filter((detail) => detail.employeeId === employee.id && detail.status === "Accepted")
            .reduce((total, detail) => total + detail.hours, 0)

        return {
          employee,
          totalForces: history.length,
          lastForced: history[0]?.forced_date || "-",
          totalOvertime
        }
      })
      .sort((a, b) => a.totalForces - b.totalForces || a.lastForced.localeCompare(b.lastForced))
      .slice(0, 5)
  }, [detailRecords, employees, forceHistory, overtimeEntries])

  const recentDetailActivity = useMemo(
    () => detailQueueEvents.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
    [detailQueueEvents]
  )

  const recentChanges = useMemo(
    () => auditEvents.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6),
    [auditEvents]
  )

  const employeeMap = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees])

  if (!canAccess) {
    return (
      <Card>
        <CardContent>
          <div style={{ padding: "12px 4px", color: "#475569", fontSize: "14px" }}>
            Command is available only to admins and sergeants.
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div id="command-print-section" style={{ display: "grid", gap: "18px" }}>
      <div
        style={{
          ...shellCardStyle,
          padding: "22px 24px",
          background: "linear-gradient(135deg, #0f274f 0%, #173b72 52%, #f8fbff 52.1%, #ffffff 100%)"
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 0.9fr",
            gap: "18px",
            alignItems: "stretch"
          }}
        >
          <div style={{ display: "grid", gap: "14px" }}>
            <div>
              <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.08em", color: "#c9d7f2", fontWeight: 800 }}>
                Command Center
              </div>
              <div style={{ marginTop: "8px", fontSize: "34px", lineHeight: 1.05, fontWeight: 900, color: "#ffffff" }}>
                Live Operations Board
              </div>
              <div style={{ marginTop: "10px", maxWidth: "620px", fontSize: "14px", lineHeight: 1.6, color: "#d6e2f7" }}>
                Patrol coverage, overtime exposure, force fairness, and detail activity are all visible here so you can make command decisions without bouncing module to module.
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "12px" }}>
              {[
                { label: "CID On-Call", value: cidOnCallName, color: "#0f172a", background: "#ffffff", border: "#dbeafe" },
                { label: "Open Shift Risk", value: String(upcomingOpenShifts.length), color: "#c2410c", background: "#fff7ed", border: "#fdba74" },
                { label: "Staffing Alerts", value: String(staffingAlerts.length), color: "#b91c1c", background: "#fff1f2", border: "#fda4af" },
                { label: "Total Overtime", value: `${overtimeSnapshot.totalHours.toFixed(1)} hrs`, color: "#1d4ed8", background: "#eff6ff", border: "#93c5fd" }
              ].map((metric) => (
                <div
                  key={metric.label}
                  style={{
                    border: `1px solid ${metric.border}`,
                    borderRadius: "16px",
                    background: metric.background,
                    padding: "14px 15px",
                    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)"
                  }}
                >
                  <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b", fontWeight: 800 }}>
                    {metric.label}
                  </div>
                  <div style={{ marginTop: "8px", fontSize: metric.label === "CID On-Call" ? "20px" : "24px", fontWeight: 900, color: metric.color }}>
                    {metric.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              border: "1px solid #dbe3ee",
              borderRadius: "18px",
              background: "rgba(255,255,255,0.94)",
              padding: "16px 18px",
              display: "grid",
              gap: "12px",
              alignContent: "start",
              boxShadow: "0 14px 28px rgba(15, 23, 42, 0.09)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b", fontWeight: 800 }}>
                  Quick Jump
                </div>
                <div style={{ marginTop: "5px", fontSize: "18px", fontWeight: 900, color: "#0f172a" }}>
                  Command Shortcuts
                </div>
              </div>
              <Button data-no-print="true" onClick={() => printElementById("command-print-section", "Command Dashboard")}>
                Print Command
              </Button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              {[
                { label: "Open Patrol", detail: "Staffing, overrides, replacements", module: "patrol" as const },
                { label: "Open Overtime", detail: "Queue, responses, assignments", module: "overtime" as const },
                { label: "Open Force", detail: "Rotation and history", module: "force" as const },
                { label: "Open Detail", detail: "Queue and accepted coverage", module: "detail" as const }
              ].map((item) => (
                <button
                  key={item.label}
                  onClick={() => onOpenModule(item.module)}
                  style={quickLinkStyle}
                >
                  <div style={{ fontSize: "14px", fontWeight: 800, color: "#0f172a" }}>
                    {item.label}
                  </div>
                  <div style={{ marginTop: "4px", fontSize: "12px", color: "#64748b" }}>
                    {item.detail}
                  </div>
                </button>
              ))}
            </div>

            <div
              style={{
                border: "1px solid #dbeafe",
                borderRadius: "14px",
                background: "#f8fbff",
                padding: "12px 14px"
              }}
            >
              <div style={{ fontSize: "12px", fontWeight: 800, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Next Detail Position
              </div>
              <div style={{ marginTop: "6px", fontSize: "18px", fontWeight: 900, color: "#0f172a" }}>
                {nextEligibleDetailEmployee ? `${nextEligibleDetailEmployee.firstName} ${nextEligibleDetailEmployee.lastName}` : "None"}
              </div>
              <div style={{ marginTop: "6px", fontSize: "12px", color: "#475569" }}>
                Assigned details: {detailSnapshot.assigned} | Accepted hours: {detailSnapshot.acceptedHours.toFixed(1)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.35fr 0.95fr", gap: "18px" }}>
        <Card>
          <CardContent>
            <div style={{ padding: "4px 4px 2px 4px", display: "grid", gap: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b", fontWeight: 800 }}>
                    Staffing Watch
                  </div>
                  <div style={{ marginTop: "4px", fontSize: "22px", fontWeight: 900, color: "#0f172a" }}>
                    Next 14 Days
                  </div>
                </div>
                <Button onClick={() => onOpenModule("patrol")}>Open Patrol</Button>
              </div>

              {staffingAlerts.length === 0 && upcomingOpenShifts.length === 0 ? (
                <div
                  style={{
                    border: "1px solid #bbf7d0",
                    borderRadius: "14px",
                    background: "#f0fdf4",
                    padding: "14px 16px",
                    color: "#166534",
                    fontWeight: 700
                  }}
                >
                  No staffing issues are showing in the next two weeks.
                </div>
              ) : (
                <div style={{ display: "grid", gap: "10px" }}>
                  {staffingAlerts.map((alert) => (
                    <button
                      key={alert.key}
                      onClick={() => onOpenModule("patrol")}
                      style={{
                        border: "1px solid #fecaca",
                        borderRadius: "14px",
                        padding: "14px 16px",
                        background: "#fff7f7",
                        textAlign: "left",
                        cursor: "pointer"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
                        <div style={{ fontWeight: 900, color: "#0f172a" }}>
                          {formatDate(alert.assignmentDate)} | {alert.shiftType}
                        </div>
                        <div style={{ fontSize: "11px", fontWeight: 900, textTransform: "uppercase", color: "#b91c1c" }}>
                          Alert
                        </div>
                      </div>
                      <div style={{ marginTop: "8px", fontSize: "13px", color: "#7f1d1d", lineHeight: 1.45 }}>
                        {alert.reasons.join(" | ")}
                      </div>
                    </button>
                  ))}

                  {upcomingOpenShifts.slice(0, 6).map((row) => (
                    <button
                      key={`${row.assignment_date}-${row.shift_type}-${row.position_code}`}
                      onClick={() => onOpenModule("patrol")}
                      style={{
                        border: "1px solid #fed7aa",
                        borderRadius: "14px",
                        padding: "14px 16px",
                        background: "#fff7ed",
                        textAlign: "left",
                        cursor: "pointer"
                      }}
                    >
                      <div style={{ fontWeight: 900, color: "#0f172a" }}>
                        {formatDate(row.assignment_date)} | {row.shift_type} | {resolvePositionLabel(row.position_code)}
                      </div>
                      <div style={{ marginTop: "8px", fontSize: "13px", color: "#9a3412", lineHeight: 1.45 }}>
                        {row.status || "Open Shift"} needs coverage
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div style={{ display: "grid", gap: "18px" }}>
          <Card>
            <CardContent>
              <div style={{ padding: "4px", display: "grid", gap: "12px" }}>
                <div>
                  <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b", fontWeight: 800 }}>
                    Force Snapshot
                  </div>
                  <div style={{ marginTop: "4px", fontSize: "22px", fontWeight: 900, color: "#0f172a" }}>
                    Lowest Force Load
                  </div>
                </div>

                <div style={{ display: "grid", gap: "10px" }}>
                  {forceSnapshot.map((row, index) => (
                    <button
                      key={row.employee.id}
                      onClick={() => onOpenModule("force")}
                      style={{
                        border: index === 0 ? "1px solid #86efac" : "1px solid #e2e8f0",
                        borderRadius: "14px",
                        padding: "12px 14px",
                        background: index === 0 ? "#f0fdf4" : "#ffffff",
                        textAlign: "left",
                        cursor: "pointer"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center" }}>
                        <div style={{ fontSize: "14px", fontWeight: 900, color: "#0f172a" }}>
                          {index + 1}. {row.employee.firstName} {row.employee.lastName}
                        </div>
                        <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 800 }}>
                          Forced {row.totalForces}
                        </div>
                      </div>
                      <div style={{ marginTop: "6px", fontSize: "12px", color: "#475569", lineHeight: 1.45 }}>
                        Last: {row.lastForced} | Total OT: {row.totalOvertime.toFixed(1)} hrs
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <div style={{ padding: "4px", display: "grid", gap: "12px" }}>
                <div>
                  <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b", fontWeight: 800 }}>
                    Overtime Mix
                  </div>
                  <div style={{ marginTop: "4px", fontSize: "22px", fontWeight: 900, color: "#0f172a" }}>
                    Hours Breakdown
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div style={{ border: "1px solid #dbeafe", borderRadius: "14px", background: "#f8fbff", padding: "12px 14px" }}>
                    <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 800, textTransform: "uppercase" }}>
                      Manual OT
                    </div>
                    <div style={{ marginTop: "8px", fontSize: "22px", fontWeight: 900, color: "#1d4ed8" }}>
                      {overtimeSnapshot.manualHours.toFixed(1)}
                    </div>
                  </div>
                  <div style={{ border: "1px solid #dbeafe", borderRadius: "14px", background: "#f8fbff", padding: "12px 14px" }}>
                    <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 800, textTransform: "uppercase" }}>
                      Detail OT
                    </div>
                    <div style={{ marginTop: "8px", fontSize: "22px", fontWeight: 900, color: "#1d4ed8" }}>
                      {overtimeSnapshot.detailHours.toFixed(1)}
                    </div>
                  </div>
                </div>

                <Button onClick={() => onOpenModule("reports")}>Open Reports</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.05fr 1fr", gap: "18px" }}>
        <Card>
          <CardContent>
            <div style={{ padding: "4px", display: "grid", gap: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b", fontWeight: 800 }}>
                    Detail Queue Activity
                  </div>
                  <div style={{ marginTop: "4px", fontSize: "22px", fontWeight: 900, color: "#0f172a" }}>
                    Recent Detail Movement
                  </div>
                </div>
                <Button onClick={() => onOpenModule("detail")}>Open Detail</Button>
              </div>

              {recentDetailActivity.length === 0 ? (
                <div style={{ color: "#475569", fontSize: "13px" }}>
                  No detail activity yet.
                </div>
              ) : (
                <div style={{ display: "grid", gap: "10px" }}>
                  {recentDetailActivity.map((event) => {
                    const employee = employeeMap.get(event.employeeId)
                    return (
                      <div
                        key={event.id}
                        style={{
                          border: "1px solid #e2e8f0",
                          borderRadius: "14px",
                          padding: "12px 14px",
                          background: "#ffffff"
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
                          <div style={{ fontSize: "14px", fontWeight: 900, color: "#0f172a" }}>
                            {employee ? `${employee.firstName} ${employee.lastName}` : "Unknown Employee"} | {event.type}
                          </div>
                          <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 700 }}>
                            {formatRelativeActivity(event.createdAt)}
                          </div>
                        </div>
                        <div style={{ marginTop: "6px", fontSize: "12px", color: "#475569", lineHeight: 1.5 }}>
                          {formatDate(event.date)} | {event.description}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <div style={{ padding: "4px", display: "grid", gap: "14px" }}>
              <div>
                <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b", fontWeight: 800 }}>
                  Audit Trail
                </div>
                <div style={{ marginTop: "4px", fontSize: "22px", fontWeight: 900, color: "#0f172a" }}>
                  Recent Changes
                </div>
              </div>

              {recentChanges.length === 0 ? (
                <div style={{ color: "#475569", fontSize: "13px" }}>
                  No recent changes yet.
                </div>
              ) : (
                <div style={{ display: "grid", gap: "10px" }}>
                  {recentChanges.map((event) => (
                    <div
                      key={event.id}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: "14px",
                        padding: "12px 14px",
                        background: "#ffffff"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
                        <div style={{ fontSize: "14px", fontWeight: 900, color: "#0f172a" }}>
                          {event.module} | {event.action}
                        </div>
                        <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 700 }}>
                          {formatRelativeActivity(event.createdAt)}
                        </div>
                      </div>
                      <div style={{ marginTop: "6px", fontSize: "12px", color: "#475569", lineHeight: 1.5 }}>
                        {event.summary}
                      </div>
                      <div style={{ marginTop: "6px", fontSize: "11px", color: "#94a3b8" }}>
                        {formatDateTime(event.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

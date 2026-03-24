import { useMemo } from "react"
import { Button, Card, CardContent, CardHeader, CardTitle } from "../../components/ui/simple-ui"
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

  const recentActivity = useMemo(
    () => detailQueueEvents.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6),
    [detailQueueEvents]
  )

  const recentChanges = useMemo(
    () => auditEvents.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8),
    [auditEvents]
  )

  if (!canAccess) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Command Dashboard</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ color: "#475569", fontSize: "14px" }}>
            Command is available only to admins and sergeants.
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div id="command-print-section" style={{ display: "grid", gap: "18px" }}>
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
            <CardTitle>Command Dashboard</CardTitle>
            <Button data-no-print="true" onClick={() => printElementById("command-print-section", "Command Dashboard")}>
              Print Command
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "12px" }}>
            <div style={{ border: "1px solid #dbeafe", borderRadius: "14px", padding: "14px", background: "#f8fbff" }}>
              <div style={{ fontSize: "11px", textTransform: "uppercase", color: "#64748b", fontWeight: 700 }}>CID On-Call</div>
              <div style={{ marginTop: "6px", fontSize: "20px", fontWeight: 800 }}>{cidOnCallName}</div>
            </div>
            <button
              onClick={() => onOpenModule("patrol")}
              style={{ border: "1px solid #fed7aa", borderRadius: "14px", padding: "14px", background: "#fff7ed", textAlign: "left", cursor: "pointer" }}
            >
              <div style={{ fontSize: "11px", textTransform: "uppercase", color: "#9a3412", fontWeight: 700 }}>Open Shifts</div>
              <div style={{ marginTop: "6px", fontSize: "20px", fontWeight: 800, color: "#ea580c" }}>{upcomingOpenShifts.length}</div>
            </button>
            <button
              onClick={() => onOpenModule("patrol")}
              style={{ border: "1px solid #fecaca", borderRadius: "14px", padding: "14px", background: "#fff7f7", textAlign: "left", cursor: "pointer" }}
            >
              <div style={{ fontSize: "11px", textTransform: "uppercase", color: "#991b1b", fontWeight: 700 }}>Staffing Alerts</div>
              <div style={{ marginTop: "6px", fontSize: "20px", fontWeight: 800, color: "#dc2626" }}>{staffingAlerts.length}</div>
            </button>
            <button
              onClick={() => onOpenModule("detail")}
              style={{ border: "1px solid #d8c79d", borderRadius: "14px", padding: "14px", background: "#fffdf7", textAlign: "left", cursor: "pointer" }}
            >
              <div style={{ fontSize: "11px", textTransform: "uppercase", color: "#7a6640", fontWeight: 700 }}>Total Overtime</div>
              <div style={{ marginTop: "6px", fontSize: "20px", fontWeight: 800, color: "#1e3a8a" }}>{overtimeSnapshot.totalHours.toFixed(1)} hrs</div>
            </button>
          </div>
        </CardContent>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "18px" }}>
        <Card>
          <CardHeader>
            <CardTitle>Staffing Watch</CardTitle>
          </CardHeader>

          <CardContent>
            <div style={{ display: "grid", gap: "10px" }}>
              {staffingAlerts.length === 0 && upcomingOpenShifts.length === 0 && (
                <div style={{ color: "#475569", fontSize: "13px" }}>
                  No staffing issues are showing in the next two weeks.
                </div>
              )}

              {staffingAlerts.map((alert) => (
                <button
                  key={alert.key}
                  onClick={() => onOpenModule("patrol")}
                  style={{ border: "1px solid #fecaca", borderRadius: "12px", padding: "12px", background: "#fff7f7", textAlign: "left", cursor: "pointer" }}
                >
                  <div style={{ fontWeight: 700 }}>{formatDate(alert.assignmentDate)} | {alert.shiftType}</div>
                  <div style={{ marginTop: "6px", color: "#7f1d1d", fontSize: "13px" }}>{alert.reasons.join(" | ")}</div>
                </button>
              ))}

              {upcomingOpenShifts.slice(0, 6).map((row) => (
                <button
                  key={`${row.assignment_date}-${row.shift_type}-${row.position_code}`}
                  onClick={() => onOpenModule("patrol")}
                  style={{ border: "1px solid #fed7aa", borderRadius: "12px", padding: "12px", background: "#fff7ed", textAlign: "left", cursor: "pointer" }}
                >
                  <div style={{ fontWeight: 700 }}>{formatDate(row.assignment_date)} | {row.shift_type} | {resolvePositionLabel(row.position_code)}</div>
                  <div style={{ marginTop: "6px", color: "#9a3412", fontSize: "13px" }}>{row.status || "Open Shift"} needs coverage</div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <div style={{ display: "grid", gap: "18px" }}>
          <Card>
            <CardHeader>
              <CardTitle>Detail Queue</CardTitle>
            </CardHeader>
            <CardContent>
              <div style={{ display: "grid", gap: "8px" }}>
                <div style={{ fontSize: "13px", color: "#475569" }}>Assigned details: <strong>{detailSnapshot.assigned}</strong></div>
                <div style={{ fontSize: "13px", color: "#475569" }}>Accepted detail hours: <strong>{detailSnapshot.acceptedHours.toFixed(1)}</strong></div>
                <div style={{ fontSize: "13px", color: "#475569" }}>
                  Next in queue: <strong>{nextEligibleDetailEmployee ? `${nextEligibleDetailEmployee.firstName} ${nextEligibleDetailEmployee.lastName}` : "None"}</strong>
                </div>
                <Button onClick={() => onOpenModule("detail")}>Open Detail</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Force Snapshot</CardTitle>
            </CardHeader>
            <CardContent>
              <div style={{ display: "grid", gap: "10px" }}>
                {forceSnapshot.map((row, index) => (
                  <button
                    key={row.employee.id}
                    onClick={() => onOpenModule("force")}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: "12px",
                      padding: "12px",
                      background: index === 0 ? "#dcfce7" : "#ffffff",
                      textAlign: "left",
                      cursor: "pointer"
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{index + 1}. {row.employee.firstName} {row.employee.lastName}</div>
                    <div style={{ marginTop: "6px", fontSize: "13px", color: "#475569" }}>
                      Forces: {row.totalForces} | Last: {row.lastForced} | OT: {row.totalOvertime.toFixed(1)} hrs
                    </div>
                  </button>
                ))}
                <Button onClick={() => onOpenModule("force")}>Open Force</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: "10px" }}>Detail Queue Events</div>
              <div style={{ display: "grid", gap: "8px" }}>
                {recentActivity.length === 0 && (
                  <div style={{ color: "#475569", fontSize: "13px" }}>No detail activity yet.</div>
                )}
                {recentActivity.map((event) => {
                  const employee = employees.find((employeeRow) => employeeRow.id === event.employeeId)
                  return (
                    <div key={event.id} style={{ border: "1px solid #e2e8f0", borderRadius: "10px", padding: "10px", background: "#ffffff" }}>
                      <div style={{ fontWeight: 700 }}>{employee ? `${employee.firstName} ${employee.lastName}` : "Unknown Employee"} | {event.type}</div>
                      <div style={{ marginTop: "4px", fontSize: "13px", color: "#475569" }}>{formatDate(event.date)} | {event.description}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 700, marginBottom: "10px" }}>Overtime Snapshot</div>
              <div style={{ display: "grid", gap: "8px" }}>
                <div style={{ border: "1px solid #dbeafe", borderRadius: "10px", padding: "10px", background: "#f8fbff" }}>
                  <div style={{ fontSize: "13px", color: "#475569" }}>Manual overtime</div>
                  <div style={{ fontWeight: 800, fontSize: "18px" }}>{overtimeSnapshot.manualHours.toFixed(1)} hrs</div>
                </div>
                <div style={{ border: "1px solid #dbeafe", borderRadius: "10px", padding: "10px", background: "#f8fbff" }}>
                  <div style={{ fontSize: "13px", color: "#475569" }}>Detail overtime</div>
                  <div style={{ fontWeight: 800, fontSize: "18px" }}>{overtimeSnapshot.detailHours.toFixed(1)} hrs</div>
                </div>
                <Button onClick={() => onOpenModule("reports")}>Open Reports</Button>
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 700, marginBottom: "10px" }}>Recent Changes</div>
              <div style={{ display: "grid", gap: "8px" }}>
                {recentChanges.length === 0 && (
                  <div style={{ color: "#475569", fontSize: "13px" }}>No recent changes yet.</div>
                )}
                {recentChanges.map((event) => (
                  <div key={event.id} style={{ border: "1px solid #e2e8f0", borderRadius: "10px", padding: "10px", background: "#ffffff" }}>
                    <div style={{ fontWeight: 700 }}>{event.module} | {event.action}</div>
                    <div style={{ marginTop: "4px", fontSize: "13px", color: "#475569" }}>{event.summary}</div>
                    <div style={{ marginTop: "4px", fontSize: "11px", color: "#64748b" }}>
                      {new Date(event.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

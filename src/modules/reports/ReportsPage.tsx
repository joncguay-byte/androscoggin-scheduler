import { useEffect, useMemo, useState } from "react"
import type { Dispatch, SetStateAction } from "react"
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectItem
} from "../../components/ui/simple-ui"
import { printElementById } from "../../lib/print"
import { buildReportBriefing } from "../../lib/ops-assistant"
import { AiAssistPanel } from "../../components/AiAssistPanel"
import type { AppRole, DetailRecord, Employee, ForceHistoryRow, OvertimeEntry, ReportType, Team } from "../../types"

type ReportsPageProps = {
  employees: Employee[]
  currentUserRole: AppRole
  overtimeEntries: OvertimeEntry[]
  setOvertimeEntries: Dispatch<SetStateAction<OvertimeEntry[]>>
  detailRecords: DetailRecord[]
  forceHistory: ForceHistoryRow[]
  cidOnCallName: string
  defaultReportType?: ReportType
  onAuditEvent?: (action: string, summary: string, details?: string) => void
}

type OvertimeDraft = {
  employeeId: string
  date: string
  hours: string
  reason: string
}

type CombinedOvertimeRow = {
  id: string
  employeeId: string
  employeeName: string
  team: Team
  date: string
  hours: number
  reason: string
  source: "Manual" | "Detail"
}

const editableRoles: AppRole[] = ["admin", "sergeant"]
const teamOptions: Array<Team | "All"> = ["All", "Days A", "Days B", "Nights A", "Nights B", "CID", "SRO", "None"]

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  })
}

function buildCsv(rows: string[][]) {
  return rows
    .map((row) =>
      row
        .map((value) => `"${String(value).replaceAll("\"", "\"\"")}"`)
        .join(",")
    )
    .join("\n")
}

function downloadCsv(filename: string, rows: string[][]) {
  const blob = new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function ReportsPage({
  employees,
  currentUserRole,
  overtimeEntries,
  setOvertimeEntries,
  detailRecords,
  forceHistory,
  cidOnCallName,
  defaultReportType = "overtime",
  onAuditEvent
}: ReportsPageProps) {
  const canEdit = editableRoles.includes(currentUserRole)
  const today = new Date().toISOString().slice(0, 10)
  const [reportType, setReportType] = useState<ReportType>(defaultReportType)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [teamFilter, setTeamFilter] = useState<Team | "All">("All")
  const [employeeFilter, setEmployeeFilter] = useState("All")
  const [draft, setDraft] = useState<OvertimeDraft>({
    employeeId: "",
    date: today,
    hours: "",
    reason: ""
  })
  const [message, setMessage] = useState("")

  const employeeMap = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee])),
    [employees]
  )

  useEffect(() => {
    setReportType(defaultReportType)
  }, [defaultReportType])

  const combinedOvertime = useMemo<CombinedOvertimeRow[]>(() => {
    const manualRows = overtimeEntries
      .flatMap((entry) => {
        const employee = employeeMap.get(entry.employeeId)
        if (!employee) return []

        return [{
          id: entry.id,
          employeeId: entry.employeeId,
          employeeName: `${employee.firstName} ${employee.lastName}`,
          team: employee.team,
          date: entry.date,
          hours: entry.hours,
          reason: entry.reason,
          source: entry.source
        }]
      })

    const detailRows = detailRecords
      .filter((detail) => detail.status === "Accepted")
      .flatMap((detail) => {
        const employee = employeeMap.get(detail.employeeId)
        if (!employee) return []

        return [{
          id: detail.id,
          employeeId: detail.employeeId,
          employeeName: `${employee.firstName} ${employee.lastName}`,
          team: employee.team,
          date: detail.date,
          hours: detail.hours,
          reason: detail.description,
          source: "Detail" as const
        }]
      })

    return [...manualRows, ...detailRows].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      return a.employeeName.localeCompare(b.employeeName)
    })
  }, [detailRecords, employeeMap, overtimeEntries])

  const filteredOvertime = useMemo(
    () =>
      combinedOvertime.filter((row) => {
        if (dateFrom && row.date < dateFrom) return false
        if (dateTo && row.date > dateTo) return false
        if (teamFilter !== "All" && row.team !== teamFilter) return false
        if (employeeFilter !== "All" && row.employeeId !== employeeFilter) return false
        return true
      }),
    [combinedOvertime, dateFrom, dateTo, employeeFilter, teamFilter]
  )

  const totals = useMemo(() => {
    const totalHours = filteredOvertime.reduce((sum, row) => sum + row.hours, 0)
    const uniqueEmployees = new Set(filteredOvertime.map((row) => row.employeeId))
    const manualHours = filteredOvertime
      .filter((row) => row.source === "Manual")
      .reduce((sum, row) => sum + row.hours, 0)
    const detailHours = filteredOvertime
      .filter((row) => row.source === "Detail")
      .reduce((sum, row) => sum + row.hours, 0)

    return {
      totalHours,
      employeeCount: uniqueEmployees.size,
      manualHours,
      detailHours
    }
  }, [filteredOvertime])

  const teamTotals = useMemo(
    () =>
      [...filteredOvertime.reduce((map, row) => {
        map.set(row.team, (map.get(row.team) || 0) + row.hours)
        return map
      }, new Map<Team, number>()).entries()]
        .map(([team, hours]) => ({ team, hours }))
        .sort((a, b) => b.hours - a.hours),
    [filteredOvertime]
  )

  const employeeTotals = useMemo(
    () =>
      [...filteredOvertime.reduce((map, row) => {
        const current = map.get(row.employeeId) || {
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          team: row.team,
          totalHours: 0,
          lastDate: row.date,
          lastReason: row.reason
        }

        current.totalHours += row.hours

        if (row.date >= current.lastDate) {
          current.lastDate = row.date
          current.lastReason = row.reason
        }

        map.set(row.employeeId, current)
        return map
      }, new Map<string, {
        employeeId: string
        employeeName: string
        team: Team
        totalHours: number
        lastDate: string
        lastReason: string
      }>()).values()]
        .sort((a, b) => b.totalHours - a.totalHours || a.employeeName.localeCompare(b.employeeName)),
    [filteredOvertime]
  )

  const patrolStaffingRows = useMemo(
    () =>
      teamOptions
        .filter((team): team is Team => team !== "All")
        .map((team) => ({
          team,
          activeCount: employees.filter((employee) => employee.status === "Active" && employee.team === team).length
        }))
        .filter((row) => row.activeCount > 0),
    [employees]
  )

  const visibleEmployees = useMemo(
    () =>
      employees
        .filter((employee) => teamFilter === "All" || employee.team === teamFilter)
        .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)),
    [employees, teamFilter]
  )

  const filteredForceHistory = useMemo(
    () =>
      forceHistory
        .flatMap((row) => {
          const employee = employeeMap.get(row.employee_id)
          if (!employee) return []
          if (dateFrom && row.forced_date < dateFrom) return []
          if (dateTo && row.forced_date > dateTo) return []
          if (teamFilter !== "All" && employee.team !== teamFilter) return []
          if (employeeFilter !== "All" && row.employee_id !== employeeFilter) return []

          return [{
            ...row,
            employeeName: `${employee.firstName} ${employee.lastName}`,
            team: employee.team
          }]
        })
        .sort((a, b) => b.forced_date.localeCompare(a.forced_date) || a.employeeName.localeCompare(b.employeeName)),
    [dateFrom, dateTo, employeeFilter, employeeMap, forceHistory, teamFilter]
  )

  const forceSummaryRows = useMemo(
    () =>
      [...filteredForceHistory.reduce((map, row) => {
        const current = map.get(row.employee_id) || {
          employeeId: row.employee_id,
          employeeName: row.employeeName,
          team: row.team,
          total: 0,
          lastForced: row.forced_date
        }

        current.total += 1
        if (row.forced_date > current.lastForced) {
          current.lastForced = row.forced_date
        }

        map.set(row.employee_id, current)
        return map
      }, new Map<string, {
        employeeId: string
        employeeName: string
        team: Team
        total: number
        lastForced: string
      }>()).values()]
        .sort((a, b) => a.total - b.total || a.lastForced.localeCompare(b.lastForced) || a.employeeName.localeCompare(b.employeeName)),
    [filteredForceHistory]
  )

  const forceTeamTotals = useMemo(
    () =>
      [...filteredForceHistory.reduce((map, row) => {
        map.set(row.team, (map.get(row.team) || 0) + 1)
        return map
      }, new Map<Team, number>()).entries()]
        .map(([team, total]) => ({ team, total }))
      .sort((a, b) => a.total - b.total || a.team.localeCompare(b.team)),
    [filteredForceHistory]
  )

  function updateDraft<K extends keyof OvertimeDraft>(key: K, value: OvertimeDraft[K]) {
    setDraft((current) => ({
      ...current,
      [key]: value
    }))
  }

  function addManualOvertimeEntry() {
    const hours = Number(draft.hours)

    if (!draft.employeeId || !draft.date || !hours || !draft.reason.trim()) {
      setMessage("Add an employee, date, hours, and reason before saving overtime.")
      return
    }

    const entry: OvertimeEntry = {
      id: crypto.randomUUID(),
      employeeId: draft.employeeId,
      date: draft.date,
      hours,
      reason: draft.reason.trim(),
      source: "Manual",
      createdAt: new Date().toISOString()
    }

    setOvertimeEntries((current) => [
      ...current,
      entry
    ])

    const employee = employeeMap.get(entry.employeeId)
    onAuditEvent?.(
      "Manual Overtime Added",
      `Added manual overtime for ${employee ? `${employee.firstName} ${employee.lastName}` : "Unknown employee"}.`,
      `${entry.date} | ${entry.hours} hours | ${entry.reason}`
    )

    setDraft((current) => ({
      ...current,
      hours: "",
      reason: ""
    }))
    setMessage("Manual overtime entry saved.")
  }

  function deleteManualOvertimeEntry(entryId: string) {
    const existingEntry = overtimeEntries.find((entry) => entry.id === entryId)
    setOvertimeEntries((current) => current.filter((entry) => entry.id !== entryId))
    if (existingEntry) {
      const employee = employeeMap.get(existingEntry.employeeId)
      onAuditEvent?.(
        "Manual Overtime Deleted",
        `Deleted manual overtime for ${employee ? `${employee.firstName} ${employee.lastName}` : "Unknown employee"}.`,
        `${existingEntry.date} | ${existingEntry.hours} hours | ${existingEntry.reason}`
      )
    }
    setMessage("Manual overtime entry deleted.")
  }

  function exportCurrentReport() {
    if (reportType === "overtime") {
      downloadCsv("overtime-report.csv", [
        ["Employee", "Team", "Date", "Hours", "Reason", "Source"],
        ...filteredOvertime.map((row) => [
          row.employeeName,
          row.team,
          row.date,
          String(row.hours),
          row.reason,
          row.source
        ])
      ])
      return
    }

    if (reportType === "team_overtime") {
      downloadCsv("team-overtime-report.csv", [
        ["Team", "Total Hours"],
        ...teamTotals.map((row) => [row.team, String(row.hours)])
      ])
      return
    }

    if (reportType === "employee_overtime") {
      downloadCsv("employee-overtime-report.csv", [
        ["Employee", "Team", "Total Hours", "Last Overtime Date", "Last Reason"],
        ...employeeTotals.map((row) => [
          row.employeeName,
          row.team,
          String(row.totalHours),
          row.lastDate,
          row.lastReason
        ])
      ])
      return
    }

    if (reportType === "detail_hours") {
      downloadCsv("detail-hours-report.csv", [
        ["Employee", "Date", "Hours", "Description"],
        ...filteredOvertime
          .filter((row) => row.source === "Detail")
          .map((row) => [row.employeeName, row.date, String(row.hours), row.reason])
      ])
      return
    }

    if (reportType === "cid_on_call") {
      downloadCsv("cid-on-call-report.csv", [
        ["Current CID On-Call"],
        [cidOnCallName]
      ])
      return
    }

    if (reportType === "force_summary") {
      downloadCsv("force-summary-report.csv", [
        ["Employee", "Team", "Total Forced", "Last Forced"],
        ...forceSummaryRows.map((row) => [
          row.employeeName,
          row.team,
          String(row.total),
          row.lastForced
        ])
      ])
      return
    }

    if (reportType === "force_history") {
      downloadCsv("force-history-report.csv", [
        ["Employee", "Team", "Forced Date"],
        ...filteredForceHistory.map((row) => [row.employeeName, row.team, row.forced_date])
      ])
      return
    }

    if (reportType === "force_individual") {
      downloadCsv("force-individual-report.csv", [
        ["Employee", "Team", "Total Forced", "Last Forced"],
        ...forceSummaryRows.map((row) => [
          row.employeeName,
          row.team,
          String(row.total),
          row.lastForced
        ])
      ])
      return
    }

    downloadCsv("patrol-staffing-report.csv", [
      ["Team", "Active Employees"],
      ...patrolStaffingRows.map((row) => [row.team, String(row.activeCount)])
    ])
  }

  const reportBriefing = useMemo(
    () =>
      buildReportBriefing({
        reportType,
        totalHours: totals.totalHours,
        employeeCount: totals.employeeCount,
        teamTotals,
        topEmployees: employeeTotals.slice(0, 5).map((row) => ({
          employeeName: row.employeeName,
          totalHours: row.totalHours
        })),
        forceSummaryRows: forceSummaryRows.slice(0, 5).map((row) => ({
          employeeName: row.employeeName,
          total: row.total,
          lastForced: row.lastForced
        })),
        patrolStaffingRows,
        cidOnCallName
      }),
    [cidOnCallName, employeeTotals, forceSummaryRows, patrolStaffingRows, reportType, teamTotals, totals]
  )

  return (
    <div style={{ display: "grid", gap: "18px" }}>
      <Card>
        <CardContent>
          <div
            style={{
              display: "grid",
              gap: "8px",
              padding: "10px 12px",
              background: "linear-gradient(180deg, #f8fbff 0%, #eef4ff 100%)",
              borderRadius: "16px",
              border: "1px solid #dbeafe"
            }}
          >
            <div style={{ display: "grid", gap: "2px" }}>
              <div style={{ fontSize: "9px", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "#1d4ed8" }}>
                Reports Center
              </div>
              <div style={{ fontSize: "18px", fontWeight: 800, lineHeight: 1.05, color: "#0f172a" }}>
                Reports And Analytics
              </div>
              <div style={{ fontSize: "11px", color: "#475569", lineHeight: 1.3 }}>
                Review overtime, force history, and staffing data with cleaner filters and live totals.
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(115px, 1fr))", gap: "6px" }}>
              {[
                { label: "Report Type", value: reportType, tone: "#1d4ed8", bg: "#eff6ff" },
                { label: "Filtered Hours", value: totals.totalHours.toFixed(1), tone: "#166534", bg: "#ecfdf5" },
                { label: "Employees", value: String(totals.employeeCount), tone: "#7c3aed", bg: "#f5f3ff" },
                { label: "CID On-Call", value: cidOnCallName || "None", tone: "#92400e", bg: "#fffbeb" }
              ].map((card) => (
                <div key={card.label} style={{ border: "1px solid rgba(148, 163, 184, 0.22)", borderRadius: "10px", padding: "7px 9px", background: card.bg, display: "grid", gap: "2px" }}>
                  <div style={{ fontSize: "9px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b" }}>{card.label}</div>
                  <div style={{ fontSize: card.label === "CID On-Call" || card.label === "Report Type" ? "13px" : "18px", lineHeight: 1.05, fontWeight: 800, color: card.tone }}>{card.value}</div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <CardTitle>AI Reporting Assistant</CardTitle>
            <Button data-no-print="true" onClick={() => downloadText("operational-briefing.txt", reportBriefing.text)}>
              Export Briefing
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div style={{ display: "grid", gap: "8px", border: "1px solid #dbeafe", borderRadius: "12px", padding: "12px", background: "#eff6ff" }}>
            <div style={{ fontWeight: 800, color: "#0f172a" }}>{reportBriefing.title}</div>
            <div style={{ fontSize: "13px", color: "#334155" }}>{reportBriefing.summary}</div>
            <div style={{ display: "grid", gap: "4px", fontSize: "12px", color: "#475569" }}>
              {reportBriefing.bullets.map((bullet) => (
                <div key={bullet}>{bullet}</div>
              ))}
            </div>
          </div>
          <div style={{ marginTop: "10px" }}>
            <AiAssistPanel
              title="Live Reporting Analysis"
              feature="Reporting Assistant"
              instruction="Review this report snapshot and provide a concise operational analysis with notable imbalances, fairness concerns, and recommended follow-up."
              context={reportBriefing.text}
            />
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
            <CardTitle>Reports Builder</CardTitle>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <Button data-no-print="true" onClick={exportCurrentReport}>
                Export CSV
              </Button>
              <Button
                data-no-print="true"
                onClick={() => printElementById("reports-print-section", "Reports")}
              >
                Print Reports
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1fr 1fr", gap: "12px" }}>
            <label>
              <div style={{ fontWeight: 700, marginBottom: "4px" }}>Report</div>
              <Select value={reportType} onValueChange={(value) => setReportType(value as ReportType)}>
                <SelectItem value="overtime">Overtime Totals</SelectItem>
                <SelectItem value="team_overtime">Team Overtime</SelectItem>
                <SelectItem value="employee_overtime">Individual Overtime</SelectItem>
                <SelectItem value="detail_hours">Detail Hours</SelectItem>
                <SelectItem value="force_summary">Force Summary</SelectItem>
                <SelectItem value="force_history">Force History</SelectItem>
                <SelectItem value="force_individual">Force By Employee</SelectItem>
                <SelectItem value="cid_on_call">CID On-Call</SelectItem>
                <SelectItem value="patrol_staffing">Patrol Staffing</SelectItem>
              </Select>
            </label>

            <label>
              <div style={{ fontWeight: 700, marginBottom: "4px" }}>Date From</div>
              <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            </label>

            <label>
              <div style={{ fontWeight: 700, marginBottom: "4px" }}>Date To</div>
              <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </label>

            <label>
              <div style={{ fontWeight: 700, marginBottom: "4px" }}>Team</div>
              <Select value={teamFilter} onValueChange={(value) => setTeamFilter(value as Team | "All")}>
                {teamOptions.map((team) => (
                  <SelectItem key={team} value={team}>
                    {team}
                  </SelectItem>
                ))}
              </Select>
            </label>

            <label>
              <div style={{ fontWeight: 700, marginBottom: "4px" }}>Employee</div>
              <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                <SelectItem value="All">All Employees</SelectItem>
                {visibleEmployees.map((employee) => (
                  <SelectItem key={employee.id} value={employee.id}>
                    {employee.firstName} {employee.lastName}
                  </SelectItem>
                ))}
              </Select>
            </label>
          </div>
        </CardContent>
      </Card>

      <div id="reports-print-section" style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: "18px" }}>
        <div style={{ display: "grid", gap: "18px" }}>
          <Card>
            <CardHeader>
              <CardTitle>Overtime Snapshot</CardTitle>
            </CardHeader>

            <CardContent>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "12px" }}>
                <div style={{ border: "1px solid #d8c79d", borderRadius: "14px", padding: "14px", background: "#fffdf7" }}>
                  <div style={{ fontSize: "12px", color: "#7a6640", textTransform: "uppercase", fontWeight: 700 }}>Total OT</div>
                  <div style={{ fontSize: "28px", fontWeight: 800 }}>{totals.totalHours.toFixed(1)}</div>
                </div>
                <div style={{ border: "1px solid #d8c79d", borderRadius: "14px", padding: "14px", background: "#fffdf7" }}>
                  <div style={{ fontSize: "12px", color: "#7a6640", textTransform: "uppercase", fontWeight: 700 }}>Employees</div>
                  <div style={{ fontSize: "28px", fontWeight: 800 }}>{totals.employeeCount}</div>
                </div>
                <div style={{ border: "1px solid #d8c79d", borderRadius: "14px", padding: "14px", background: "#fffdf7" }}>
                  <div style={{ fontSize: "12px", color: "#7a6640", textTransform: "uppercase", fontWeight: 700 }}>Manual OT</div>
                  <div style={{ fontSize: "28px", fontWeight: 800 }}>{totals.manualHours.toFixed(1)}</div>
                </div>
                <div style={{ border: "1px solid #d8c79d", borderRadius: "14px", padding: "14px", background: "#fffdf7" }}>
                  <div style={{ fontSize: "12px", color: "#7a6640", textTransform: "uppercase", fontWeight: 700 }}>Detail Hours</div>
                  <div style={{ fontSize: "28px", fontWeight: 800 }}>{totals.detailHours.toFixed(1)}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {(reportType === "overtime" || reportType === "detail_hours") && (
            <Card>
              <CardHeader>
                <CardTitle>{reportType === "detail_hours" ? "Detail Hours Report" : "Overtime Entry Report"}</CardTitle>
              </CardHeader>

              <CardContent>
                <div style={{ display: "grid", gap: "10px" }}>
                  {filteredOvertime
                    .filter((row) => reportType === "overtime" || row.source === "Detail")
                    .map((row) => (
                      <div
                        key={`${row.source}-${row.id}`}
                        style={{
                          border: "1px solid #e2e8f0",
                          borderRadius: "12px",
                          padding: "12px",
                          background: "#ffffff"
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                          <div style={{ fontWeight: 700 }}>{row.employeeName}</div>
                          <div style={{ fontWeight: 700 }}>{row.hours.toFixed(1)} hrs</div>
                        </div>
                        <div style={{ fontSize: "13px", color: "#475569", marginTop: "6px" }}>
                          {formatDate(row.date)} | {row.team} | {row.reason}
                        </div>
                        <div style={{ fontSize: "12px", color: row.source === "Detail" ? "#1d4ed8" : "#92400e", marginTop: "4px", fontWeight: 700 }}>
                          {row.source}
                        </div>
                      </div>
                    ))}

                  {filteredOvertime.filter((row) => reportType === "overtime" || row.source === "Detail").length === 0 && (
                    <div style={{ fontSize: "13px", color: "#64748b" }}>
                      No rows match the current filters.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {reportType === "team_overtime" && (
            <Card>
              <CardHeader>
                <CardTitle>Team Overtime Totals</CardTitle>
              </CardHeader>

              <CardContent>
                <div style={{ display: "grid", gap: "10px" }}>
                  {teamTotals.map((row) => (
                    <div
                      key={row.team}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "12px",
                        padding: "12px",
                        border: "1px solid #e2e8f0",
                        borderRadius: "12px",
                        background: "#ffffff"
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{row.team}</div>
                      <div style={{ fontWeight: 800 }}>{row.hours.toFixed(1)} hrs</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {reportType === "employee_overtime" && (
            <Card>
              <CardHeader>
                <CardTitle>Individual Overtime Totals</CardTitle>
              </CardHeader>

              <CardContent>
                <div style={{ display: "grid", gap: "10px" }}>
                  {employeeTotals.map((row) => (
                    <div
                      key={row.employeeId}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: "12px",
                        padding: "12px",
                        background: "#ffffff"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                        <div style={{ fontWeight: 700 }}>{row.employeeName}</div>
                        <div style={{ fontWeight: 800 }}>{row.totalHours.toFixed(1)} hrs</div>
                      </div>
                      <div style={{ fontSize: "13px", color: "#475569", marginTop: "6px" }}>
                        {row.team} | Last OT: {formatDate(row.lastDate)} | {row.lastReason}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {reportType === "cid_on_call" && (
            <Card>
              <CardHeader>
                <CardTitle>CID On-Call Report</CardTitle>
              </CardHeader>

              <CardContent>
                <div style={{ border: "1px solid #dbeafe", borderRadius: "14px", padding: "16px", background: "#f8fbff" }}>
                  <div style={{ fontSize: "12px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Current CID On-Call</div>
                  <div style={{ fontSize: "26px", fontWeight: 800, marginTop: "6px" }}>{cidOnCallName}</div>
                </div>
              </CardContent>
            </Card>
          )}

          {reportType === "patrol_staffing" && (
            <Card>
              <CardHeader>
                <CardTitle>Patrol Staffing Summary</CardTitle>
              </CardHeader>

              <CardContent>
                <div style={{ display: "grid", gap: "10px" }}>
                  {patrolStaffingRows.map((row) => (
                    <div
                      key={row.team}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "12px",
                        padding: "12px",
                        border: "1px solid #e2e8f0",
                        borderRadius: "12px",
                        background: "#ffffff"
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{row.team}</div>
                      <div style={{ fontWeight: 800 }}>{row.activeCount} active</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {reportType === "force_summary" && (
            <Card>
              <CardHeader>
                <CardTitle>Force Summary Report</CardTitle>
              </CardHeader>

              <CardContent>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "12px", marginBottom: "14px" }}>
                  <div style={{ border: "1px solid #d8c79d", borderRadius: "14px", padding: "14px", background: "#fffdf7" }}>
                    <div style={{ fontSize: "12px", color: "#7a6640", textTransform: "uppercase", fontWeight: 700 }}>Force Events</div>
                    <div style={{ fontSize: "28px", fontWeight: 800 }}>{filteredForceHistory.length}</div>
                  </div>
                  <div style={{ border: "1px solid #d8c79d", borderRadius: "14px", padding: "14px", background: "#fffdf7" }}>
                    <div style={{ fontSize: "12px", color: "#7a6640", textTransform: "uppercase", fontWeight: 700 }}>Employees Forced</div>
                    <div style={{ fontSize: "28px", fontWeight: 800 }}>{forceSummaryRows.length}</div>
                  </div>
                  <div style={{ border: "1px solid #d8c79d", borderRadius: "14px", padding: "14px", background: "#fffdf7" }}>
                    <div style={{ fontSize: "12px", color: "#7a6640", textTransform: "uppercase", fontWeight: 700 }}>Lowest Team Total</div>
                    <div style={{ fontSize: "28px", fontWeight: 800 }}>
                      {forceTeamTotals[0] ? `${forceTeamTotals[0].team} (${forceTeamTotals[0].total})` : "-"}
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gap: "10px" }}>
                  {forceSummaryRows.map((row) => (
                    <div
                      key={row.employeeId}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "12px",
                        padding: "12px",
                        border: "1px solid #e2e8f0",
                        borderRadius: "12px",
                        background: "#ffffff"
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700 }}>{row.employeeName}</div>
                        <div style={{ fontSize: "13px", color: "#475569" }}>{row.team} | Last forced {formatDate(row.lastForced)}</div>
                      </div>
                      <div style={{ fontWeight: 800 }}>{row.total}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {reportType === "force_history" && (
            <Card>
              <CardHeader>
                <CardTitle>Force History Report</CardTitle>
              </CardHeader>

              <CardContent>
                <div style={{ display: "grid", gap: "10px" }}>
                  {filteredForceHistory.map((row, index) => (
                    <div
                      key={`${row.employee_id}-${row.forced_date}-${index}`}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: "12px",
                        padding: "12px",
                        background: "#ffffff"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                        <div style={{ fontWeight: 700 }}>{row.employeeName}</div>
                        <div style={{ fontWeight: 700 }}>{formatDate(row.forced_date)}</div>
                      </div>
                      <div style={{ fontSize: "13px", color: "#475569", marginTop: "6px" }}>
                        {row.team}
                      </div>
                    </div>
                  ))}

                  {filteredForceHistory.length === 0 && (
                    <div style={{ fontSize: "13px", color: "#64748b" }}>
                      No force history matches the current filters.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {reportType === "force_individual" && (
            <Card>
              <CardHeader>
                <CardTitle>Force By Employee</CardTitle>
              </CardHeader>

              <CardContent>
                <div style={{ display: "grid", gap: "10px" }}>
                  {forceSummaryRows.map((row) => (
                    <div
                      key={row.employeeId}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: "12px",
                        padding: "12px",
                        background: "#ffffff"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                        <div style={{ fontWeight: 700 }}>{row.employeeName}</div>
                        <div style={{ fontWeight: 800 }}>{row.total} forced</div>
                      </div>
                      <div style={{ fontSize: "13px", color: "#475569", marginTop: "6px" }}>
                        {row.team} | Last forced: {formatDate(row.lastForced)}
                      </div>
                    </div>
                  ))}

                  {forceSummaryRows.length === 0 && (
                    <div style={{ fontSize: "13px", color: "#64748b" }}>
                      No employee force totals match the current filters.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div style={{ display: "grid", gap: "18px" }}>
          <Card>
            <CardHeader>
              <CardTitle>Manual Overtime Entry</CardTitle>
            </CardHeader>

            <CardContent>
              <div style={{ display: "grid", gap: "12px" }}>
                <div style={{ fontSize: "13px", color: "#475569" }}>
                  Admins and sergeants can add overtime manually. Accepted detail hours are included automatically in the reports.
                </div>

                <label>
                  <div style={{ fontWeight: 700, marginBottom: "4px" }}>Employee</div>
                  <Select value={draft.employeeId} onValueChange={(value) => updateDraft("employeeId", value)}>
                    <SelectItem value="">Select employee</SelectItem>
                    {employees
                      .slice()
                      .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))
                      .map((employee) => (
                        <SelectItem key={employee.id} value={employee.id}>
                          {employee.firstName} {employee.lastName}
                        </SelectItem>
                      ))}
                  </Select>
                </label>

                <label>
                  <div style={{ fontWeight: 700, marginBottom: "4px" }}>Date</div>
                  <Input type="date" value={draft.date} onChange={(event) => updateDraft("date", event.target.value)} />
                </label>

                <label>
                  <div style={{ fontWeight: 700, marginBottom: "4px" }}>Hours</div>
                  <Input type="number" min="0.5" step="0.5" value={draft.hours} onChange={(event) => updateDraft("hours", event.target.value)} />
                </label>

                <label>
                  <div style={{ fontWeight: 700, marginBottom: "4px" }}>Reason</div>
                  <textarea
                    value={draft.reason}
                    onChange={(event) => updateDraft("reason", event.target.value)}
                    rows={3}
                    style={{ width: "100%", padding: "8px", border: "1px solid #cbd5e1", borderRadius: "8px", resize: "vertical", fontFamily: "inherit" }}
                    placeholder="Court, call-out, event coverage, training overtime"
                  />
                </label>

                {canEdit ? (
                  <Button onClick={addManualOvertimeEntry}>Save Overtime Entry</Button>
                ) : (
                  <div style={{ fontSize: "13px", color: "#64748b" }}>
                    Read-only. Only admins and sergeants can add overtime entries.
                  </div>
                )}

                {message && (
                  <div style={{ border: "1px solid #dbeafe", borderRadius: "10px", padding: "10px", background: "#f8fbff", color: "#475569", fontSize: "13px" }}>
                    {message}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Manual Overtime Log</CardTitle>
            </CardHeader>

            <CardContent>
              <div style={{ display: "grid", gap: "10px" }}>
                {overtimeEntries.length === 0 && (
                  <div style={{ fontSize: "13px", color: "#64748b" }}>
                    No manual overtime entries yet.
                  </div>
                )}

                {overtimeEntries
                  .slice()
                  .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
                  .map((entry) => {
                    const employee = employeeMap.get(entry.employeeId)

                    return (
                      <div
                        key={entry.id}
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
                          <div style={{ fontWeight: 800 }}>{entry.hours.toFixed(1)} hrs</div>
                        </div>

                        <div style={{ fontSize: "13px", color: "#475569", marginTop: "6px" }}>
                          {formatDate(entry.date)} | {entry.reason}
                        </div>

                        {canEdit && (
                          <div style={{ marginTop: "10px" }}>
                            <Button onClick={() => deleteManualOvertimeEntry(entry.id)}>Delete</Button>
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
    </div>
  )
}

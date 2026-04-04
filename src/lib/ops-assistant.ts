import type {
  AuditEvent,
  DetailRecord,
  Employee,
  ForceHistoryRow,
  OvertimeShiftRequest,
  PatrolScheduleRow,
  ReportType
} from "../types"
import type { AppSettings, ReferenceSettings } from "../modules/settings/SettingsPage"
import { buildForceRotationOrder, getEmployeeForceSummary } from "./force-rotation"

export type AssistantInsight = {
  title: string
  tone: "info" | "success" | "warning"
  summary: string
  bullets: string[]
}

export function buildConfigurationAssistantInsights(
  settings: AppSettings,
  referenceSettings: ReferenceSettings
): AssistantInsight[] {
  const insights: AssistantInsight[] = []

  if (!settings.departmentTitle.trim() || settings.departmentTitle.toLowerCase().includes("androscoggin")) {
    insights.push({
      title: "Template Branding",
      tone: "warning",
      summary: "The app is still carrying department-specific branding.",
      bullets: [
        "Update the department title and print header to neutral template names.",
        "Review notification sender names and exported filenames for agency-specific wording."
      ]
    })
  }

  if (referenceSettings.patrolStatuses.length < 8) {
    insights.push({
      title: "Coverage Status Library",
      tone: "info",
      summary: "The patrol status list is still fairly small for a commercial template.",
      bullets: [
        "Add agency-neutral statuses like Holiday, Military, Admin Leave, and Modified Duty.",
        "Make sure each status is meaningful in Patrol, Overtime, and Reports."
      ]
    })
  }

  if (referenceSettings.vehicles.length < 5) {
    insights.push({
      title: "Vehicle Catalog",
      tone: "info",
      summary: "The vehicle list looks light for a reusable deployment.",
      bullets: [
        "Add a broader sample vehicle pool so new departments can start from a template.",
        "Consider a placeholder fleet format like Car 1, Car 2, Unit 7, Supervisor 1."
      ]
    })
  }

  if (referenceSettings.ranks.length < 4 || referenceSettings.teams.length < 4) {
    insights.push({
      title: "Department Configuration",
      tone: "info",
      summary: "Ranks or teams are still tightly tuned to one agency pattern.",
      bullets: [
        "Broaden rank and team defaults for sheriff, police, and corrections style agencies.",
        "Keep module names and team names editable so a new department can self-configure."
      ]
    })
  }

  if (insights.length === 0) {
    insights.push({
      title: "Configuration Health",
      tone: "success",
      summary: "The current settings are in good shape for a configurable template baseline.",
      bullets: [
        "Branding, reference data, and visible modules already look flexible enough to reuse.",
        "Next commercial step is onboarding automation and sample agency presets."
      ]
    })
  }

  return insights
}

export function buildImportCleanupInsights(
  scheduleRows: PatrolScheduleRow[],
  overrideRows: PatrolScheduleRow[],
  unmatchedNames: string[]
): AssistantInsight[] {
  const offRows = scheduleRows.filter((row) => row.status && row.status !== "Scheduled" && row.status !== "Open Shift")
  const replacementRows = scheduleRows.filter((row) => !!row.replacement_employee_id || !!row.replacement_vehicle)
  const insights: AssistantInsight[] = []

  if (unmatchedNames.length > 0) {
    insights.push({
      title: "Unmatched Names",
      tone: "warning",
      summary: `${unmatchedNames.length} imported names still do not match an employee record cleanly.`,
      bullets: unmatchedNames.slice(0, 5).map((name) => `Review imported name mapping for ${name}.`)
    })
  }

  insights.push({
    title: "Import Coverage Review",
    tone: "info",
    summary: `${scheduleRows.length} schedule rows and ${overrideRows.length} live override rows are ready for review.`,
    bullets: [
      `${offRows.length} imported cells are carrying time-off style statuses.`,
      `${replacementRows.length} imported cells already include replacement data.`
    ]
  })

  if (offRows.length === 0) {
    insights.push({
      title: "Time-Off Detection",
      tone: "warning",
      summary: "No time-off rows were detected in the imported workbook.",
      bullets: [
        "If the spreadsheet should contain vacation, sick, or training rows, verify those status codes map correctly.",
        "Check whether the workbook stores off markers in a nonstandard format."
      ]
    })
  }

  return insights
}

export function explainAuditEvent(event: AuditEvent): AssistantInsight {
  const lowered = `${event.action} ${event.summary} ${event.details || ""}`.toLowerCase()
  let impact = "This changed operational data and should be reviewed for downstream queue, staffing, or notification effects."
  let nextStep = "Review the related module to confirm the final state matches the intended change."

  if (lowered.includes("force")) {
    impact = "This affects force rotation fairness and future candidate order."
    nextStep = "Check Force Rotation and Force History together to confirm the queue still reflects the latest history."
  } else if (lowered.includes("patrol")) {
    impact = "This affects the live Patrol board and may also open or close overtime coverage."
    nextStep = "Check Patrol and Overtime together to confirm yellow time off, replacements, and queue entries match."
  } else if (lowered.includes("notification") || lowered.includes("delivery")) {
    impact = "This affects communication history, employee response flow, or provider readiness."
    nextStep = "Check Notifications to verify queued, ready, sent, and failed counts still line up."
  } else if (lowered.includes("detail")) {
    impact = "This affects paid detail tracking and downstream overtime totals."
    nextStep = "Check Detail and Reports to verify accepted hours and movement history."
  }

  return {
    title: "Audit Explanation",
    tone: "info",
    summary: event.summary,
    bullets: [
      `Why it matters: ${impact}`,
      `Operator follow-up: ${nextStep}`,
      `Recorded action: ${event.action} in ${event.module}.`
    ]
  }
}

export function buildReportBriefing(params: {
  reportType: ReportType
  totalHours: number
  employeeCount: number
  teamTotals: Array<{ team: string; hours: number }>
  topEmployees: Array<{ employeeName: string; totalHours: number }>
  forceSummaryRows: Array<{ employeeName: string; total: number; lastForced: string }>
  patrolStaffingRows: Array<{ team: string; activeCount: number }>
  cidOnCallName: string
}) {
  const {
    reportType,
    totalHours,
    employeeCount,
    teamTotals,
    topEmployees,
    forceSummaryRows,
    patrolStaffingRows,
    cidOnCallName
  } = params

  const topTeam = teamTotals[0]
  const topEmployee = topEmployees[0]
  const topForce = forceSummaryRows[0]

  const lines = [
    `Report briefing: ${reportType}`,
    `Total filtered hours: ${totalHours.toFixed(1)}`,
    `Employees represented: ${employeeCount}`,
    topTeam ? `Highest team load: ${topTeam.team} (${topTeam.hours.toFixed(1)} hours)` : "Highest team load: none",
    topEmployee ? `Highest employee load: ${topEmployee.employeeName} (${topEmployee.totalHours.toFixed(1)} hours)` : "Highest employee load: none",
    topForce ? `Lowest force burden candidate: ${topForce.employeeName} (${topForce.total} total)` : "Lowest force burden candidate: none",
    `CID on-call: ${cidOnCallName || "None"}`
  ]

  if (patrolStaffingRows.length > 0) {
    lines.push(`Active patrol teams tracked: ${patrolStaffingRows.map((row) => `${row.team} ${row.activeCount}`).join(" | ")}`)
  }

  return {
    title: "Operational Briefing",
    summary: lines[0],
    bullets: lines.slice(1),
    text: lines.join("\n")
  }
}

export function buildOvertimeFairnessInsight(params: {
  request: OvertimeShiftRequest | null
  employees: Employee[]
  queueIds: string[]
  patrolRows: PatrolScheduleRow[]
  detailRecords: DetailRecord[]
}) {
  const { request, employees, queueIds, patrolRows, detailRecords } = params
  if (!request) {
    return {
      title: "Fairness Recommendation",
      tone: "info" as const,
      summary: "Select a queue shift to see recommended coverage candidates.",
      bullets: [
        "The assistant ranks people by queue position, response interest, and obvious same-day conflicts.",
        "Use it as guidance before manual assign or auto assign."
      ]
    }
  }

  const employeeMap = new Map(employees.map((employee) => [employee.id, employee]))
  const interestedIds = request.responses
    .filter((response) => response.status === "Interested")
    .map((response) => response.employeeId)
  const detailAssignedSet = new Set(
    detailRecords
      .filter((record) => record.status === "Assigned" || record.status === "Accepted")
      .map((record) => `${record.date}-${record.employeeId}`)
  )
  const patrolAssignedSet = new Set(
    patrolRows
      .filter((row) => !!row.employee_id)
      .map((row) => `${row.assignment_date}-${row.employee_id}`)
  )

  const ranked = interestedIds
    .map((employeeId) => {
      const employee = employeeMap.get(employeeId)
      if (!employee) return null
      const queueIndex = queueIds.indexOf(employeeId)
      const sameDayPatrol = patrolAssignedSet.has(`${request.assignmentDate}-${employeeId}`)
      const sameDayDetail = detailAssignedSet.has(`${request.assignmentDate}-${employeeId}`)
      const score =
        (queueIndex >= 0 ? queueIndex : 999) +
        (sameDayPatrol ? 40 : 0) +
        (sameDayDetail ? 25 : 0)

      return {
        employee,
        queueIndex,
        sameDayPatrol,
        sameDayDetail,
        score
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => a.score - b.score)

  if (ranked.length === 0) {
    return {
      title: "Fairness Recommendation",
      tone: "warning" as const,
      summary: "No interested responders are available yet for this queue shift.",
      bullets: [
        "Send or resend the shift notification to collect interest.",
        "If you must fill it now, use the overtime order and same-day staffing context."
      ]
    }
  }

  return {
    title: "Fairness Recommendation",
    tone: "success" as const,
    summary: `${ranked[0].employee.firstName} ${ranked[0].employee.lastName} is the cleanest current candidate for ${request.assignmentDate}.`,
    bullets: ranked.slice(0, 3).map((entry, index) => {
      const reasons = [
        `queue position ${entry.queueIndex >= 0 ? entry.queueIndex + 1 : "off-list"}`,
        entry.sameDayPatrol ? "already scheduled on patrol" : "no patrol conflict",
        entry.sameDayDetail ? "detail conflict" : "no detail conflict"
      ]
      return `${index + 1}. ${entry.employee.firstName} ${entry.employee.lastName}: ${reasons.join(", ")}.`
    })
  }
}

export function buildForceFairnessInsight(employees: Employee[], forceHistory: ForceHistoryRow[]) {
  const forceList = buildForceRotationOrder(employees, forceHistory)
  const topCandidate = forceList[0]

  if (!topCandidate) {
    return {
      title: "Force Recommendation",
      tone: "info" as const,
      summary: "No active force candidates are available right now.",
      bullets: ["Add active employees or review employee status/team assignments."]
    }
  }

  const summary = getEmployeeForceSummary(forceHistory, topCandidate.id)
  return {
    title: "Force Recommendation",
    tone: "success" as const,
    summary: `${topCandidate.firstName} ${topCandidate.lastName} is next based on current force history ordering.`,
    bullets: [
      `Total force entries: ${summary.total}`,
      `Last force: ${summary.last1 === "-" ? "Never" : summary.last1}`,
      `Previous force: ${summary.last2 === "-" ? "Never" : summary.last2}`
    ]
  }
}

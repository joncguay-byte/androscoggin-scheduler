import { useMemo, useState } from "react"
import type { Dispatch, SetStateAction } from "react"

import { Button, Card, CardContent, CardHeader, CardTitle } from "../../components/ui/simple-ui"
import { hasAiAssistantConfig, readAiAssistantConfig, readAiAssistantUsage, requestAiAssistantResponse } from "../../lib/ai-assistant"
import { pushAppToast } from "../../stores/ui-store"
import type {
  AppRole,
  AuditEvent,
  DetailRecord,
  Employee,
  ForceHistoryRow,
  NotificationDelivery,
  OvertimeShiftRequest,
  PatrolScheduleRow
} from "../../types"
import type { AppSettings, ReferenceSettings } from "../settings/SettingsPage"

type ModuleOption = {
  key: string
  label: string
}

type ConfigAction =
  | { type: "set_department_title"; value: string }
  | { type: "set_print_header_title"; value: string }
  | { type: "set_default_layout_variant"; value: AppSettings["defaultLayoutVariant"] }
  | { type: "set_default_patrol_view"; value: AppSettings["defaultPatrolView"] }
  | { type: "set_default_report_type"; value: AppSettings["defaultReportType"] }
  | { type: "set_visible_modules"; modules: string[] }
  | { type: "add_reference"; key: keyof ReferenceSettings; values: string[] }
  | { type: "remove_reference"; key: keyof ReferenceSettings; values: string[] }

type PlannedConfigAction = {
  id: string
  action: ConfigAction
}

type ConfigActionPlan = {
  summary: string
  actions: PlannedConfigAction[]
}

const referenceLabels: Record<keyof ReferenceSettings, string> = {
  vehicles: "Vehicles",
  shiftTemplates: "Shift Templates",
  teams: "Teams",
  ranks: "Ranks",
  patrolStatuses: "Patrol Statuses"
}

const layoutValues: AppSettings["defaultLayoutVariant"][] = ["command-brass", "ops-strip", "clean-ledger"]
const patrolViewValues: AppSettings["defaultPatrolView"][] = ["month", "two_week", "week", "day"]
const reportValues: AppSettings["defaultReportType"][] = [
  "overtime",
  "team_overtime",
  "employee_overtime",
  "detail_hours",
  "force_summary",
  "force_history",
  "force_individual",
  "cid_on_call",
  "patrol_staffing"
]

function extractJsonBlock(text: string) {
  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]) return fencedMatch[1].trim()

  const firstBrace = text.indexOf("{")
  const lastBrace = text.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1)
  }

  return text.trim()
}

function normalizeConfigActionPlan(rawText: string): ConfigActionPlan {
  const parsed = JSON.parse(extractJsonBlock(rawText)) as {
    summary?: string
    actions?: Array<Record<string, unknown>>
  }

  const rawActions = Array.isArray(parsed.actions) ? parsed.actions : []
  const actions = rawActions.reduce<PlannedConfigAction[]>((allActions, rawAction, index) => {
    const type = typeof rawAction.type === "string" ? rawAction.type : ""

    switch (type) {
      case "set_department_title":
      case "set_print_header_title": {
        const value = typeof rawAction.value === "string" ? rawAction.value.trim() : ""
        if (!value) return allActions
        allActions.push({ id: `${type}-${index}`, action: { type, value } })
        return allActions
      }
      case "set_default_layout_variant": {
        const value = typeof rawAction.value === "string" ? rawAction.value : ""
        if (!layoutValues.includes(value as AppSettings["defaultLayoutVariant"])) return allActions
        allActions.push({ id: `${type}-${index}`, action: { type, value: value as AppSettings["defaultLayoutVariant"] } })
        return allActions
      }
      case "set_default_patrol_view": {
        const value = typeof rawAction.value === "string" ? rawAction.value : ""
        if (!patrolViewValues.includes(value as AppSettings["defaultPatrolView"])) return allActions
        allActions.push({ id: `${type}-${index}`, action: { type, value: value as AppSettings["defaultPatrolView"] } })
        return allActions
      }
      case "set_default_report_type": {
        const value = typeof rawAction.value === "string" ? rawAction.value : ""
        if (!reportValues.includes(value as AppSettings["defaultReportType"])) return allActions
        allActions.push({ id: `${type}-${index}`, action: { type, value: value as AppSettings["defaultReportType"] } })
        return allActions
      }
      case "set_visible_modules": {
        const modules = Array.isArray(rawAction.modules)
          ? rawAction.modules.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          : []
        if (modules.length === 0) return allActions
        allActions.push({ id: `${type}-${index}`, action: { type, modules } })
        return allActions
      }
      case "add_reference":
      case "remove_reference": {
        const key = typeof rawAction.key === "string" ? rawAction.key : ""
        const values = Array.isArray(rawAction.values)
          ? rawAction.values.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          : []
        if (!["vehicles", "shiftTemplates", "teams", "ranks", "patrolStatuses"].includes(key) || values.length === 0) return allActions
        allActions.push({ id: `${type}-${index}`, action: { type, key: key as keyof ReferenceSettings, values } })
        return allActions
      }
      default:
        return allActions
    }
  }, [])

  if (actions.length === 0) {
    throw new Error("The AI did not return any usable configuration actions.")
  }

  return {
    summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : "AI generated a configuration action plan.",
    actions
  }
}

function describeConfigAction(action: ConfigAction) {
  switch (action.type) {
    case "set_department_title":
      return `Set Department Title to "${action.value}".`
    case "set_print_header_title":
      return `Set Print Header Title to "${action.value}".`
    case "set_default_layout_variant":
      return `Set default layout variant to "${action.value}".`
    case "set_default_patrol_view":
      return `Set default Patrol view to "${action.value}".`
    case "set_default_report_type":
      return `Set default report type to "${action.value}".`
    case "set_visible_modules":
      return `Replace visible modules with: ${action.modules.join(", ")}.`
    case "add_reference":
      return `Add to ${referenceLabels[action.key]}: ${action.values.join(", ")}.`
    case "remove_reference":
      return `Remove from ${referenceLabels[action.key]}: ${action.values.join(", ")}.`
  }
}

type AiAssistantPageProps = {
  currentUserRole: AppRole
  employees: Employee[]
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  referenceSettings: ReferenceSettings
  setReferenceSettings: Dispatch<SetStateAction<ReferenceSettings>>
  moduleOptions: ModuleOption[]
  patrolRows: PatrolScheduleRow[]
  overtimeShiftRequests: OvertimeShiftRequest[]
  detailRecords: DetailRecord[]
  forceHistory: ForceHistoryRow[]
  notificationDeliveries: NotificationDelivery[]
  auditEvents: AuditEvent[]
  onAuditEvent?: (action: string, summary: string, details?: string) => void
}

const starterQuestions = [
  "What should I fix first to make this scheduler more commercially reusable?",
  "Which overtime shifts look hardest to fill fairly right now?",
  "What staffing risks stand out over the next few days?",
  "What reports or exports should I add next to increase the app's value?",
  "What cleanup should I do before selling this as a template?"
]

export function AiAssistantPage({
  currentUserRole,
  employees,
  settings,
  setSettings,
  referenceSettings,
  setReferenceSettings,
  moduleOptions,
  patrolRows,
  overtimeShiftRequests,
  detailRecords,
  forceHistory,
  notificationDeliveries,
  auditEvents,
  onAuditEvent
}: AiAssistantPageProps) {
  const [question, setQuestion] = useState("")
  const [loading, setLoading] = useState(false)
  const [answer, setAnswer] = useState("")
  const [lastAsked, setLastAsked] = useState("")
  const [aiActionPrompt, setAiActionPrompt] = useState("")
  const [aiActionPlan, setAiActionPlan] = useState<ConfigActionPlan | null>(null)
  const [selectedActionIds, setSelectedActionIds] = useState<string[]>([])
  const [aiActionLoading, setAiActionLoading] = useState(false)

  const aiConfig = readAiAssistantConfig()
  const aiUsage = readAiAssistantUsage()
  const configReady = hasAiAssistantConfig(aiConfig)

  const openOvertimeShifts = useMemo(
    () => overtimeShiftRequests.filter((request) => request.status === "Open"),
    [overtimeShiftRequests]
  )
  const assignedOvertimeShifts = useMemo(
    () => overtimeShiftRequests.filter((request) => request.status === "Assigned"),
    [overtimeShiftRequests]
  )
  const activeEmployees = useMemo(
    () => employees.filter((employee) => employee.status === "Active"),
    [employees]
  )
  const recentAuditEvents = useMemo(
    () => auditEvents.slice(-6).reverse(),
    [auditEvents]
  )

  const context = useMemo(() => {
    const employeeMap = new Map(employees.map((employee) => [employee.id, employee]))
    const patrolOffRows = patrolRows
      .filter((row) => row.status && row.status !== "Scheduled" && row.status !== "Open Shift")
      .slice(0, 12)
      .map((row) => ({
        assignmentDate: row.assignment_date,
        shiftType: row.shift_type,
        positionCode: row.position_code,
        status: row.status,
        employee:
          row.employee_id && employeeMap.has(row.employee_id)
            ? `${employeeMap.get(row.employee_id)?.firstName} ${employeeMap.get(row.employee_id)?.lastName}`
            : "Unassigned",
        replacement:
          row.replacement_employee_id && employeeMap.has(row.replacement_employee_id)
            ? `${employeeMap.get(row.replacement_employee_id)?.firstName} ${employeeMap.get(row.replacement_employee_id)?.lastName}`
            : row.replacement_vehicle || null
      }))

    const openQueueSummary = openOvertimeShifts.slice(0, 10).map((request) => ({
      date: request.assignmentDate,
      description: request.description,
      offEmployee: request.offEmployeeLastName || "Open",
      interestedCount: request.responses.filter((response) => response.status === "Interested").length,
      assignedEmployee:
        request.assignedEmployeeId && employeeMap.has(request.assignedEmployeeId)
          ? `${employeeMap.get(request.assignedEmployeeId)?.firstName} ${employeeMap.get(request.assignedEmployeeId)?.lastName}`
          : null
    }))

    const forceSummary = activeEmployees.slice(0, 10).map((employee) => {
      const employeeHistory = forceHistory
        .filter((entry) => entry.employee_id === employee.id)
        .sort((a, b) => b.forced_date.localeCompare(a.forced_date))
      return {
        employee: `${employee.firstName} ${employee.lastName}`,
        totalForces: employeeHistory.length,
        lastForce: employeeHistory[0]?.forced_date || null
      }
    })

    return JSON.stringify(
      {
        role: currentUserRole,
        branding: {
          departmentTitle: settings.departmentTitle,
          printHeaderTitle: settings.printHeaderTitle
        },
        modules: settings.visibleModules,
        referenceCounts: {
          vehicles: referenceSettings.vehicles.length,
          teams: referenceSettings.teams.length,
          ranks: referenceSettings.ranks.length,
          patrolStatuses: referenceSettings.patrolStatuses.length,
          shiftTemplates: referenceSettings.shiftTemplates.length
        },
        staffing: {
          activeEmployees: activeEmployees.length,
          patrolRowsLoaded: patrolRows.length,
          patrolTimeOffSample: patrolOffRows
        },
        overtime: {
          openRequests: openOvertimeShifts.length,
          assignedRequests: assignedOvertimeShifts.length,
          queueSample: openQueueSummary
        },
        detail: {
          records: detailRecords.length,
          assignedOrAccepted: detailRecords.filter((record) => record.status !== "Refused").length
        },
        force: {
          historyEntries: forceHistory.length,
          sample: forceSummary
        },
        notifications: {
          deliveries: notificationDeliveries.length,
          sent: notificationDeliveries.filter((delivery) => delivery.status === "sent").length,
          failed: notificationDeliveries.filter((delivery) => delivery.status === "failed").length
        },
        audit: recentAuditEvents.map((event) => ({
          module: event.module,
          action: event.action,
          summary: event.summary,
          createdAt: event.createdAt
        }))
      },
      null,
      2
    )
  }, [
    activeEmployees,
    assignedOvertimeShifts.length,
    auditEvents,
    currentUserRole,
    detailRecords,
    employees,
    forceHistory,
    notificationDeliveries,
    openOvertimeShifts,
    patrolRows,
    recentAuditEvents,
    referenceSettings,
    settings.departmentTitle,
    settings.printHeaderTitle,
    settings.visibleModules
  ])

  async function handleGenerateActionPlan() {
    const trimmedPrompt = aiActionPrompt.trim()
    if (!trimmedPrompt) {
      pushAppToast({
        tone: "warning",
        title: "Request needed",
        message: "Describe the configuration change you want AI to prepare."
      })
      return
    }

    setAiActionLoading(true)

    try {
      const response = await requestAiAssistantResponse({
        feature: "AI Assistant Configuration Actions",
        instruction: [
          "Turn the admin request into a JSON-only scheduler configuration action plan.",
          "Return only valid JSON.",
          'Use this shape: {"summary":"...","actions":[...]}',
          'Allowed actions: set_department_title, set_print_header_title, set_default_layout_variant, set_default_patrol_view, set_default_report_type, set_visible_modules, add_reference, remove_reference.',
          'For add_reference/remove_reference use keys: vehicles, shiftTemplates, teams, ranks, patrolStatuses.',
          "Do not include explanations outside JSON.",
          `Admin request: ${trimmedPrompt}`
        ].join("\n"),
        context: JSON.stringify({
          settings,
          referenceSettings,
          availableModules: moduleOptions
        }, null, 2)
      })

      const normalizedPlan = normalizeConfigActionPlan(response)
      setAiActionPlan(normalizedPlan)
      setSelectedActionIds(normalizedPlan.actions.map((action) => action.id))
      pushAppToast({
        tone: "success",
        title: "AI plan ready",
        message: `Prepared ${normalizedPlan.actions.length} configuration changes for review.`
      })
    } catch (error) {
      pushAppToast({
        tone: "error",
        title: "AI planning failed",
        message: error instanceof Error ? error.message : "Could not generate a configuration action plan."
      })
    } finally {
      setAiActionLoading(false)
    }
  }

  function applySelectedAiActions() {
    if (!aiActionPlan) return

    const plannedActions = aiActionPlan.actions.filter((planned) => selectedActionIds.includes(planned.id))
    if (plannedActions.length === 0) {
      pushAppToast({
        tone: "warning",
        title: "Nothing selected",
        message: "Select at least one AI-proposed configuration change to apply."
      })
      return
    }

    const nextSettings: AppSettings = {
      ...settings,
      visibleModules: [...settings.visibleModules]
    }
    const nextReferenceSettings: ReferenceSettings = {
      vehicles: [...referenceSettings.vehicles],
      shiftTemplates: [...referenceSettings.shiftTemplates],
      teams: [...referenceSettings.teams],
      ranks: [...referenceSettings.ranks],
      patrolStatuses: [...referenceSettings.patrolStatuses]
    }

    plannedActions.forEach(({ action }) => {
      switch (action.type) {
        case "set_department_title":
          nextSettings.departmentTitle = action.value
          break
        case "set_print_header_title":
          nextSettings.printHeaderTitle = action.value
          break
        case "set_default_layout_variant":
          nextSettings.defaultLayoutVariant = action.value
          break
        case "set_default_patrol_view":
          nextSettings.defaultPatrolView = action.value
          break
        case "set_default_report_type":
          nextSettings.defaultReportType = action.value
          break
        case "set_visible_modules":
          nextSettings.visibleModules = [...new Set([...action.modules, "settings", "ai", "overtime", "notifications"])]
          break
        case "add_reference":
          nextReferenceSettings[action.key] = [...new Set([...nextReferenceSettings[action.key], ...action.values])]
          break
        case "remove_reference":
          nextReferenceSettings[action.key] = nextReferenceSettings[action.key].filter((value) => !action.values.includes(value))
          break
      }
    })

    setSettings(nextSettings)
    setReferenceSettings(nextReferenceSettings)
    onAuditEvent?.(
      "AI Configuration Actions Applied",
      `Applied ${plannedActions.length} AI-approved configuration changes from the AI Assistant module.`,
      plannedActions.map(({ action }) => describeConfigAction(action)).join(" | ")
    )
    pushAppToast({
      tone: "success",
      title: "AI changes applied",
      message: `Applied ${plannedActions.length} approved configuration changes.`
    })
    setAiActionPlan(null)
    setSelectedActionIds([])
  }

  async function handleAsk(promptText: string) {
    const trimmedQuestion = promptText.trim()
    if (!trimmedQuestion) {
      pushAppToast({
        tone: "warning",
        title: "Question needed",
        message: "Type a question for the AI assistant first."
      })
      return
    }

    setLoading(true)
    setLastAsked(trimmedQuestion)
    setAnswer("")

    try {
      const text = await requestAiAssistantResponse({
        feature: "AI Assistant Module",
        instruction: trimmedQuestion,
        context
      })
      setAnswer(text)
      pushAppToast({
        tone: "success",
        title: "AI answer ready",
        message: "The scheduler assistant returned a live answer."
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI request failed."
      setAnswer(message)
      pushAppToast({
        tone: "error",
        title: "AI request failed",
        message
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: "grid", gap: "18px" }}>
      <Card>
        <CardHeader>
          <CardTitle>AI Assistant</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ display: "grid", gap: "16px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "12px" }}>
              {[
                { label: "Config", value: configReady ? "Ready" : "Needs setup" },
                { label: "Monthly Usage", value: `${aiUsage.calls}/${aiConfig.maxCallsPerMonth}` },
                { label: "Context Limit", value: `${aiConfig.maxContextChars.toLocaleString()} chars` },
                { label: "Model", value: aiConfig.model }
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    border: "1px solid #dbeafe",
                    borderRadius: "14px",
                    padding: "12px",
                    background: "#f8fbff"
                  }}
                >
                  <div style={{ fontSize: "11px", textTransform: "uppercase", color: "#64748b", fontWeight: 700 }}>
                    {item.label}
                  </div>
                  <div style={{ marginTop: "6px", fontSize: "14px", fontWeight: 800, color: "#0f172a" }}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ fontSize: "13px", color: "#475569" }}>
              Ask anything about this scheduler. The assistant uses live app context from staffing, overtime, force, detail, notifications, settings, and audit activity.
            </div>

            <div
              style={{
                border: "1px solid #dbeafe",
                borderRadius: "16px",
                padding: "16px",
                background: "#f8fbff",
                display: "grid",
                gap: "12px"
              }}
            >
              <div style={{ fontWeight: 800, color: "#0f172a" }}>AI Configuration Actions</div>
              <div style={{ fontSize: "13px", color: "#475569" }}>
                Ask AI to prepare safe settings changes, review the plan, then approve exactly what should be applied.
              </div>
              <textarea
                value={aiActionPrompt}
                onChange={(event) => setAiActionPrompt(event.target.value)}
                placeholder="Example: Rename the app for a commercial template, add Police Officer and Lieutenant to ranks, and hide Audit from the default visible modules."
                style={{
                  width: "100%",
                  minHeight: "100px",
                  padding: "12px 14px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "12px",
                  resize: "vertical",
                  boxSizing: "border-box"
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", flexWrap: "wrap" }}>
                <Button
                  onClick={() => {
                    setAiActionPrompt("")
                    setAiActionPlan(null)
                    setSelectedActionIds([])
                  }}
                  disabled={aiActionLoading}
                >
                  Clear
                </Button>
                <Button onClick={() => void handleGenerateActionPlan()} disabled={aiActionLoading}>
                  {aiActionLoading ? "Planning..." : "Generate Action Plan"}
                </Button>
              </div>

              {aiActionPlan && (
                <div style={{ display: "grid", gap: "10px" }}>
                  <div style={{ fontSize: "13px", color: "#334155" }}>{aiActionPlan.summary}</div>
                  {aiActionPlan.actions.map((planned) => {
                    const checked = selectedActionIds.includes(planned.id)
                    return (
                      <label
                        key={planned.id}
                        style={{
                          display: "flex",
                          gap: "10px",
                          alignItems: "start",
                          border: "1px solid #dbeafe",
                          borderRadius: "12px",
                          padding: "10px 12px",
                          background: checked ? "#eff6ff" : "#ffffff"
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            setSelectedActionIds((current) =>
                              event.target.checked
                                ? [...new Set([...current, planned.id])]
                                : current.filter((id) => id !== planned.id)
                            )
                          }
                        />
                        <div style={{ display: "grid", gap: "4px" }}>
                          <div style={{ fontWeight: 700, color: "#0f172a" }}>{describeConfigAction(planned.action)}</div>
                          <div style={{ fontSize: "12px", color: "#64748b" }}>{planned.action.type}</div>
                        </div>
                      </label>
                    )
                  })}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", flexWrap: "wrap" }}>
                    <Button onClick={() => setSelectedActionIds(aiActionPlan.actions.map((planned) => planned.id))}>
                      Select All
                    </Button>
                    <Button onClick={() => setSelectedActionIds([])}>
                      Clear Selection
                    </Button>
                    <Button onClick={() => applySelectedAiActions()}>
                      Apply Selected Changes
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "grid", gap: "10px" }}>
              <div style={{ fontWeight: 700, color: "#0f172a" }}>Try one of these</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {starterQuestions.map((starter) => (
                  <Button
                    key={starter}
                    onClick={() => {
                      setQuestion(starter)
                      void handleAsk(starter)
                    }}
                    disabled={loading}
                    style={{ textAlign: "left" }}
                  >
                    {starter}
                  </Button>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gap: "8px" }}>
              <div style={{ fontWeight: 700, color: "#0f172a" }}>Ask your own question</div>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Example: Which overtime rules should I standardize before selling this product?"
                style={{
                  width: "100%",
                  minHeight: "120px",
                  padding: "12px 14px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "12px",
                  resize: "vertical",
                  boxSizing: "border-box"
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ fontSize: "12px", color: "#64748b" }}>
                  Current live context size: {context.length.toLocaleString()} characters
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <Button
                    onClick={() => {
                      setQuestion("")
                      setAnswer("")
                      setLastAsked("")
                    }}
                    disabled={loading}
                  >
                    Clear
                  </Button>
                  <Button onClick={() => void handleAsk(question)} disabled={loading}>
                    {loading ? "Thinking..." : "Ask AI"}
                  </Button>
                </div>
              </div>
            </div>

            <div
              style={{
                border: "1px solid #dbeafe",
                borderRadius: "16px",
                padding: "16px",
                background: "#f8fbff",
                minHeight: "220px"
              }}
            >
              <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: "8px" }}>
                {lastAsked ? "Assistant Response" : "Ready For Questions"}
              </div>
              {lastAsked && (
                <div style={{ fontSize: "12px", color: "#475569", marginBottom: "12px" }}>
                  Last question: {lastAsked}
                </div>
              )}
              <div style={{ whiteSpace: "pre-wrap", fontSize: "13px", lineHeight: 1.55, color: "#334155" }}>
                {answer || "Ask a question above and the live assistant will answer here."}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "12px" }}>
              {[
                {
                  title: "Best For",
                  bullets: [
                    "Commercial template decisions",
                    "Overtime fairness questions",
                    "Operational next-step guidance"
                  ]
                },
                {
                  title: "Keep Costs Low",
                  bullets: [
                    "Ask specific questions",
                    "Avoid giant dumps when possible",
                    "Use the monthly cap in Settings"
                  ]
                },
                {
                  title: "Still Better Elsewhere",
                  bullets: [
                    "Module-specific Explain buttons for audit",
                    "Reports exports for hard data",
                    "Settings for actual config edits"
                  ]
                }
              ].map((section) => (
                <div
                  key={section.title}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: "14px",
                    padding: "12px",
                    background: "#ffffff"
                  }}
                >
                  <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: "8px" }}>{section.title}</div>
                  <div style={{ display: "grid", gap: "4px", fontSize: "12px", color: "#475569" }}>
                    {section.bullets.map((bullet) => (
                      <div key={bullet}>{bullet}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

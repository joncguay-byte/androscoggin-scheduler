import { useMemo, useState } from "react"

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

type AiAssistantPageProps = {
  currentUserRole: AppRole
  employees: Employee[]
  settings: AppSettings
  referenceSettings: ReferenceSettings
  patrolRows: PatrolScheduleRow[]
  overtimeShiftRequests: OvertimeShiftRequest[]
  detailRecords: DetailRecord[]
  forceHistory: ForceHistoryRow[]
  notificationDeliveries: NotificationDelivery[]
  auditEvents: AuditEvent[]
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
  referenceSettings,
  patrolRows,
  overtimeShiftRequests,
  detailRecords,
  forceHistory,
  notificationDeliveries,
  auditEvents
}: AiAssistantPageProps) {
  const [question, setQuestion] = useState("")
  const [loading, setLoading] = useState(false)
  const [answer, setAnswer] = useState("")
  const [lastAsked, setLastAsked] = useState("")

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

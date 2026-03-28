import { useEffect, useMemo, useRef, useState } from "react"

import { buildDeliveryLink, buildEmailHtmlPreview, buildNotificationDeliveries, canSendDeliveryLive, formatNotificationShiftSummary, sendNotificationDelivery } from "../../lib/notifications"
import { supabase } from "../../lib/supabase"
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Select, SelectItem } from "../../components/ui/simple-ui"
import type {
  AppRole,
  Employee,
  NotificationCampaign,
  NotificationChannel,
  NotificationDelivery,
  NotificationProviderConfig,
  NotificationPreference,
  OvertimeAvailabilityStatus,
  OvertimeShiftRequest
} from "../../types"

type RecipientScope =
  | "all"
  | "patrol"
  | "days_a"
  | "days_b"
  | "nights_a"
  | "nights_b"
  | "supervisors"
  | "deputies"

type NotificationsPageProps = {
  currentUserRole: AppRole
  employees: Employee[]
  overtimeShiftRequests: OvertimeShiftRequest[]
  setOvertimeShiftRequests: React.Dispatch<React.SetStateAction<OvertimeShiftRequest[]>>
  notificationPreferences: NotificationPreference[]
  setNotificationPreferences: React.Dispatch<React.SetStateAction<NotificationPreference[]>>
  notificationCampaigns: NotificationCampaign[]
  setNotificationCampaigns: React.Dispatch<React.SetStateAction<NotificationCampaign[]>>
  notificationDeliveries: NotificationDelivery[]
  setNotificationDeliveries: React.Dispatch<React.SetStateAction<NotificationDelivery[]>>
  notificationProviderConfig: NotificationProviderConfig
  setNotificationProviderConfig: React.Dispatch<React.SetStateAction<NotificationProviderConfig>>
  initialSelectedShiftIds?: string[]
  initialSelectedRecipientIds?: string[]
  onConsumeDraftSelections?: () => void
  onAuditEvent: (action: string, summary: string, details?: string) => void
}

const PROVIDER_CONFIG_DRAFT_STORAGE_KEY = "androscoggin-notification-provider-config-draft"

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "numeric"
  })
}

function toggleSelection(list: string[], value: string) {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]
}

function getStatusColor(status: NotificationDelivery["status"]) {
  switch (status) {
    case "sent":
      return { background: "#ecfdf5", color: "#166534", border: "#bbf7d0" }
    case "failed":
      return { background: "#fff1f2", color: "#be123c", border: "#fecdd3" }
    case "ready":
      return { background: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" }
    default:
      return { background: "#f8fafc", color: "#475569", border: "#cbd5e1" }
  }
}

export function NotificationsPage({
  currentUserRole,
  employees,
  overtimeShiftRequests,
  setOvertimeShiftRequests,
  notificationPreferences,
  setNotificationPreferences,
  notificationCampaigns,
  setNotificationCampaigns,
  notificationDeliveries,
  setNotificationDeliveries,
  notificationProviderConfig,
  setNotificationProviderConfig,
  initialSelectedShiftIds = [],
  initialSelectedRecipientIds = [],
  onConsumeDraftSelections,
  onAuditEvent
}: NotificationsPageProps) {
  const canEdit = currentUserRole === "admin" || currentUserRole === "sergeant"
  const providerConfigSaveTimeoutRef = useRef<number | null>(null)
  const [providerConfigDraft, setProviderConfigDraft] = useState<NotificationProviderConfig>(() => {
    if (typeof window === "undefined") return notificationProviderConfig

    try {
      const raw = window.localStorage.getItem(PROVIDER_CONFIG_DRAFT_STORAGE_KEY)
      return raw ? JSON.parse(raw) as NotificationProviderConfig : notificationProviderConfig
    } catch {
      return notificationProviderConfig
    }
  })
  const activeEmployees = useMemo(
    () => employees.filter((employee) => employee.status === "Active").sort((a, b) => a.lastName.localeCompare(b.lastName)),
    [employees]
  )

  useEffect(() => {
    if (activeEmployees.length === 0 || notificationPreferences.length > 0) return

    setNotificationPreferences(
      activeEmployees.map((employee) => ({
        employeeId: employee.id,
        emailAddress: "",
        phoneNumber: "",
        allowEmail: true,
        allowText: false,
        overtimeAvailability: true,
        overtimeAssignment: true,
        patrolUpdates: false,
        forceUpdates: false,
        detailUpdates: false
      }))
    )
  }, [activeEmployees, notificationPreferences.length, setNotificationPreferences])

  const employeeMap = useMemo(() => new Map(activeEmployees.map((employee) => [employee.id, employee])), [activeEmployees])
  const preferenceMap = useMemo(() => new Map(notificationPreferences.map((entry) => [entry.employeeId, entry])), [notificationPreferences])
  const requestMap = useMemo(() => new Map(overtimeShiftRequests.map((request) => [request.id, request])), [overtimeShiftRequests])

  const [campaignTitle, setCampaignTitle] = useState("Overtime Availability")
  const [campaignChannel, setCampaignChannel] = useState<NotificationChannel>("email")
  const [selectedShiftIds, setSelectedShiftIds] = useState<string[]>([])
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([])
  const [recipientScope, setRecipientScope] = useState<RecipientScope>("patrol")
  const [selectedCampaignId, setSelectedCampaignId] = useState("")
  const [selectedDeliveryId, setSelectedDeliveryId] = useState("")

  useEffect(() => {
    const hasDraftValue =
      providerConfigDraft.emailWebhookUrl.trim().length > 0 ||
      providerConfigDraft.textWebhookUrl.trim().length > 0 ||
      providerConfigDraft.authToken.trim().length > 0 ||
      providerConfigDraft.senderEmail.trim().length > 0 ||
      providerConfigDraft.senderPhone.trim().length > 0

    const hasPropValue =
      notificationProviderConfig.emailWebhookUrl.trim().length > 0 ||
      notificationProviderConfig.textWebhookUrl.trim().length > 0 ||
      notificationProviderConfig.authToken.trim().length > 0 ||
      notificationProviderConfig.senderEmail.trim().length > 0 ||
      notificationProviderConfig.senderPhone.trim().length > 0

    if (hasPropValue) {
      setProviderConfigDraft(notificationProviderConfig)
      return
    }

    if (hasDraftValue) {
      setNotificationProviderConfig(providerConfigDraft)
    }
  }, [notificationProviderConfig, providerConfigDraft, setNotificationProviderConfig])

  useEffect(() => {
    if (initialSelectedShiftIds.length === 0) return
    setSelectedShiftIds(initialSelectedShiftIds)
    onConsumeDraftSelections?.()
  }, [initialSelectedShiftIds, onConsumeDraftSelections])

  useEffect(() => {
    if (initialSelectedRecipientIds.length === 0) return
    setSelectedRecipientIds(initialSelectedRecipientIds)
    onConsumeDraftSelections?.()
  }, [initialSelectedRecipientIds, onConsumeDraftSelections])

  useEffect(() => {
    if (selectedDeliveryId && notificationDeliveries.some((delivery) => delivery.id === selectedDeliveryId)) return
    if (notificationDeliveries[0]) {
      setSelectedDeliveryId(notificationDeliveries[0].id)
      return
    }
    if (selectedDeliveryId) {
      setSelectedDeliveryId("")
    }
  }, [notificationDeliveries, selectedDeliveryId])

  useEffect(() => {
    if (selectedCampaignId && notificationCampaigns.some((campaign) => campaign.id === selectedCampaignId)) return
    if (notificationCampaigns[0]) {
      setSelectedCampaignId(notificationCampaigns[0].id)
      return
    }
    if (selectedCampaignId) {
      setSelectedCampaignId("")
    }
  }, [notificationCampaigns, selectedCampaignId])

  const openShiftRequests = useMemo(
    () => overtimeShiftRequests.filter((request) => request.status === "Open").sort((a, b) => a.assignmentDate.localeCompare(b.assignmentDate) || a.shiftType.localeCompare(b.shiftType)),
    [overtimeShiftRequests]
  )
  const assignmentNotices = useMemo(
    () => overtimeShiftRequests.filter((request) => request.assignedEmployeeId).sort((a, b) => b.assignmentDate.localeCompare(a.assignmentDate)),
    [overtimeShiftRequests]
  )
  const filteredRecipients = useMemo(
    () =>
      notificationPreferences.filter((preference) => {
        const employee = employeeMap.get(preference.employeeId)
        if (!employee) return false

        const inScope = (() => {
          switch (recipientScope) {
            case "all":
              return true
            case "patrol":
              return ["Days A", "Days B", "Nights A", "Nights B"].includes(employee.team)
            case "days_a":
              return employee.team === "Days A"
            case "days_b":
              return employee.team === "Days B"
            case "nights_a":
              return employee.team === "Nights A"
            case "nights_b":
              return employee.team === "Nights B"
            case "supervisors":
              return employee.rank === "Sgt" || employee.rank === "Cpl"
            case "deputies":
              return employee.rank === "Deputy" || employee.rank === "Poland Deputy"
            default:
              return true
          }
        })()

        if (!inScope) return false
        if (campaignChannel === "email") return preference.allowEmail && preference.emailAddress.trim().length > 0
        if (campaignChannel === "text") return preference.allowText && preference.phoneNumber.trim().length > 0
        return (preference.allowEmail && preference.emailAddress.trim().length > 0) || (preference.allowText && preference.phoneNumber.trim().length > 0)
      }),
    [campaignChannel, employeeMap, notificationPreferences, recipientScope]
  )

  const selectedCampaign = notificationCampaigns.find((campaign) => campaign.id === selectedCampaignId) || null
  const selectedDelivery = notificationDeliveries.find((delivery) => delivery.id === selectedDeliveryId) || notificationDeliveries[0] || null
  const activeDeliveryCampaign = selectedDelivery ? notificationCampaigns.find((campaign) => campaign.id === selectedDelivery.campaignId) || null : null
  const selectedDeliveryResponseLink = selectedDelivery?.responseToken ? buildDeliveryLink(selectedDelivery) : ""
  const selectedDeliveryEmailHtml = selectedDelivery?.channel === "email"
    ? buildEmailHtmlPreview(selectedDelivery, {
        senderName: notificationProviderConfig.senderName,
        responseLink: selectedDeliveryResponseLink
      })
    : ""
  const responseTargetShift = selectedCampaign?.shiftRequestIds[0]
    ? overtimeShiftRequests.find((request) => request.id === selectedCampaign.shiftRequestIds[0]) || null
    : openShiftRequests[0] || null

  const deliverySummary = useMemo(() => ({
    queued: notificationDeliveries.filter((delivery) => delivery.status === "queued").length,
    ready: notificationDeliveries.filter((delivery) => delivery.status === "ready").length,
    sent: notificationDeliveries.filter((delivery) => delivery.status === "sent").length,
    failed: notificationDeliveries.filter((delivery) => delivery.status === "failed").length
  }), [notificationDeliveries])

  function updatePreference(employeeId: string, patch: Partial<NotificationPreference>) {
    setNotificationPreferences((current) => current.map((entry) => (entry.employeeId === employeeId ? { ...entry, ...patch } : entry)))
  }

  function updateProviderConfig(patch: Partial<NotificationProviderConfig>) {
    setProviderConfigDraft((current) => {
      const next = { ...current, ...patch }
      setNotificationProviderConfig(next)

      if (typeof window !== "undefined") {
        window.localStorage.setItem(PROVIDER_CONFIG_DRAFT_STORAGE_KEY, JSON.stringify(next))
      }

      if (providerConfigSaveTimeoutRef.current) {
        window.clearTimeout(providerConfigSaveTimeoutRef.current)
      }

      providerConfigSaveTimeoutRef.current = window.setTimeout(() => {
        void supabase
          .from("notification_provider_config")
          .upsert({
            config_key: "default",
            mode: next.mode,
            email_webhook_url: next.emailWebhookUrl,
            text_webhook_url: next.textWebhookUrl,
            auth_token: next.authToken,
            sender_name: next.senderName,
            sender_email: next.senderEmail,
            sender_phone: next.senderPhone,
            updated_at: new Date().toISOString()
          }, { onConflict: "config_key" })
      }, 150)

      return next
    })
  }

  useEffect(() => {
    return () => {
      if (providerConfigSaveTimeoutRef.current) {
        window.clearTimeout(providerConfigSaveTimeoutRef.current)
      }
    }
  }, [])

  function createCampaign(
    type: NotificationCampaign["type"],
    title: string,
    channel: NotificationChannel,
    recipientIds: string[],
    shiftRequestIds: string[],
    notes?: string
  ) {
    const campaign: NotificationCampaign = {
      id: crypto.randomUUID(),
      title,
      type,
      channel,
      recipientIds,
      shiftRequestIds,
      status: "sent",
      createdAt: new Date().toISOString(),
      sentAt: new Date().toISOString(),
      notes: notes || null
    }
    const { deliveries, skipped } = buildNotificationDeliveries({
      campaign,
      recipients: recipientIds,
      employeeMap,
      preferencesMap: preferenceMap,
      shiftMap: requestMap
    })
    setNotificationCampaigns((current) => [campaign, ...current])
    setNotificationDeliveries((current) => [...deliveries, ...current])
    setSelectedCampaignId(campaign.id)
    setSelectedDeliveryId(deliveries[0]?.id || "")
    return { campaign, deliveries, skipped }
  }

  function sendAvailabilityCampaign() {
    if (selectedShiftIds.length === 0 || selectedRecipientIds.length === 0) return
    const { campaign, deliveries, skipped } = createCampaign(
      "overtime_availability",
      campaignTitle.trim() || "Overtime Availability",
      campaignChannel,
      selectedRecipientIds,
      selectedShiftIds,
      "Availability request queued for delivery"
    )
    setSelectedShiftIds([])
    setSelectedRecipientIds([])
    setRecipientScope("patrol")
    onAuditEvent("Notifications Queued", `${campaign.title} queued for ${deliveries.length} deliveries.`, `Recipients: ${campaign.recipientIds.length} | Shifts: ${campaign.shiftRequestIds.length}${skipped.length ? ` | Skipped: ${skipped.join(", ")}` : ""}`)
  }

  function sendAssignmentNotice(request: OvertimeShiftRequest, channel: NotificationChannel) {
    if (!request.assignedEmployeeId) return
    const { campaign, deliveries, skipped } = createCampaign(
      "overtime_assignment",
      `Assignment Notice ${formatDate(request.assignmentDate)}`,
      channel,
      [request.assignedEmployeeId],
      [request.id],
      "Assigned overtime notice queued for delivery"
    )
    onAuditEvent("Assignment Notice Queued", `${campaign.title} queued for ${deliveries.length} deliveries.`, `${request.assignmentDate} | ${request.shiftType}${skipped.length ? ` | Skipped: ${skipped.join(", ")}` : ""}`)
  }

  function updateDeliveryStatus(deliveryId: string, status: NotificationDelivery["status"], errorMessage?: string) {
    setNotificationDeliveries((current) =>
      current.map((delivery) =>
        delivery.id === deliveryId
          ? { ...delivery, status, errorMessage: errorMessage || null, sentAt: status === "sent" ? new Date().toISOString() : delivery.sentAt || null, updatedAt: new Date().toISOString() }
          : delivery
      )
    )
    const delivery = notificationDeliveries.find((entry) => entry.id === deliveryId)
    const employee = delivery ? employeeMap.get(delivery.employeeId) : null
    onAuditEvent("Delivery Updated", `${employee ? `${employee.firstName} ${employee.lastName}` : "Notification"} marked ${status}.`, delivery ? `${delivery.channel} | ${delivery.destination}` : errorMessage)
  }

  async function sendDeliveryNow(delivery: NotificationDelivery) {
    const result = await sendNotificationDelivery(delivery, notificationProviderConfig)
    if (result.ok) {
      updateDeliveryStatus(delivery.id, "sent")
      onAuditEvent(
        "Delivery Sent",
        `Live ${delivery.channel} delivery sent.`,
        `${delivery.destination}`
      )
      return
    }

    updateDeliveryStatus(delivery.id, "failed", result.error)
    onAuditEvent(
      "Delivery Failed",
      `Live ${delivery.channel} delivery failed.`,
      result.error
    )
  }

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
    const employee = employeeMap.get(employeeId)
    onAuditEvent("Overtime Response Captured", `${employee ? `${employee.firstName} ${employee.lastName}` : "Employee"} marked ${status}.`, requestId)
  }

  return (
    <div style={{ display: "grid", gap: "18px" }}>
      <Card>
        <CardHeader>
          <CardTitle>Notifications Control Center</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ display: "grid", gap: "10px" }}>
            <div style={{ fontSize: "13px", color: "#475569", lineHeight: 1.45 }}>
              Build overtime email or text campaigns, preview each message before it goes out, track which deliveries are ready or sent, and record employee responses back into the overtime workflow.
            </div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {[
                ["Queued", deliverySummary.queued, "#f8fafc", "#475569"],
                ["Ready", deliverySummary.ready, "#eff6ff", "#1d4ed8"],
                ["Sent", deliverySummary.sent, "#ecfdf5", "#166534"],
                ["Failed", deliverySummary.failed, "#fff1f2", "#be123c"]
              ].map(([label, count, background, color]) => (
                <div key={label as string} style={{ border: "1px solid #dbe3ee", borderRadius: "999px", padding: "6px 12px", background: background as string, color: color as string, fontWeight: 700, fontSize: "12px" }}>
                  {label}: {count as number}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delivery Provider</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ display: "grid", gap: "12px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: "4px" }}>Mode</div>
                <Select value={providerConfigDraft.mode} onValueChange={(value) => updateProviderConfig({ mode: value as NotificationProviderConfig["mode"] })}>
                  <SelectItem value="draft_only">Draft Only</SelectItem>
                  <SelectItem value="provider_ready">Live Webhook Delivery</SelectItem>
                </Select>
              </div>
              <div style={{ fontSize: "13px", color: "#475569", lineHeight: 1.4, paddingTop: "22px" }}>
                `Draft Only` keeps using preview links and manual tracking. `Live Webhook Delivery` posts email/text payloads to your configured endpoints directly from the browser.
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: "4px" }}>Email Webhook URL</div>
                <Input value={providerConfigDraft.emailWebhookUrl} onChange={(event) => updateProviderConfig({ emailWebhookUrl: event.target.value })} placeholder="https://your-provider/email" />
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: "4px" }}>Text Webhook URL</div>
                <Input value={providerConfigDraft.textWebhookUrl} onChange={(event) => updateProviderConfig({ textWebhookUrl: event.target.value })} placeholder="https://your-provider/text" />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: "4px" }}>Sender Name</div>
                <Input value={providerConfigDraft.senderName} onChange={(event) => updateProviderConfig({ senderName: event.target.value })} />
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: "4px" }}>Sender Email</div>
                <Input value={providerConfigDraft.senderEmail} onChange={(event) => updateProviderConfig({ senderEmail: event.target.value })} placeholder="scheduler@agency.org" />
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: "4px" }}>Sender Phone</div>
                <Input value={providerConfigDraft.senderPhone} onChange={(event) => updateProviderConfig({ senderPhone: event.target.value })} placeholder="207-555-1212" />
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 700, marginBottom: "4px" }}>Auth Token</div>
              <Input value={providerConfigDraft.authToken} onChange={(event) => updateProviderConfig({ authToken: event.target.value })} placeholder="Optional bearer token for webhook auth" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "18px" }}>
        <Card>
          <CardHeader>
            <CardTitle>Send Overtime Availability</CardTitle>
          </CardHeader>
          <CardContent>
            {!canEdit && <div style={{ color: "#64748b", fontSize: "13px" }}>Read-only. Only admins and sergeants can stage or send notifications.</div>}
            {canEdit && (
              <div style={{ display: "grid", gap: "12px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: "4px" }}>Campaign Title</div>
                    <Input value={campaignTitle} onChange={(event) => setCampaignTitle(event.target.value)} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: "4px" }}>Channel</div>
                    <Select value={campaignChannel} onValueChange={(value) => setCampaignChannel(value as NotificationChannel)}>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="text">Text</SelectItem>
                      <SelectItem value="both">Email + Text</SelectItem>
                    </Select>
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 700, marginBottom: "6px" }}>Available Overtime Shifts</div>
                  <div style={{ display: "grid", gap: "8px", maxHeight: "260px", overflowY: "auto" }}>
                    {openShiftRequests.map((request) => (
                      <label key={request.id} style={{ display: "flex", gap: "8px", alignItems: "center", border: "1px solid #dbe3ee", borderRadius: "10px", padding: "10px", background: "#ffffff" }}>
                        <input type="checkbox" checked={selectedShiftIds.includes(request.id)} onChange={() => setSelectedShiftIds((current) => toggleSelection(current, request.id))} />
                        <span style={{ fontSize: "13px", color: "#334155" }}>{formatNotificationShiftSummary(request)}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={{ display: "grid", gap: "8px", marginBottom: "6px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center" }}>
                      <div style={{ fontWeight: 700 }}>Recipients</div>
                      <button type="button" onClick={() => setSelectedRecipientIds(filteredRecipients.map((entry) => entry.employeeId))} style={{ border: "none", background: "transparent", color: "#1d4ed8", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>
                        Select All Eligible
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {([
                        ["patrol", "Patrol"],
                        ["days_a", "Days A"],
                        ["days_b", "Days B"],
                        ["nights_a", "Nights A"],
                        ["nights_b", "Nights B"],
                        ["supervisors", "Supervisors"],
                        ["deputies", "Deputies"],
                        ["all", "All Active"]
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => {
                            setRecipientScope(value)
                            setSelectedRecipientIds([])
                          }}
                          style={{
                            border: recipientScope === value ? "1px solid #1d4ed8" : "1px solid #cbd5e1",
                            background: recipientScope === value ? "#eff6ff" : "#ffffff",
                            color: recipientScope === value ? "#1d4ed8" : "#334155",
                            borderRadius: "999px",
                            padding: "5px 10px",
                            fontSize: "11px",
                            fontWeight: 700,
                            cursor: "pointer"
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: "12px", color: "#64748b" }}>
                      Showing {filteredRecipients.length} eligible recipient(s) for the current channel and target group.
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: "8px", maxHeight: "260px", overflowY: "auto" }}>
                    {filteredRecipients.map((preference) => {
                      const employee = employeeMap.get(preference.employeeId)
                      if (!employee) return null
                      const canReceiveEmail = preference.allowEmail && preference.emailAddress.trim().length > 0
                      const canReceiveText = preference.allowText && preference.phoneNumber.trim().length > 0
                      return (
                        <label key={preference.employeeId} style={{ display: "flex", gap: "8px", alignItems: "center", border: "1px solid #dbe3ee", borderRadius: "10px", padding: "10px", background: "#ffffff" }}>
                          <input type="checkbox" checked={selectedRecipientIds.includes(preference.employeeId)} onChange={() => setSelectedRecipientIds((current) => toggleSelection(current, preference.employeeId))} />
                          <div style={{ display: "grid", gap: "2px" }}>
                            <div style={{ fontWeight: 700 }}>{employee.firstName} {employee.lastName}</div>
                            <div style={{ fontSize: "12px", color: "#64748b" }}>{employee.team} | {employee.rank}</div>
                            <div style={{ fontSize: "12px", color: "#64748b" }}>{canReceiveEmail ? preference.emailAddress : "No email"} | {canReceiveText ? preference.phoneNumber : "No text"}</div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button onClick={sendAvailabilityCampaign} disabled={selectedShiftIds.length === 0 || selectedRecipientIds.length === 0}>Queue Availability Delivery</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Delivery Queue And Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ display: "grid", gap: "12px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "12px" }}>
                <div style={{ display: "grid", gap: "8px", maxHeight: "560px", overflowY: "auto" }}>
                  {notificationDeliveries.length === 0 && <div style={{ color: "#64748b", fontSize: "13px" }}>No deliveries are queued yet.</div>}
                  {notificationDeliveries.map((delivery) => {
                    const employee = employeeMap.get(delivery.employeeId)
                    const statusStyle = getStatusColor(delivery.status)
                    return (
                      <button
                        key={delivery.id}
                        onClick={() => setSelectedDeliveryId(delivery.id)}
                        style={{
                          textAlign: "left",
                          border: selectedDelivery?.id === delivery.id ? "1px solid #1d4ed8" : `1px solid ${statusStyle.border}`,
                          borderRadius: "12px",
                          padding: "10px",
                          background: selectedDelivery?.id === delivery.id ? "#eff6ff" : "#ffffff",
                          cursor: "pointer",
                          display: "grid",
                          gap: "4px"
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                          <div style={{ fontWeight: 800 }}>{employee ? `${employee.firstName} ${employee.lastName}` : delivery.destination}</div>
                          <div style={{ padding: "2px 8px", borderRadius: "999px", background: statusStyle.background, color: statusStyle.color, fontSize: "11px", fontWeight: 800 }}>{delivery.status}</div>
                        </div>
                        <div style={{ fontSize: "12px", color: "#475569" }}>{delivery.channel.toUpperCase()} | {delivery.destination}</div>
                        <div style={{ fontSize: "12px", color: "#64748b" }}>{employee?.lastName || "Employee"} | {delivery.shiftRequestIds.length} shift(s)</div>
                      </button>
                    )
                  })}
                </div>

                <div style={{ border: "1px solid #dbe3ee", borderRadius: "12px", padding: "12px", background: "#ffffff", display: "grid", gap: "10px" }}>
                  {!selectedDelivery && <div style={{ color: "#64748b", fontSize: "13px" }}>Pick a delivery to preview the message body and controls.</div>}
                  {selectedDelivery && (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "flex-start", flexWrap: "wrap" }}>
                        <div style={{ display: "grid", gap: "4px" }}>
                          <div style={{ fontWeight: 800 }}>{selectedDelivery.subject}</div>
                          <div style={{ fontSize: "12px", color: "#475569" }}>{selectedDelivery.channel.toUpperCase()} to {selectedDelivery.destination}</div>
                          <div style={{ fontSize: "12px", color: "#64748b" }}>Campaign: {activeDeliveryCampaign?.title || "Unknown"}</div>
                        </div>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <a href={buildDeliveryLink(selectedDelivery)} style={{ textDecoration: "none" }}><Button>{selectedDelivery.responseToken ? "Open Response Link" : "Open Draft"}</Button></a>
                          <Button onClick={() => void sendDeliveryNow(selectedDelivery)} disabled={!canEdit || !canSendDeliveryLive(selectedDelivery, notificationProviderConfig)}>
                            Send Now
                          </Button>
                          <Button onClick={() => updateDeliveryStatus(selectedDelivery.id, "sent")} disabled={!canEdit}>Mark Sent</Button>
                          <Button onClick={() => updateDeliveryStatus(selectedDelivery.id, "failed", "Delivery failed or returned")} disabled={!canEdit}>Mark Failed</Button>
                        </div>
                      </div>

                      <div style={{ display: "grid", gap: "6px" }}>
                        <div style={{ fontWeight: 700, fontSize: "13px" }}>Shift Summary</div>
                        <div style={{ display: "grid", gap: "4px", fontSize: "12px", color: "#475569" }}>
                          {selectedDelivery.shiftRequestIds.map((shiftId) => {
                            const request = requestMap.get(shiftId)
                            return <div key={shiftId}>{request ? formatNotificationShiftSummary(request) : shiftId}</div>
                          })}
                        </div>
                      </div>

                      <div style={{ display: "grid", gap: "6px" }}>
                        <div style={{ fontWeight: 700, fontSize: "13px" }}>Message Preview</div>
                        <textarea
                          value={selectedDelivery.body}
                          readOnly
                          style={{ minHeight: "280px", resize: "vertical", border: "1px solid #cbd5e1", borderRadius: "10px", padding: "10px", fontSize: "12px", lineHeight: 1.5, fontFamily: "Consolas, 'Courier New', monospace" }}
                        />
                      </div>

                      {selectedDelivery.channel === "email" && (
                        <div style={{ display: "grid", gap: "8px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                            <div style={{ fontWeight: 700, fontSize: "13px" }}>Mobile Email Preview</div>
                            <div style={{ fontSize: "12px", color: "#64748b" }}>
                              Phone-sized rendering of the outbound email card.
                            </div>
                          </div>
                          <div style={{ display: "flex", justifyContent: "center" }}>
                            <div
                              style={{
                                width: "320px",
                                maxWidth: "100%",
                                border: "10px solid #0f172a",
                                borderRadius: "30px",
                                overflow: "hidden",
                                background: "#0f172a",
                                boxShadow: "0 20px 36px rgba(15, 23, 42, 0.18)"
                              }}
                            >
                              <div style={{ padding: "10px 14px", background: "#0f172a", color: "#f8fafc", fontWeight: 700, fontSize: "12px", display: "flex", justifyContent: "space-between", gap: "8px" }}>
                                <span>Email</span>
                                <span>{selectedDelivery.destination}</span>
                              </div>
                              <iframe
                                title={`Email preview ${selectedDelivery.id}`}
                                srcDoc={selectedDeliveryEmailHtml}
                                style={{ width: "100%", height: "540px", border: "none", background: "#e2e8f0" }}
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {selectedDelivery.responseToken && (
                        <div style={{ display: "grid", gap: "6px" }}>
                          <div style={{ fontWeight: 700, fontSize: "13px" }}>Employee Response Link</div>
                          <input
                            value={selectedDeliveryResponseLink}
                            readOnly
                            style={{ width: "100%", padding: 8, border: "1px solid #cbd5e1", borderRadius: "10px", fontSize: "12px", color: "#334155" }}
                          />
                          <div style={{ fontSize: "12px", color: "#64748b" }}>
                            Opening this link takes the employee into the mobile overtime response screen for their assigned availability request.
                          </div>
                        </div>
                      )}

                      {!canSendDeliveryLive(selectedDelivery, notificationProviderConfig) && (
                        <div style={{ fontSize: "12px", color: "#92400e", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "10px", padding: "10px" }}>
                          Live send is not configured for this delivery channel yet. Add the matching webhook URL and switch the provider mode to `Live Webhook Delivery`.
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "18px" }}>
        <Card>
          <CardHeader>
            <CardTitle>Record Responses</CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ display: "grid", gap: "12px" }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: "4px" }}>Campaign</div>
                <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
                  <SelectItem value="">Latest Open Shift</SelectItem>
                  {notificationCampaigns.map((campaign) => (
                    <SelectItem key={campaign.id} value={campaign.id}>{campaign.title} | {campaign.channel} | {campaign.status}</SelectItem>
                  ))}
                </Select>
              </div>

              {!responseTargetShift && <div style={{ color: "#64748b", fontSize: "13px" }}>No overtime shifts are available to collect responses for yet.</div>}
              {responseTargetShift && (
                <>
                  <div style={{ border: "1px solid #dbe3ee", borderRadius: "12px", padding: "10px", background: "#ffffff" }}>
                    <div style={{ fontWeight: 800 }}>{formatDate(responseTargetShift.assignmentDate)} | {responseTargetShift.shiftType}</div>
                    <div style={{ marginTop: "4px", color: "#475569", fontSize: "13px" }}>{responseTargetShift.description}</div>
                  </div>

                  <div style={{ display: "grid", gap: "8px", maxHeight: "420px", overflowY: "auto" }}>
                    {(selectedCampaign?.recipientIds || activeEmployees.map((employee) => employee.id)).map((employeeId) => {
                      const employee = employeeMap.get(employeeId)
                      if (!employee) return null
                      const response = responseTargetShift.responses.find((entry) => entry.employeeId === employeeId)
                      return (
                        <div key={`${responseTargetShift.id}-${employeeId}`} style={{ border: "1px solid #dbe3ee", borderRadius: "10px", padding: "10px", background: "#ffffff", display: "grid", gap: "6px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                            <div style={{ fontWeight: 700 }}>{employee.firstName} {employee.lastName}</div>
                            <div style={{ fontSize: "12px", color: "#64748b" }}>{response?.status || "Pending"}</div>
                          </div>
                          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                            {(["Interested", "Declined", "No Response"] as OvertimeAvailabilityStatus[]).map((status) => (
                              <button
                                key={`${employeeId}-${status}`}
                                onClick={() => setResponse(responseTargetShift.id, employeeId, status)}
                                style={{
                                  border: response?.status === status ? "1px solid #1d4ed8" : "1px solid #cbd5e1",
                                  background: response?.status === status ? "#eff6ff" : "#ffffff",
                                  color: response?.status === status ? "#1d4ed8" : "#334155",
                                  borderRadius: "8px",
                                  padding: "4px 8px",
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
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Employee Notification Preferences</CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ display: "grid", gap: "10px", maxHeight: "740px", overflowY: "auto" }}>
              {notificationPreferences.map((preference) => {
                const employee = employeeMap.get(preference.employeeId)
                if (!employee) return null
                return (
                  <div key={preference.employeeId} style={{ border: "1px solid #dbe3ee", borderRadius: "12px", padding: "12px", background: "#ffffff", display: "grid", gap: "10px" }}>
                    <div style={{ fontWeight: 800 }}>{employee.firstName} {employee.lastName}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                      <Input value={preference.emailAddress} disabled={!canEdit} onChange={(event) => updatePreference(preference.employeeId, { emailAddress: event.target.value })} placeholder="Email address" />
                      <Input value={preference.phoneNumber} disabled={!canEdit} onChange={(event) => updatePreference(preference.employeeId, { phoneNumber: event.target.value })} placeholder="Phone number" />
                    </div>
                    <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", fontSize: "12px", color: "#334155" }}>
                      {([
                        ["allowEmail", "Email"],
                        ["allowText", "Text"],
                        ["overtimeAvailability", "OT Availability"],
                        ["overtimeAssignment", "OT Assignment"],
                        ["patrolUpdates", "Patrol"],
                        ["forceUpdates", "Force"],
                        ["detailUpdates", "Detail"]
                      ] as const).map(([key, label]) => (
                        <label key={`${preference.employeeId}-${key}`} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                          <input type="checkbox" checked={preference[key]} disabled={!canEdit} onChange={(event) => updatePreference(preference.employeeId, { [key]: event.target.checked } as Partial<NotificationPreference>)} />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Assigned Overtime Notices</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ display: "grid", gap: "10px" }}>
            {assignmentNotices.length === 0 && <div style={{ color: "#64748b", fontSize: "13px" }}>No assigned overtime shifts are waiting on a notification.</div>}
            {assignmentNotices.map((request) => {
              const assignedEmployee = request.assignedEmployeeId ? employeeMap.get(request.assignedEmployeeId) || null : null
              return (
                <div key={request.id} style={{ border: "1px solid #dbe3ee", borderRadius: "12px", padding: "12px", background: "#ffffff", display: "grid", gap: "8px" }}>
                  <div style={{ fontWeight: 800 }}>{formatDate(request.assignmentDate)} | {request.shiftType} | {request.description}</div>
                  <div style={{ fontSize: "13px", color: "#475569" }}>Assigned to: <strong>{assignedEmployee ? `${assignedEmployee.firstName} ${assignedEmployee.lastName}` : "Unknown"}</strong></div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <Button onClick={() => sendAssignmentNotice(request, "email")} disabled={!canEdit}>Queue Email</Button>
                    <Button onClick={() => sendAssignmentNotice(request, "text")} disabled={!canEdit}>Queue Text</Button>
                    <Button onClick={() => sendAssignmentNotice(request, "both")} disabled={!canEdit}>Queue Both</Button>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

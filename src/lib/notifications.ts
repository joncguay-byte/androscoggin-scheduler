import type {
  Employee,
  NotificationCampaign,
  NotificationChannel,
  NotificationProviderConfig,
  NotificationDelivery,
  NotificationDeliveryMethod,
  NotificationPreference,
  OvertimeShiftRequest
} from "../types"

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: "2-digit",
    day: "2-digit",
    year: "numeric"
  })
}

function formatShiftSummary(request: OvertimeShiftRequest) {
  const shiftLabel = request.shiftType === "Days" ? "Days" : "Nights"
  const roleMap: Record<OvertimeShiftRequest["positionCode"], string> = {
    SUP1: "Supervisor",
    SUP2: "Supervisor",
    DEP1: "Deputy",
    DEP2: "Deputy",
    POL: "Poland"
  }

  return `${formatDate(request.assignmentDate)}, ${shiftLabel}, ${roleMap[request.positionCode]}, ${request.offEmployeeLastName || "Open"}, ${request.offHours || "Hours TBD"}`
}

function getCampaignSubject(campaign: NotificationCampaign) {
  if (campaign.type === "overtime_assignment") {
    return `${campaign.title} - Assigned Overtime`
  }

  return `${campaign.title} - Overtime Availability`
}

function buildAvailabilityBody(
  campaign: NotificationCampaign,
  employee: Employee,
  shifts: OvertimeShiftRequest[],
  responseLink: string
) {
  const shiftLines = shifts.map((request, index) => `${index + 1}. ${formatShiftSummary(request)}`).join("\n")

  return [
    `Hello ${employee.firstName},`,
    "",
    "The following overtime shifts are available:",
    shiftLines || "No shifts selected.",
    "",
    "Reply with the shifts you are interested in working.",
    responseLink ? `Response link: ${responseLink}` : "",
    "",
    `Campaign: ${campaign.title}`
  ].join("\n")
}

function buildAssignmentBody(
  campaign: NotificationCampaign,
  employee: Employee,
  shifts: OvertimeShiftRequest[]
) {
  const shiftLines = shifts.map((request) => `- ${formatShiftSummary(request)}`).join("\n")

  return [
    `Hello ${employee.firstName},`,
    "",
    "You have been assigned the following overtime shift:",
    shiftLines || "- No shift details found.",
    "",
    "Please confirm receipt with supervision.",
    "",
    `Notice: ${campaign.title}`
  ].join("\n")
}

function getChannels(channel: NotificationChannel) {
  if (channel === "both") return ["email", "text"] as NotificationDeliveryMethod[]
  return [channel]
}

function getDestination(
  preference: NotificationPreference,
  channel: NotificationDeliveryMethod
) {
  return channel === "email" ? preference.emailAddress.trim() : preference.phoneNumber.trim()
}

function canUseChannel(
  preference: NotificationPreference,
  channel: NotificationDeliveryMethod,
  campaignType: NotificationCampaign["type"]
) {
  if (channel === "email") {
    if (!preference.allowEmail || preference.emailAddress.trim().length === 0) return false
  }

  if (channel === "text") {
    if (!preference.allowText || preference.phoneNumber.trim().length === 0) return false
  }

  if (campaignType === "overtime_availability" && !preference.overtimeAvailability) return false
  if (campaignType === "overtime_assignment" && !preference.overtimeAssignment) return false

  return true
}

export function buildNotificationDeliveries({
  campaign,
  recipients,
  employeeMap,
  preferencesMap,
  shiftMap
}: {
  campaign: NotificationCampaign
  recipients: string[]
  employeeMap: Map<string, Employee>
  preferencesMap: Map<string, NotificationPreference>
  shiftMap: Map<string, OvertimeShiftRequest>
}) {
  const deliveries: NotificationDelivery[] = []
  const skipped: string[] = []
  const shifts = campaign.shiftRequestIds
    .map((shiftId) => shiftMap.get(shiftId))
    .filter((request): request is OvertimeShiftRequest => !!request)

  for (const employeeId of recipients) {
    const employee = employeeMap.get(employeeId)
    const preference = preferencesMap.get(employeeId)
    if (!employee || !preference) continue

    for (const channel of getChannels(campaign.channel)) {
      if (!canUseChannel(preference, channel, campaign.type)) {
        skipped.push(`${employee.firstName} ${employee.lastName} (${channel})`)
        continue
      }

      const destination = getDestination(preference, channel)
      const responseToken = campaign.type === "overtime_availability" ? crypto.randomUUID() : null
      const responseLink = responseToken
        ? (typeof window !== "undefined"
          ? `${window.location.origin}${window.location.pathname}#mobile-response=${encodeURIComponent(responseToken)}`
          : `#mobile-response=${encodeURIComponent(responseToken)}`)
        : ""
      const body =
        campaign.type === "overtime_assignment"
          ? buildAssignmentBody(campaign, employee, shifts)
          : buildAvailabilityBody(campaign, employee, shifts, responseLink)

      deliveries.push({
        id: crypto.randomUUID(),
        campaignId: campaign.id,
        employeeId,
        channel,
        destination,
        shiftRequestIds: campaign.shiftRequestIds,
        responseToken,
        subject: getCampaignSubject(campaign),
        body,
        status: "ready",
        providerMode: "draft_only",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
    }
  }

  return { deliveries, skipped }
}

export function buildDeliveryLink(delivery: NotificationDelivery) {
  if (delivery.responseToken) {
    if (typeof window !== "undefined") {
      return `${window.location.origin}${window.location.pathname}#mobile-response=${encodeURIComponent(delivery.responseToken)}`
    }
    return `#mobile-response=${encodeURIComponent(delivery.responseToken)}`
  }

  if (delivery.channel === "email") {
    return `mailto:${encodeURIComponent(delivery.destination)}?subject=${encodeURIComponent(delivery.subject)}&body=${encodeURIComponent(delivery.body)}`
  }

  return `sms:${encodeURIComponent(delivery.destination)}?body=${encodeURIComponent(delivery.body)}`
}

export function formatNotificationShiftSummary(request: OvertimeShiftRequest) {
  return formatShiftSummary(request)
}

export function canSendDeliveryLive(
  delivery: NotificationDelivery,
  providerConfig: NotificationProviderConfig
) {
  if (providerConfig.mode !== "provider_ready") return false
  if (delivery.channel === "email") return providerConfig.emailWebhookUrl.trim().length > 0
  return providerConfig.textWebhookUrl.trim().length > 0
}

export async function sendNotificationDelivery(
  delivery: NotificationDelivery,
  providerConfig: NotificationProviderConfig
) {
  const endpoint = delivery.channel === "email"
    ? providerConfig.emailWebhookUrl.trim()
    : providerConfig.textWebhookUrl.trim()

  if (!canSendDeliveryLive(delivery, providerConfig) || endpoint.length === 0) {
    return {
      ok: false,
      error: "Provider is not configured for this channel."
    }
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(providerConfig.authToken.trim().length > 0 ? { Authorization: `Bearer ${providerConfig.authToken.trim()}` } : {})
      },
      body: JSON.stringify({
        channel: delivery.channel,
        destination: delivery.destination,
        subject: delivery.subject,
        body: delivery.body,
        responseToken: delivery.responseToken || null,
        campaignId: delivery.campaignId,
        deliveryId: delivery.id,
        shiftRequestIds: delivery.shiftRequestIds,
        sender: {
          name: providerConfig.senderName,
          email: providerConfig.senderEmail,
          phone: providerConfig.senderPhone
        }
      })
    })

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      return {
        ok: false,
        error: text || `Provider returned ${response.status}.`
      }
    }

    return { ok: true as const }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown delivery error."
    }
  }
}

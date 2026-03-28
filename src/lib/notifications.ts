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

  return `${formatDate(request.assignmentDate)}, ${shiftLabel}, ${roleMap[request.positionCode]}, ${request.offEmployeeLastName || "Open"}, ${request.assignedHours || request.offHours || "Hours TBD"}`
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
    "Reply with the shifts you are interested in working. Command staff will make the final assignment.",
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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function buildParagraphs(body: string) {
  return body
    .split(/\n\s*\n/)
    .map((section) => section.trim())
    .filter(Boolean)
    .map((section) => {
      const lines = section.split("\n").map((line) => line.trim()).filter(Boolean)
      const isList = lines.every((line) => /^(\d+\.|-)\s/.test(line))

      if (isList) {
        const items = lines
          .map((line) => line.replace(/^(\d+\.|-)\s*/, "").trim())
          .filter(Boolean)
          .map((line) => `<li style="margin:0 0 8px;">${escapeHtml(line)}</li>`)
          .join("")

        return `<ul style="margin:0;padding-left:20px;color:#334155;font-size:14px;line-height:1.6;">${items}</ul>`
      }

      return `<p style="margin:0;color:#334155;font-size:14px;line-height:1.7;">${lines.map((line) => escapeHtml(line)).join("<br />")}</p>`
    })
    .join("")
}

function getChannels(channel: NotificationChannel) {
  if (channel === "both") return ["email", "text"] as NotificationDeliveryMethod[]
  return [channel]
}

function buildResponseLink(responseToken: string) {
  if (typeof window !== "undefined") {
    const url = new URL(window.location.href)
    url.searchParams.set("mobile-response", responseToken)
    url.hash = ""
    return url.toString()
  }

  return `?mobile-response=${encodeURIComponent(responseToken)}`
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
      const responseLink = responseToken ? buildResponseLink(responseToken) : ""
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
    return buildResponseLink(delivery.responseToken)
  }

  if (delivery.channel === "email") {
    return `mailto:${encodeURIComponent(delivery.destination)}?subject=${encodeURIComponent(delivery.subject)}&body=${encodeURIComponent(delivery.body)}`
  }

  return `sms:${encodeURIComponent(delivery.destination)}?body=${encodeURIComponent(delivery.body)}`
}

export function buildEmailHtmlPreview(
  delivery: NotificationDelivery,
  options?: {
    senderName?: string
    responseLink?: string
  }
) {
  const senderName = options?.senderName?.trim() || "Androscoggin Scheduler"
  const responseLink = options?.responseLink?.trim() || ""
  const previewBadge = delivery.responseToken ? "Availability Request" : "Assignment Notice"
  const actionLabel = delivery.responseToken ? "Open Overtime Response" : "Open Scheduler Notice"

  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(delivery.subject)}</title>
  </head>
  <body style="margin:0;padding:24px 12px;background:#e2e8f0;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 18px 40px rgba(15,23,42,0.18);">
      <div style="padding:18px 22px;background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);color:#f8fafc;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;opacity:0.82;">${escapeHtml(senderName)}</div>
        <div style="margin-top:10px;font-size:24px;font-weight:800;line-height:1.25;">${escapeHtml(delivery.subject)}</div>
        <div style="margin-top:12px;display:inline-block;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,0.14);font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;">${escapeHtml(previewBadge)}</div>
      </div>
      <div style="padding:22px;display:grid;gap:16px;">
        <div style="display:grid;gap:12px;">
          ${buildParagraphs(delivery.body)}
        </div>
        ${responseLink ? `
        <div style="padding:16px;border:1px solid #bfdbfe;border-radius:16px;background:#eff6ff;">
          <div style="font-size:12px;color:#1d4ed8;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">Mobile Response</div>
          <div style="margin-top:8px;color:#334155;font-size:13px;line-height:1.6;">Tap below to open the employee overtime response screen on mobile.</div>
          <a href="${escapeHtml(responseLink)}" style="display:inline-block;margin-top:12px;padding:10px 16px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:999px;font-size:13px;font-weight:700;">${escapeHtml(actionLabel)}</a>
        </div>
        ` : ""}
      </div>
      <div style="padding:14px 22px;border-top:1px solid #e2e8f0;background:#f8fafc;color:#64748b;font-size:12px;line-height:1.6;">
        Sent to ${escapeHtml(delivery.destination)} via ${escapeHtml(delivery.channel.toUpperCase())}.
      </div>
    </div>
  </body>
</html>
`.trim()
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
    const responseLink = delivery.responseToken
      ? buildResponseLink(delivery.responseToken)
      : ""

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
        htmlBody: delivery.channel === "email"
          ? buildEmailHtmlPreview(delivery, {
              senderName: providerConfig.senderName,
              responseLink
            })
          : null,
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

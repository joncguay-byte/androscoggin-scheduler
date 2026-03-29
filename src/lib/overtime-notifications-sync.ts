import { supabase } from "./supabase"
import type {
  NotificationCampaign,
  NotificationDelivery,
  NotificationPreference,
  NotificationProviderConfig,
  OvertimeEntry,
  OvertimeShiftRequest
} from "../types"

type OvertimeNotificationsState = {
  overtimeQueueIds: string[]
  overtimeShiftRequests: OvertimeShiftRequest[]
  overtimeEntries: OvertimeEntry[]
  notificationPreferences: NotificationPreference[]
  notificationCampaigns: NotificationCampaign[]
  notificationDeliveries: NotificationDelivery[]
  notificationProviderConfig?: NotificationProviderConfig | null
}

type SyncResult<T> = {
  data: T | null
  error: string | null
}

type SaveResult = {
  ok: boolean
  error: string | null
}

function toErrorMessage(error: unknown) {
  if (!error) return "Unknown overtime/notification sync error."
  if (typeof error === "string") return error
  if (typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message
  }

  return "Unknown overtime/notification sync error."
}

function ensureStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[]
  return value.filter((entry): entry is string => typeof entry === "string")
}

function ensureResponses(value: unknown) {
  if (!Array.isArray(value)) return [] as OvertimeShiftRequest["responses"]
  return value.filter((entry): entry is OvertimeShiftRequest["responses"][number] => {
    return !!entry &&
      typeof entry === "object" &&
      "employeeId" in entry &&
      "status" in entry &&
      "updatedAt" in entry
  })
}

export async function loadSupabaseOvertimeNotificationsState(): Promise<SyncResult<OvertimeNotificationsState>> {
  try {
    const [
      queueResult,
      requestsResult,
      entriesResult,
      preferencesResult,
      campaignsResult,
      deliveriesResult,
      providerConfigResult
    ] = await Promise.all([
      supabase
        .from("overtime_queue")
        .select("employee_id,queue_position")
        .order("queue_position", { ascending: true }),
      supabase
        .from("overtime_shift_requests")
        .select("id,source,batch_id,batch_name,assignment_date,shift_type,position_code,description,off_employee_id,off_employee_last_name,off_hours,off_reason,assigned_hours,selection_active,manually_queued,auto_assign_reason,workflow_status,status,assigned_employee_id,created_at,responses")
        .order("assignment_date", { ascending: true }),
      supabase
        .from("overtime_entries")
        .select("id,employee_id,date,hours,reason,source,created_at")
        .order("date", { ascending: false }),
      supabase
        .from("notification_preferences")
        .select("employee_id,email_address,phone_number,allow_email,allow_text,overtime_availability,overtime_assignment,patrol_updates,force_updates,detail_updates")
        .order("employee_id", { ascending: true }),
      supabase
        .from("notification_campaigns")
        .select("id,title,type,channel,recipient_ids,shift_request_ids,status,created_at,sent_at,notes")
        .order("created_at", { ascending: false }),
      supabase
        .from("notification_deliveries")
        .select("id,campaign_id,employee_id,channel,destination,shift_request_ids,response_token,subject,body,status,provider_mode,created_at,updated_at,sent_at,error_message")
        .order("created_at", { ascending: false }),
      supabase
        .from("notification_provider_config")
        .select("config_key,mode,email_webhook_url,text_webhook_url,auth_token,sender_name,sender_email,sender_phone")
        .eq("config_key", "default")
        .maybeSingle()
    ])

    const errors = [
      queueResult.error,
      requestsResult.error,
      entriesResult.error,
      preferencesResult.error,
      campaignsResult.error,
      deliveriesResult.error,
      providerConfigResult.error
    ].filter(Boolean)

    if (errors.length > 0) {
      return {
        data: null,
        error: toErrorMessage(errors[0])
      }
    }

    return {
      data: {
        overtimeQueueIds: (queueResult.data || []).map((row) => row.employee_id as string),
        overtimeShiftRequests: ((requestsResult.data || []) as Array<Record<string, unknown>>).map((row) => ({
          id: String(row.id),
          source: row.source as OvertimeShiftRequest["source"],
          batchId: (row.batch_id as string | null) || null,
          batchName: (row.batch_name as string | null) || null,
          assignmentDate: String(row.assignment_date),
          shiftType: row.shift_type as OvertimeShiftRequest["shiftType"],
          positionCode: row.position_code as OvertimeShiftRequest["positionCode"],
          description: String(row.description || ""),
          offEmployeeId: (row.off_employee_id as string | null) || null,
          offEmployeeLastName: (row.off_employee_last_name as string | null) || null,
          offHours: (row.off_hours as string | null) || null,
          offReason: (row.off_reason as string | null) || null,
          assignedHours: (row.assigned_hours as string | null) || null,
          selectionActive: Boolean(row.selection_active),
          manuallyQueued: Boolean(row.manually_queued),
          autoAssignReason: (row.auto_assign_reason as OvertimeShiftRequest["autoAssignReason"] | null) || null,
          workflowStatus: (row.workflow_status as OvertimeShiftRequest["workflowStatus"] | null) || undefined,
          status: row.status as OvertimeShiftRequest["status"],
          assignedEmployeeId: (row.assigned_employee_id as string | null) || null,
          createdAt: String(row.created_at),
          responses: ensureResponses(row.responses)
        })),
        overtimeEntries: ((entriesResult.data || []) as Array<Record<string, unknown>>).map((row) => ({
          id: String(row.id),
          employeeId: String(row.employee_id),
          date: String(row.date),
          hours: Number(row.hours || 0),
          reason: String(row.reason || ""),
          source: row.source as OvertimeEntry["source"],
          createdAt: String(row.created_at)
        })),
        notificationPreferences: ((preferencesResult.data || []) as Array<Record<string, unknown>>).map((row) => ({
          employeeId: String(row.employee_id),
          emailAddress: String(row.email_address || ""),
          phoneNumber: String(row.phone_number || ""),
          allowEmail: Boolean(row.allow_email),
          allowText: Boolean(row.allow_text),
          overtimeAvailability: Boolean(row.overtime_availability),
          overtimeAssignment: Boolean(row.overtime_assignment),
          patrolUpdates: Boolean(row.patrol_updates),
          forceUpdates: Boolean(row.force_updates),
          detailUpdates: Boolean(row.detail_updates)
        })),
        notificationCampaigns: ((campaignsResult.data || []) as Array<Record<string, unknown>>).map((row) => ({
          id: String(row.id),
          title: String(row.title || ""),
          type: row.type as NotificationCampaign["type"],
          channel: row.channel as NotificationCampaign["channel"],
          recipientIds: ensureStringArray(row.recipient_ids),
          shiftRequestIds: ensureStringArray(row.shift_request_ids),
          status: row.status as NotificationCampaign["status"],
          createdAt: String(row.created_at),
          sentAt: (row.sent_at as string | null) || null,
          notes: (row.notes as string | null) || null
        })),
        notificationDeliveries: ((deliveriesResult.data || []) as Array<Record<string, unknown>>).map((row) => ({
          id: String(row.id),
          campaignId: String(row.campaign_id),
          employeeId: String(row.employee_id),
          channel: row.channel as NotificationDelivery["channel"],
          destination: String(row.destination || ""),
          shiftRequestIds: ensureStringArray(row.shift_request_ids),
          responseToken: (row.response_token as string | null) || null,
          subject: String(row.subject || ""),
          body: String(row.body || ""),
          status: row.status as NotificationDelivery["status"],
          providerMode: row.provider_mode as NotificationDelivery["providerMode"],
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
          sentAt: (row.sent_at as string | null) || null,
          errorMessage: (row.error_message as string | null) || null
        })),
        notificationProviderConfig: providerConfigResult.data
          ? {
              mode: providerConfigResult.data.mode as NotificationProviderConfig["mode"],
              emailWebhookUrl: providerConfigResult.data.email_webhook_url || "",
              textWebhookUrl: providerConfigResult.data.text_webhook_url || "",
              authToken: providerConfigResult.data.auth_token || "",
              senderName: providerConfigResult.data.sender_name || "",
              senderEmail: providerConfigResult.data.sender_email || "",
              senderPhone: providerConfigResult.data.sender_phone || ""
            }
          : null
      },
      error: null
    }
  } catch (error) {
    return {
      data: null,
      error: toErrorMessage(error)
    }
  }
}

export async function saveSupabaseOvertimeNotificationsState(
  state: OvertimeNotificationsState
): Promise<SaveResult> {
  try {
    const queuePayload = state.overtimeQueueIds.map((employeeId, index) => ({
      employee_id: employeeId,
      queue_position: index,
      updated_at: new Date().toISOString()
    }))
    const requestsPayload = state.overtimeShiftRequests.map((request) => ({
      id: request.id,
      source: request.source,
      batch_id: request.batchId || null,
      batch_name: request.batchName || null,
      assignment_date: request.assignmentDate,
      shift_type: request.shiftType,
      position_code: request.positionCode,
      description: request.description,
      off_employee_id: request.offEmployeeId || null,
      off_employee_last_name: request.offEmployeeLastName || null,
      off_hours: request.offHours || null,
      off_reason: request.offReason || null,
      assigned_hours: request.assignedHours || null,
      selection_active: Boolean(request.selectionActive),
      manually_queued: Boolean(request.manuallyQueued),
      auto_assign_reason: request.autoAssignReason || null,
      workflow_status: request.workflowStatus || null,
      status: request.status,
      assigned_employee_id: request.assignedEmployeeId || null,
      created_at: request.createdAt,
      responses: request.responses
    }))
    const entriesPayload = state.overtimeEntries.map((entry) => ({
      id: entry.id,
      employee_id: entry.employeeId,
      date: entry.date,
      hours: entry.hours,
      reason: entry.reason,
      source: entry.source,
      created_at: entry.createdAt
    }))
    const preferencesPayload = state.notificationPreferences.map((preference) => ({
      employee_id: preference.employeeId,
      email_address: preference.emailAddress,
      phone_number: preference.phoneNumber,
      allow_email: preference.allowEmail,
      allow_text: preference.allowText,
      overtime_availability: preference.overtimeAvailability,
      overtime_assignment: preference.overtimeAssignment,
      patrol_updates: preference.patrolUpdates,
      force_updates: preference.forceUpdates,
      detail_updates: preference.detailUpdates
    }))
    const campaignsPayload = state.notificationCampaigns.map((campaign) => ({
      id: campaign.id,
      title: campaign.title,
      type: campaign.type,
      channel: campaign.channel,
      recipient_ids: campaign.recipientIds,
      shift_request_ids: campaign.shiftRequestIds,
      status: campaign.status,
      created_at: campaign.createdAt,
      sent_at: campaign.sentAt || null,
      notes: campaign.notes || null
    }))
    const deliveriesPayload = state.notificationDeliveries.map((delivery) => ({
      id: delivery.id,
      campaign_id: delivery.campaignId,
      employee_id: delivery.employeeId,
      channel: delivery.channel,
      destination: delivery.destination,
      shift_request_ids: delivery.shiftRequestIds,
      response_token: delivery.responseToken || null,
      subject: delivery.subject,
      body: delivery.body,
      status: delivery.status,
      provider_mode: delivery.providerMode,
      created_at: delivery.createdAt,
      updated_at: delivery.updatedAt,
      sent_at: delivery.sentAt || null,
      error_message: delivery.errorMessage || null
    }))

    if (queuePayload.length > 0) {
      const { error } = await supabase
        .from("overtime_queue")
        .upsert(queuePayload, { onConflict: "employee_id" })
      if (error) return { ok: false, error: toErrorMessage(error) }
    }

    if (requestsPayload.length > 0) {
      const { error } = await supabase
        .from("overtime_shift_requests")
        .upsert(requestsPayload, { onConflict: "id" })
      if (error) return { ok: false, error: toErrorMessage(error) }
    }

    if (entriesPayload.length > 0) {
      const { error } = await supabase
        .from("overtime_entries")
        .upsert(entriesPayload, { onConflict: "id" })
      if (error) return { ok: false, error: toErrorMessage(error) }
    }

    if (preferencesPayload.length > 0) {
      const { error } = await supabase
        .from("notification_preferences")
        .upsert(preferencesPayload, { onConflict: "employee_id" })
      if (error) return { ok: false, error: toErrorMessage(error) }
    }

    if (campaignsPayload.length > 0) {
      const { error } = await supabase
        .from("notification_campaigns")
        .upsert(campaignsPayload, { onConflict: "id" })
      if (error) return { ok: false, error: toErrorMessage(error) }
    }

    if (deliveriesPayload.length > 0) {
      const { error } = await supabase
        .from("notification_deliveries")
        .upsert(deliveriesPayload, { onConflict: "id" })
      if (error) return { ok: false, error: toErrorMessage(error) }
    }

    return {
      ok: true,
      error: null
    }
  } catch (error) {
    return {
      ok: false,
      error: toErrorMessage(error)
    }
  }
}

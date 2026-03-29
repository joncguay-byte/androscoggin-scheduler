import { z } from "zod"

export const notificationProviderConfigSchema = z.object({
  mode: z.enum(["draft_only", "provider_ready"]),
  emailWebhookUrl: z.string(),
  textWebhookUrl: z.string(),
  authToken: z.string(),
  senderName: z.string(),
  senderEmail: z.string(),
  senderPhone: z.string()
})

export const overtimeResponseSchema = z.object({
  employeeId: z.string(),
  status: z.enum(["Pending", "Interested", "Accepted", "Declined", "No Response", "Assigned"]),
  updatedAt: z.string()
})

export const overtimeShiftRequestSchema = z.object({
  id: z.string(),
  source: z.enum(["Patrol Open Shift", "Manual"]),
  batchId: z.string().nullable().optional(),
  batchName: z.string().nullable().optional(),
  assignmentDate: z.string(),
  shiftType: z.enum(["Days", "Nights"]),
  positionCode: z.enum(["SUP1", "SUP2", "DEP1", "DEP2", "POL"]),
  description: z.string(),
  offEmployeeId: z.string().nullable().optional(),
  offEmployeeLastName: z.string().nullable().optional(),
  offHours: z.string().nullable().optional(),
  offReason: z.string().nullable().optional(),
  assignedHours: z.string().nullable().optional(),
  selectionActive: z.boolean(),
  manuallyQueued: z.boolean().optional(),
  autoAssignReason: z.enum(["Checkmark Priority", "Fairness Override", "Supervisor Required", "Manual Assignment", "Force Assignment"]).nullable().optional(),
  workflowStatus: z.enum(["Open", "Fill", "Force", "Close"]).optional(),
  status: z.enum(["Open", "Assigned", "Closed"]),
  assignedEmployeeId: z.string().nullable(),
  createdAt: z.string(),
  responses: z.array(overtimeResponseSchema)
})

export const overtimeEntrySchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  date: z.string(),
  hours: z.number(),
  reason: z.string(),
  source: z.enum(["Manual", "Detail"]),
  createdAt: z.string()
})

export const notificationPreferenceSchema = z.object({
  employeeId: z.string(),
  emailAddress: z.string(),
  phoneNumber: z.string(),
  allowEmail: z.boolean(),
  allowText: z.boolean(),
  overtimeAvailability: z.boolean(),
  overtimeAssignment: z.boolean(),
  patrolUpdates: z.boolean(),
  forceUpdates: z.boolean(),
  detailUpdates: z.boolean()
})

export const notificationCampaignSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.enum(["overtime_availability", "overtime_assignment"]),
  channel: z.enum(["email", "text", "both"]),
  recipientIds: z.array(z.string()),
  shiftRequestIds: z.array(z.string()),
  status: z.enum(["draft", "sent"]),
  createdAt: z.string(),
  sentAt: z.string().nullable().optional(),
  notes: z.string().nullable().optional()
})

export const notificationDeliverySchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  employeeId: z.string(),
  channel: z.enum(["email", "text"]),
  destination: z.string(),
  shiftRequestIds: z.array(z.string()),
  responseToken: z.string().nullable().optional(),
  subject: z.string(),
  body: z.string(),
  status: z.enum(["queued", "ready", "sent", "failed"]),
  providerMode: z.enum(["draft_only", "provider_ready"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  sentAt: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional()
})

export const overtimeBackupSchema = z.object({
  exportedAt: z.string().optional(),
  overtimeQueueIds: z.array(z.string()).default([]),
  overtimeShiftRequests: z.array(overtimeShiftRequestSchema).default([]),
  overtimeEntries: z.array(overtimeEntrySchema).default([]),
  notificationPreferences: z.array(notificationPreferenceSchema).default([]),
  notificationCampaigns: z.array(notificationCampaignSchema).default([]),
  notificationDeliveries: z.array(notificationDeliverySchema).default([]),
  notificationProviderConfig: notificationProviderConfigSchema.optional()
})

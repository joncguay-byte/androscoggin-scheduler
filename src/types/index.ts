export type AppRole =
  | "admin"
  | "sergeant"
  | "detective"
  | "deputy"

export type Rank =
  | "Sgt"
  | "Cpl"
  | "Deputy"
  | "Poland Deputy"
  | "Detective"

export type Team =
  | "Days A"
  | "Days B"
  | "Nights A"
  | "Nights B"
  | "CID"
  | "SRO"
  | "None"

export type ScheduleView =
  | "month"
  | "two_week"
  | "week"
  | "day"

export type ShiftType =
  | "Days"
  | "Nights"

export type PatrolPositionCode =
  | "SUP1"
  | "SUP2"
  | "DEP1"
  | "DEP2"
  | "POL"

export type PatrolStatus =
  | "Scheduled"
  | "Sick"
  | "Vacation"
  | "Court"
  | "Training"
  | "FMLA"
  | "Professional Leave"
  | "Bereavement"
  | "Call Out"
  | "Detail"
  | "Extra"
  | "Swap"
  | "Open Shift"
  | "Off"

export type Employee = {
  id: string
  firstName: string
  lastName: string
  rank: Rank
  team: Team
  defaultVehicle: string
  defaultShiftHours: string
  hireDate: string
  status: "Active" | "Inactive"
}

export type PatrolCellRecord = {
  id: string
  assignmentDate: string
  shiftType: ShiftType
  team: Team
  positionCode: PatrolPositionCode
  employeeId: string | null
  vehicle: string | null
  shiftHours: string | null
  status: PatrolStatus
  replacementEmployeeId: string | null
  replacementVehicle: string | null
  replacementHours: string | null
}

export type PatrolScheduleRow = {
  id?: string
  assignment_date: string
  shift_type: ShiftType
  position_code: PatrolPositionCode
  employee_id: string | null
  vehicle: string | null
  shift_hours: string | null
  status: string | null
  replacement_employee_id: string | null
  replacement_vehicle: string | null
  replacement_hours: string | null
}

export type DetailRecordStatus =
  | "Assigned"
  | "Accepted"
  | "Refused"

export type DetailRecord = {
  id: string
  employeeId: string
  date: string
  description: string
  hours: number
  status: DetailRecordStatus
  assignedAt: string
}

export type DetailQueueEventType =
  | "Assigned"
  | "Accepted"
  | "Refused"
  | "Skipped"
  | "Deleted"

export type DetailQueueEvent = {
  id: string
  type: DetailQueueEventType
  employeeId: string
  detailId?: string
  date: string
  description: string
  createdAt: string
}

export type OvertimeSource =
  | "Manual"
  | "Detail"

export type OvertimeEntry = {
  id: string
  employeeId: string
  date: string
  hours: number
  reason: string
  source: OvertimeSource
  createdAt: string
}

export type ForceHistoryRow = {
  employee_id: string
  forced_date: string
}

export type OvertimeShiftRequestStatus =
  | "Open"
  | "Assigned"
  | "Closed"

export type OvertimeAvailabilityStatus =
  | "Pending"
  | "Interested"
  | "Accepted"
  | "Declined"
  | "No Response"
  | "Assigned"

export type OvertimeShiftResponse = {
  employeeId: string
  status: OvertimeAvailabilityStatus
  updatedAt: string
}

export type OvertimeShiftRequest = {
  id: string
  source: "Patrol Open Shift" | "Manual"
  batchId?: string | null
  batchName?: string | null
  assignmentDate: string
  shiftType: ShiftType
  positionCode: PatrolPositionCode
  description: string
  offEmployeeId?: string | null
  offEmployeeLastName?: string | null
  offHours?: string | null
  selectionActive?: boolean
  workflowStatus?: "Open" | "Fill" | "Force" | "Close"
  status: OvertimeShiftRequestStatus
  assignedEmployeeId: string | null
  createdAt: string
  responses: OvertimeShiftResponse[]
}

export type NotificationChannel =
  | "email"
  | "text"
  | "both"

export type NotificationCampaignType =
  | "overtime_availability"
  | "overtime_assignment"

export type NotificationCampaignStatus =
  | "draft"
  | "sent"

export type NotificationDeliveryStatus =
  | "queued"
  | "ready"
  | "sent"
  | "failed"

export type NotificationDeliveryMethod =
  | "email"
  | "text"

export type NotificationProviderMode =
  | "draft_only"
  | "provider_ready"

export type NotificationProviderConfig = {
  mode: NotificationProviderMode
  emailWebhookUrl: string
  textWebhookUrl: string
  authToken: string
  senderName: string
  senderEmail: string
  senderPhone: string
}

export type NotificationPreference = {
  employeeId: string
  emailAddress: string
  phoneNumber: string
  allowEmail: boolean
  allowText: boolean
  overtimeAvailability: boolean
  overtimeAssignment: boolean
  patrolUpdates: boolean
  forceUpdates: boolean
  detailUpdates: boolean
}

export type NotificationCampaign = {
  id: string
  title: string
  type: NotificationCampaignType
  channel: NotificationChannel
  recipientIds: string[]
  shiftRequestIds: string[]
  status: NotificationCampaignStatus
  createdAt: string
  sentAt?: string | null
  notes?: string | null
}

export type NotificationDelivery = {
  id: string
  campaignId: string
  employeeId: string
  channel: NotificationDeliveryMethod
  destination: string
  shiftRequestIds: string[]
  responseToken?: string | null
  subject: string
  body: string
  status: NotificationDeliveryStatus
  providerMode: NotificationProviderMode
  createdAt: string
  updatedAt: string
  sentAt?: string | null
  errorMessage?: string | null
}

export type AppLayoutVariant =
  | "command-brass"
  | "ops-strip"
  | "clean-ledger"

export type ReportType =
  | "overtime"
  | "team_overtime"
  | "employee_overtime"
  | "detail_hours"
  | "cid_on_call"
  | "patrol_staffing"
  | "force_summary"
  | "force_history"
  | "force_individual"

export type AuditModule =
  | "App"
  | "Patrol"
  | "Overtime"
  | "Notifications"
  | "Mobile"
  | "CID"
  | "Force"
  | "Detail"
  | "Reports"
  | "Employees"
  | "Settings"
  | "Command"
  | "Audit"

export type AuditEvent = {
  id: string
  module: AuditModule
  action: string
  summary: string
  details?: string
  actorRole: AppRole
  createdAt: string
}

import { useEffect, useMemo, useRef, useState } from "react"

import Header from "./components/Header"
import SummaryCards from "./components/SummaryCards"
import ModuleTabs from "./components/ModuleTabs"
import LoginPage from "./modules/auth/LoginPage"

import { PatrolPage } from "./modules/patrol/PatrolPage"
import { CommandPage } from "./modules/command/CommandPage"
import { AuditPage } from "./modules/audit/AuditPage"
import { OvertimePage } from "./modules/overtime/OvertimePage"
import { NotificationsPage } from "./modules/notifications/NotificationsPage"
import { CIDPage } from "./modules/cid/CIDPage"
import { DetailPage } from "./modules/detail/DetailPage"
import EmployeesPage from "./modules/employees/EmployeesPage"
import { ForcePage } from "./modules/force/ForcePage"
import { ReportsPage } from "./modules/reports/ReportsPage"
import { SettingsPage } from "./modules/settings/SettingsPage"
import type { AppSettings, ReferenceSettings } from "./modules/settings/SettingsPage"
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/simple-ui"

import { initialEmployees } from "./data/employees"
import {
  getEffectiveCidOnCallForDate,
  toIsoDate
} from "./lib/cid-schedule"
import { fetchPatrolScheduleRange, invalidatePatrolScheduleCache } from "./lib/patrol-schedule"
import { loadSupabaseAppStates, saveSupabaseAppStates } from "./lib/app-state-sync"
import { loadSupabasePatrolOverrides, saveSupabasePatrolOverrides } from "./lib/patrol-overrides-sync"
import {
  loadSupabaseOvertimeNotificationsState,
  saveSupabaseOvertimeNotificationsState
} from "./lib/overtime-notifications-sync"
import { buildNotificationDeliveries } from "./lib/notifications"
import { getCurrentProfileRole, getLocalAccessUser, resolveAppRole, resolveDisplayName, signOut } from "./lib/auth"
import { isForceRequired, isShiftCovered } from "./lib/staffing-engine"
import { supabase } from "./lib/supabase"

import {
  Shield,
  LayoutDashboard,
  ScrollText,
  Hourglass,
  Users,
  AlertTriangle,
  FileText,
  Settings,
  Briefcase,
  Clock3,
  Bell
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type {
  AppLayoutVariant,
  AppRole,
  AuditEvent,
  DetailQueueEvent,
  DetailRecord,
  Employee,
  ForceHistoryRow,
  NotificationCampaign,
  NotificationProviderConfig,
  NotificationDelivery,
  NotificationPreference,
  PatrolPositionCode,
  ShiftType,
  OvertimeShiftRequest,
  OvertimeEntry
} from "./types"


type ModuleKey =
  | "command"
  | "audit"
  | "patrol"
  | "overtime"
  | "cid"
  | "force"
  | "detail"
  | "notifications"
  | "reports"
  | "employees"
  | "settings"


const moduleOrder: ModuleDefinition[] = [

  { key: "command", label: "Command", icon: LayoutDashboard },

  { key: "patrol", label: "Patrol", icon: Shield },

  { key: "overtime", label: "Overtime", icon: Hourglass },

  { key: "cid", label: "CID", icon: Clock3 },

  { key: "force", label: "Force", icon: AlertTriangle },

  { key: "detail", label: "Detail", icon: Briefcase },

  { key: "notifications", label: "Notifications", icon: Bell },

  { key: "reports", label: "Reports", icon: FileText },

  { key: "employees", label: "Employees", icon: Users },

  { key: "settings", label: "Settings", icon: Settings },

  { key: "audit", label: "Audit", icon: ScrollText }

]

const mobileModuleOrder: ModuleDefinition[] = [
  { key: "patrol", label: "Patrol", icon: Shield },
  { key: "cid", label: "CID", icon: Clock3 },
  { key: "force", label: "Force", icon: AlertTriangle },
  { key: "detail", label: "Detail", icon: Briefcase },
  { key: "notifications", label: "OT Response", icon: Bell }
]

type ModuleDefinition = {
  key: ModuleKey
  label: string
  icon: LucideIcon
}

type LayoutTheme = {
  pageBackground: string
  shellBackground: string
  shellBorder: string
  shellShadow: string
  sectionSpacing: string
}

type PersistedSchedulerState = {
  employees: Employee[]
  settings: AppSettings
  referenceSettings: ReferenceSettings
  cidRotationStartDate: string
  cidDailyOverrides: Record<string, string>
  detailRecords: DetailRecord[]
  detailQueueEvents: DetailQueueEvent[]
  detailQueueIds: string[]
  overtimeQueueIds: string[]
  overtimeShiftRequests: OvertimeShiftRequest[]
  overtimeEntries: OvertimeEntry[]
  notificationPreferences: NotificationPreference[]
  notificationCampaigns: NotificationCampaign[]
  notificationDeliveries: NotificationDelivery[]
  notificationProviderConfig: NotificationProviderConfig
  auditEvents: AuditEvent[]
}

type PersistedStaffState = Pick<PersistedSchedulerState, "employees" | "settings" | "referenceSettings">
type PersistedCidDetailState = Pick<
  PersistedSchedulerState,
  "cidRotationStartDate" | "cidDailyOverrides" | "detailRecords" | "detailQueueEvents" | "detailQueueIds"
>
type PersistedAuditState = Pick<PersistedSchedulerState, "auditEvents">

const layoutVariants: { value: AppLayoutVariant, label: string }[] = [
  { value: "command-brass", label: "Command Brass" },
  { value: "ops-strip", label: "Operations Strip" },
  { value: "clean-ledger", label: "Clean Ledger" }
]

const layoutThemes: Record<AppLayoutVariant, LayoutTheme> = {
  "command-brass": {
    pageBackground: "linear-gradient(180deg, #f4efe2 0%, #efe7d3 100%)",
    shellBackground: "#fffaf0",
    shellBorder: "1px solid #c7b68a",
    shellShadow: "0 16px 40px rgba(68, 47, 20, 0.12)",
    sectionSpacing: "24px"
  },
  "ops-strip": {
    pageBackground: "linear-gradient(180deg, #e7edf5 0%, #d8e1ee 100%)",
    shellBackground: "#f7fbff",
    shellBorder: "1px solid #9fb3cc",
    shellShadow: "0 18px 42px rgba(15, 23, 42, 0.12)",
    sectionSpacing: "20px"
  },
  "clean-ledger": {
    pageBackground: "linear-gradient(180deg, #f7f7f6 0%, #ecece8 100%)",
    shellBackground: "#ffffff",
    shellBorder: "1px solid #d4d4cf",
    shellShadow: "0 12px 28px rgba(17, 24, 39, 0.08)",
    sectionSpacing: "18px"
  }
}

const CID_ROTATION_START_STORAGE_KEY = "androscoggin-cid-rotation-start-date"
const EMPLOYEES_STORAGE_KEY = "androscoggin-employees"
const SETTINGS_STORAGE_KEY = "androscoggin-settings"
const REFERENCE_SETTINGS_STORAGE_KEY = "androscoggin-reference-settings"
const CID_OVERRIDES_STORAGE_KEY = "androscoggin-cid-daily-overrides"
const DETAIL_RECORDS_STORAGE_KEY = "androscoggin-detail-records"
const DETAIL_QUEUE_EVENTS_STORAGE_KEY = "androscoggin-detail-queue-events"
const DETAIL_QUEUE_IDS_STORAGE_KEY = "androscoggin-detail-queue-ids"
const OVERTIME_QUEUE_IDS_STORAGE_KEY = "androscoggin-overtime-queue-ids"
const OVERTIME_QUEUE_VERSION_STORAGE_KEY = "androscoggin-overtime-queue-version"
const OVERTIME_NOTIFICATIONS_SAFETY_SNAPSHOT_KEY = "androscoggin-overtime-notifications-safety-snapshot"
const NOTIFICATION_PROVIDER_CONFIG_STORAGE_KEY = "androscoggin-notification-provider-config"
const PROVIDER_CONFIG_DRAFT_STORAGE_KEY = "androscoggin-notification-provider-config-draft"
const AUDIT_EVENTS_STORAGE_KEY = "androscoggin-audit-events"
const SUPABASE_APP_STATE_KEYS = {
  staff: "scheduler_staff_state",
  cidDetail: "scheduler_cid_detail_state",
  audit: "scheduler_audit_state"
} as const
const LEGACY_SUPABASE_APP_STATE_KEY = "scheduler_state"
const DEFAULT_CID_ROTATION_START_DATE = "2026-03-23"
const CURRENT_OVERTIME_QUEUE_VERSION = "6"
function readStoredValue<T>(key: string, fallback: T) {
  if (typeof window === "undefined") return fallback

  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

function readStoredNotificationProviderConfig() {
  const fallback: NotificationProviderConfig = {
    mode: "draft_only",
    emailWebhookUrl: "",
    textWebhookUrl: "",
    authToken: "",
    senderName: "Androscoggin Scheduler",
    senderEmail: "",
    senderPhone: ""
  }

  if (typeof window === "undefined") return fallback

  try {
    const primaryRaw = window.localStorage.getItem(NOTIFICATION_PROVIDER_CONFIG_STORAGE_KEY)
    if (primaryRaw) {
      const parsed = JSON.parse(primaryRaw) as NotificationProviderConfig
      if (hasMeaningfulNotificationProviderConfig(parsed)) return parsed
    }

    const draftRaw = window.localStorage.getItem(PROVIDER_CONFIG_DRAFT_STORAGE_KEY)
    if (draftRaw) {
      const parsed = JSON.parse(draftRaw) as NotificationProviderConfig
      if (hasMeaningfulNotificationProviderConfig(parsed)) return parsed
    }
  } catch {
    return fallback
  }

  return fallback
}

function shouldResetStoredOvertimeQueue() {
  if (typeof window === "undefined") return false
  return window.localStorage.getItem(OVERTIME_QUEUE_VERSION_STORAGE_KEY) !== CURRENT_OVERTIME_QUEUE_VERSION
}

function writeOvertimeNotificationsSafetySnapshot(value: unknown) {
  if (typeof window === "undefined") return

  try {
    window.localStorage.setItem(
      OVERTIME_NOTIFICATIONS_SAFETY_SNAPSHOT_KEY,
      JSON.stringify({
        savedAt: new Date().toISOString(),
        data: value
      })
    )
  } catch {
    // Ignore storage backup failures. Supabase remains the primary source of truth.
  }
}

function readOvertimeNotificationsSafetySnapshot() {
  if (typeof window === "undefined") return null

  try {
    const raw = window.localStorage.getItem(OVERTIME_NOTIFICATIONS_SAFETY_SNAPSHOT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { savedAt?: string; data?: unknown }
    return parsed?.data ?? null
  } catch {
    return null
  }
}

function hasMeaningfulNotificationProviderConfig(config: NotificationProviderConfig | null | undefined) {
  if (!config) return false

  return (
    config.emailWebhookUrl.trim().length > 0 ||
    config.textWebhookUrl.trim().length > 0 ||
    config.authToken.trim().length > 0 ||
    config.senderEmail.trim().length > 0 ||
    config.senderPhone.trim().length > 0
  )
}

function getPatrolSummaryRowKey(row: {
  assignment_date: string
  shift_type: "Days" | "Nights"
  position_code: "SUP1" | "SUP2" | "DEP1" | "DEP2" | "POL"
}) {
  return `${row.assignment_date}-${row.shift_type}-${row.position_code}`
}

function isActivePatrolTimeOffStatus(status: string | null | undefined) {
  return Boolean(status) && status !== "Scheduled" && status !== "Open Shift"
}

function buildPatrolGeneratedRequestId(
  assignmentDate: string,
  shiftType: ShiftType,
  positionCode: PatrolPositionCode
) {
  return `patrol-open-${assignmentDate}-${shiftType}-${positionCode}`
}

function reconcilePatrolGeneratedOvertimeRequests(
  currentRequests: OvertimeShiftRequest[],
  overrideRows: Array<{
    assignment_date: string
    shift_type: ShiftType
    position_code: PatrolPositionCode
    employee_id: string | null
    shift_hours: string | null
    status: string | null
    replacement_employee_id: string | null
  }>,
  employees: Employee[]
) {
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]))
  const activeOverrideMap = new Map(
    overrideRows
      .filter((row) => isActivePatrolTimeOffStatus(row.status))
      .map((row) => [getPatrolSummaryRowKey(row), row])
  )

  const preservedNonPatrol = currentRequests.filter((request) => request.source !== "Patrol Open Shift")
  const existingPatrolRequests = new Map(
    currentRequests
      .filter((request) => request.source === "Patrol Open Shift")
      .map((request) => [`${request.assignmentDate}-${request.shiftType}-${request.positionCode}`, request])
  )

  const reconciledPatrolRequests: OvertimeShiftRequest[] = Array.from(activeOverrideMap.entries()).map(([key, row]) => {
    const existing = existingPatrolRequests.get(key)
    const offEmployee = row.employee_id ? employeeById.get(row.employee_id) || null : null
    const assignedEmployeeId = row.replacement_employee_id || existing?.assignedEmployeeId || null
    const assignedStatus = assignedEmployeeId ? "Assigned" : "Open"
    const workflowStatus: OvertimeShiftRequest["workflowStatus"] =
      existing?.workflowStatus === "Force" || existing?.workflowStatus === "Close"
        ? existing.workflowStatus
        : assignedEmployeeId
          ? "Fill"
          : "Open"
    const requestStatus: OvertimeShiftRequest["status"] =
      existing?.workflowStatus === "Close"
        ? "Closed"
        : assignedStatus

    return {
      id: existing?.id || buildPatrolGeneratedRequestId(row.assignment_date, row.shift_type, row.position_code),
      source: "Patrol Open Shift" as const,
      batchId: existing?.batchId || null,
      batchName: existing?.batchName || null,
      assignmentDate: row.assignment_date,
      shiftType: row.shift_type,
      positionCode: row.position_code,
      description: existing?.description || `${row.position_code} time off`,
      offEmployeeId: row.employee_id || existing?.offEmployeeId || null,
      offEmployeeLastName: offEmployee?.lastName || existing?.offEmployeeLastName || null,
      offHours: row.shift_hours || existing?.offHours || null,
      offReason: row.status || existing?.offReason || null,
      assignedHours: existing?.assignedHours || null,
      selectionActive: existing?.selectionActive ?? true,
      manuallyQueued: existing?.manuallyQueued ?? false,
      autoAssignReason: existing?.autoAssignReason ?? null,
      workflowStatus,
      status: requestStatus,
      assignedEmployeeId,
      createdAt: existing?.createdAt || new Date().toISOString(),
      responses: existing?.responses || []
    }
  })

  return [...preservedNonPatrol, ...reconciledPatrolRequests].sort(
    (a, b) =>
      a.assignmentDate.localeCompare(b.assignmentDate) ||
      a.shiftType.localeCompare(b.shiftType) ||
      a.positionCode.localeCompare(b.positionCode) ||
      a.id.localeCompare(b.id)
  )
}

function mergePatrolSummaryRows<T extends {
  assignment_date: string
  shift_type: "Days" | "Nights"
  position_code: "SUP1" | "SUP2" | "DEP1" | "DEP2" | "POL"
}>(baseRows: T[], overrideRows: T[]) {
  const merged = new Map<string, T>()

  for (const row of baseRows) {
    merged.set(getPatrolSummaryRowKey(row), row)
  }

  for (const row of overrideRows) {
    merged.set(getPatrolSummaryRowKey(row), row)
  }

  return [...merged.values()].sort((a, b) => {
    if (a.assignment_date !== b.assignment_date) return a.assignment_date.localeCompare(b.assignment_date)
    if (a.shift_type !== b.shift_type) return a.shift_type.localeCompare(b.shift_type)
    return a.position_code.localeCompare(b.position_code)
  })
}

function getCalendarDayDiff(date: Date, anchor: Date) {
  const utcDate = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const utcAnchor = Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
  return Math.round((utcDate - utcAnchor) / 86400000)
}

function getActiveTeamForSummary(date: Date, shift: ShiftType) {
  const pitman = [0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0]
  const start = new Date("2026-03-01T12:00:00")
  const diff = getCalendarDayDiff(date, start)
  const idx = pitman[((diff % pitman.length) + pitman.length) % pitman.length]

  if (shift === "Days") return idx ? "Days A" : "Days B"
  return idx ? "Nights A" : "Nights B"
}

function getDefaultEmployeeForSummaryPosition(
  employees: Employee[],
  shift: ShiftType,
  date: Date,
  positionCode: PatrolPositionCode
) {
  const activeTeam = getActiveTeamForSummary(date, shift)
  const teamEmployees = employees.filter(
    (employee) => employee.status === "Active" && employee.team === activeTeam
  )

  switch (positionCode) {
    case "SUP1":
      return teamEmployees.find((employee) => employee.rank === "Sgt") || null
    case "SUP2":
      return teamEmployees.find((employee) => employee.rank === "Cpl") || null
    case "DEP1":
      return teamEmployees.filter((employee) => employee.rank === "Deputy")[0] || null
    case "DEP2":
      return teamEmployees.filter((employee) => employee.rank === "Deputy")[1] || null
    case "POL":
      return teamEmployees.find((employee) => employee.rank === "Poland Deputy") || null
    default:
      return null
  }
}


export default function App() {
  type PatrolScheduleSummaryRow = {
    id?: string
    assignment_date: string
    shift_type: "Days" | "Nights"
    position_code: "SUP1" | "SUP2" | "DEP1" | "DEP2" | "POL"
    employee_id: string | null
    vehicle: string | null
    shift_hours: string | null
    status: string | null
    replacement_employee_id: string | null
    replacement_vehicle: string | null
    replacement_hours: string | null
  }

  function buildInitialDetailQueue(staff: Employee[]) {
    return [...staff]
      .sort((a, b) => a.hireDate.localeCompare(b.hireDate))
      .map((employee) => employee.id)
  }

  function buildInitialOvertimeQueue(staff: Employee[]) {
    return [...staff]
      .filter((employee) => employee.status === "Active")
      .sort((a, b) => a.hireDate.localeCompare(b.hireDate))
      .map((employee) => employee.id)
  }

  function buildInitialNotificationPreferences(staff: Employee[]) {
    return [...staff]
      .filter((employee) => employee.status === "Active")
      .sort((a, b) => a.lastName.localeCompare(b.lastName))
      .map((employee) => ({
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
  }

  function hasMeaningfulOvertimeQueueActivity(
    requests: OvertimeShiftRequest[],
    entries: OvertimeEntry[]
  ) {
    if (entries.length > 0) return true

    return requests.some(
      (request) =>
        !!request.assignedEmployeeId ||
        request.responses.some((response) =>
          response.status === "Accepted" ||
          response.status === "Declined" ||
          response.status === "No Response" ||
          response.status === "Assigned"
        )
    )
  }

  function buildDefaultNotificationProviderConfig(): NotificationProviderConfig {
    return {
      mode: "draft_only",
      emailWebhookUrl: "",
      textWebhookUrl: "",
      authToken: "",
      senderName: "Androscoggin Scheduler",
      senderEmail: "",
      senderPhone: ""
    }
  }

  function normalizePersistedState(
    payload: Partial<PersistedSchedulerState> | null,
    fallback: PersistedSchedulerState
  ): PersistedSchedulerState {
    return {
      employees: payload?.employees ?? fallback.employees,
      settings: payload?.settings ?? fallback.settings,
      referenceSettings: payload?.referenceSettings ?? fallback.referenceSettings,
      cidRotationStartDate: payload?.cidRotationStartDate ?? fallback.cidRotationStartDate,
      cidDailyOverrides: payload?.cidDailyOverrides ?? fallback.cidDailyOverrides,
      detailRecords: payload?.detailRecords ?? fallback.detailRecords,
      detailQueueEvents: payload?.detailQueueEvents ?? fallback.detailQueueEvents,
      detailQueueIds: payload?.detailQueueIds ?? fallback.detailQueueIds,
      overtimeQueueIds: shouldResetStoredOvertimeQueue()
        ? fallback.overtimeQueueIds
        : payload?.overtimeQueueIds ?? fallback.overtimeQueueIds,
      overtimeShiftRequests: payload?.overtimeShiftRequests ?? fallback.overtimeShiftRequests,
      overtimeEntries: payload?.overtimeEntries ?? fallback.overtimeEntries,
      notificationPreferences: payload?.notificationPreferences ?? fallback.notificationPreferences,
      notificationCampaigns: payload?.notificationCampaigns ?? fallback.notificationCampaigns,
      notificationDeliveries: payload?.notificationDeliveries ?? fallback.notificationDeliveries,
      notificationProviderConfig: payload?.notificationProviderConfig ?? fallback.notificationProviderConfig,
      auditEvents: payload?.auditEvents ?? fallback.auditEvents
    }
  }

  const defaultSettings: AppSettings = {
    departmentTitle: "Androscoggin Patrol Schedule",
    defaultLayoutVariant: "command-brass",
    defaultPatrolView: "month",
    defaultReportType: "overtime",
    printHeaderTitle: "Androscoggin Patrol Schedule",
    visibleModules: moduleOrder.map((module) => module.key),
    useCustomColors: false,
    colors: {
      accent: "#d4af37",
      border: "#112b5c",
      cardBackground: "#fffdf7",
      cardBorder: "#d8c79d",
      cellBackground: "#ffffff",
      cellHighlight: "#fde68a"
    }
  }
  const defaultReferenceSettings: ReferenceSettings = {
    vehicles: initialEmployees
      .map((employee) => employee.defaultVehicle)
      .filter((value, index, array) => array.indexOf(value) === index),
    shiftTemplates: ["5a-5p", "5p-5a", "8a-4p"],
    teams: ["Days A", "Days B", "Nights A", "Nights B", "CID", "SRO", "None"],
    ranks: ["Sgt", "Cpl", "Deputy", "Poland Deputy", "Detective"],
    patrolStatuses: [
      "Scheduled",
      "Sick",
      "Vacation",
      "Court",
      "Training",
      "FMLA",
      "Professional Leave",
      "Bereavement",
      "Call Out",
      "Detail",
      "Extra",
      "Swap",
      "Open Shift",
      "Off"
    ]
  }

  const [employees, setEmployees] = useState<Employee[]>(() =>
    readStoredValue<Employee[]>(EMPLOYEES_STORAGE_KEY, initialEmployees)
  )
  const [authLoading, setAuthLoading] = useState(true)
  const [authUser, setAuthUser] = useState<{
    email?: string | null
    user_metadata?: Record<string, unknown> | null
    app_metadata?: Record<string, unknown> | null
  } | null>(null)
  const [profileRole, setProfileRole] = useState<AppRole | null>(null)
  const [settings, setSettings] = useState<AppSettings>(() =>
    readStoredValue<AppSettings>(SETTINGS_STORAGE_KEY, defaultSettings)
  )
  const [referenceSettings, setReferenceSettings] = useState<ReferenceSettings>(() =>
    readStoredValue<ReferenceSettings>(REFERENCE_SETTINGS_STORAGE_KEY, defaultReferenceSettings)
  )
  const [layoutVariant, setLayoutVariant] = useState<AppLayoutVariant>("command-brass")
  const [cidRotationStartDate, setCidRotationStartDate] = useState(() => {
    if (typeof window === "undefined") {
      return DEFAULT_CID_ROTATION_START_DATE
    }

    return window.localStorage.getItem(CID_ROTATION_START_STORAGE_KEY) || DEFAULT_CID_ROTATION_START_DATE
  })
  const [cidDailyOverrides, setCidDailyOverrides] = useState<Record<string, string>>(() =>
    readStoredValue<Record<string, string>>(CID_OVERRIDES_STORAGE_KEY, {})
  )
  const [detailRecords, setDetailRecords] = useState<DetailRecord[]>(() =>
    readStoredValue<DetailRecord[]>(DETAIL_RECORDS_STORAGE_KEY, [])
  )
  const [detailQueueEvents, setDetailQueueEvents] = useState<DetailQueueEvent[]>(() =>
    readStoredValue<DetailQueueEvent[]>(DETAIL_QUEUE_EVENTS_STORAGE_KEY, [])
  )
  const [detailQueueIds, setDetailQueueIds] = useState<string[]>(() =>
    readStoredValue<string[]>(DETAIL_QUEUE_IDS_STORAGE_KEY, buildInitialDetailQueue(initialEmployees))
  )
  const [overtimeQueueIds, setOvertimeQueueIds] = useState<string[]>(() =>
    shouldResetStoredOvertimeQueue()
      ? buildInitialOvertimeQueue(initialEmployees)
      : readStoredValue<string[]>(OVERTIME_QUEUE_IDS_STORAGE_KEY, buildInitialOvertimeQueue(initialEmployees))
  )
  const [overtimeShiftRequests, setOvertimeShiftRequests] = useState<OvertimeShiftRequest[]>([])
  const [overtimeEntries, setOvertimeEntries] = useState<OvertimeEntry[]>([])
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreference[]>([])
  const [notificationCampaigns, setNotificationCampaigns] = useState<NotificationCampaign[]>([])
  const [notificationDeliveries, setNotificationDeliveries] = useState<NotificationDelivery[]>([])
  const [notificationProviderConfig, setNotificationProviderConfig] = useState<NotificationProviderConfig>(() =>
    readStoredNotificationProviderConfig()
  )
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(() =>
    readStoredValue<AuditEvent[]>(AUDIT_EVENTS_STORAGE_KEY, [])
  )
  const [patrolSummaryRows, setPatrolSummaryRows] = useState<PatrolScheduleSummaryRow[]>([])
  const [localPatrolOverrideRows, setLocalPatrolOverrideRows] = useState<PatrolScheduleSummaryRow[]>([])
  const [forceHistoryRows, setForceHistoryRows] = useState<ForceHistoryRow[]>([])
  const [activeSummaryCard, setActiveSummaryCard] = useState<"open_shifts" | "staffing_alerts" | null>(null)
  const [responseTokenFromQuery, setResponseTokenFromQuery] = useState("")
  const [isMobileLayout, setIsMobileLayout] = useState(false)
  const [appStateSyncStatus, setAppStateSyncStatus] = useState<{
    mode: "checking" | "connected" | "local"
    message: string
  }>({
    mode: "checking",
    message: "Checking Supabase sync for local modules..."
  })
  const [patrolOverridesSyncReady, setPatrolOverridesSyncReady] = useState(false)
  const [overtimeNotificationsSyncReady, setOvertimeNotificationsSyncReady] = useState(false)
  const [overtimeNotificationsSyncError, setOvertimeNotificationsSyncError] = useState("")

  const [activeModule, setActiveModule] =
    useState<ModuleKey>("patrol")
  const [notificationDraftShiftIds, setNotificationDraftShiftIds] = useState<string[]>([])
  const [notificationDraftRecipientIds, setNotificationDraftRecipientIds] = useState<string[]>([])
  const hasHydratedSupabaseState = useRef(false)
  const hasHydratedPatrolOverrides = useRef(false)
  const hasHydratedOvertimeNotifications = useRef(false)
  const hasHydratedNotificationProviderConfig = useRef(false)
  const lastSupabaseSnapshotRef = useRef("")
  const lastSupabasePatrolOverridesRef = useRef("")
  const lastSupabaseOvertimeNotificationsRef = useRef("")
  const lastSupabaseNotificationProviderConfigRef = useRef("")
  const lastSupabaseSyncActorRef = useRef("")
  const lastSupabasePatrolSyncActorRef = useRef("")
  const lastSupabaseOvertimeNotificationsActorRef = useRef("")
  const patrolSummaryRefreshTimeoutRef = useRef<number | null>(null)
  const forceHistoryRefreshTimeoutRef = useRef<number | null>(null)
  const overtimeNotificationsRefreshTimeoutRef = useRef<number | null>(null)
  const currentUserRole = useMemo<AppRole>(() => profileRole || resolveAppRole(authUser), [authUser, profileRole])
  const currentUserDisplayName = useMemo(() => resolveDisplayName(authUser), [authUser])
  const currentSyncActorKey = useMemo(
    () => `${authUser && typeof authUser.email === "string" ? authUser.email : "anonymous"}|${currentUserRole}`,
    [authUser, currentUserRole]
  )
  const effectivePatrolSummaryRows = useMemo(
    () => mergePatrolSummaryRows(patrolSummaryRows, localPatrolOverrideRows),
    [patrolSummaryRows, localPatrolOverrideRows]
  )
  const activeEmployeeMap = useMemo(
    () => new Map(employees.filter((employee) => employee.status === "Active").map((employee) => [employee.id, employee])),
    [employees]
  )
  const notificationPreferenceMap = useMemo(
    () => new Map(notificationPreferences.map((entry) => [entry.employeeId, entry])),
    [notificationPreferences]
  )
  const overtimeRequestMap = useMemo(
    () => new Map(overtimeShiftRequests.map((request) => [request.id, request])),
    [overtimeShiftRequests]
  )

  function openNotificationsForShiftIds(shiftIds: string[], recipientIds: string[] = []) {
    setNotificationDraftShiftIds(shiftIds)
    setNotificationDraftRecipientIds(recipientIds)
    setActiveModule("notifications")
  }

  function queueAssignmentNoticeForShift(requestId: string, employeeId: string) {
    const request = overtimeRequestMap.get(requestId)
    const employee = activeEmployeeMap.get(employeeId)
    if (!request || !employee) return

    const campaign: NotificationCampaign = {
      id: crypto.randomUUID(),
      title: `Assignment Notice ${request.assignmentDate}`,
      type: "overtime_assignment",
      channel: "both",
      recipientIds: [employeeId],
      shiftRequestIds: [requestId],
      status: "sent",
      createdAt: new Date().toISOString(),
      sentAt: new Date().toISOString(),
      notes: "Queued automatically after overtime assignment"
    }

    const { deliveries } = buildNotificationDeliveries({
      campaign,
      recipients: [employeeId],
      employeeMap: activeEmployeeMap,
      preferencesMap: notificationPreferenceMap,
      shiftMap: overtimeRequestMap
    })

    setNotificationCampaigns((current) => [campaign, ...current])
    setNotificationDeliveries((current) => [...deliveries, ...current])
    appendAuditEvent(
      "Notifications",
      "Assignment Notice Queued",
      `Queued assignment notice for ${employee.firstName} ${employee.lastName}.`,
      `${request.assignmentDate} | ${request.shiftType} | ${request.positionCode}`
    )
  }

  async function pushLocalOvertimeToSupabase() {
    const queuePayload = overtimeQueueIds.map((employeeId, index) => ({
      employee_id: employeeId,
      queue_position: index,
      updated_at: new Date().toISOString()
    }))
    const requestsPayload = overtimeShiftRequests.map((request) => ({
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
      selection_active: Boolean(request.selectionActive),
      workflow_status: request.workflowStatus || null,
      status: request.status,
      assigned_employee_id: request.assignedEmployeeId || null,
      created_at: request.createdAt,
      responses: request.responses
    }))
    const entriesPayload = overtimeEntries.map((entry) => ({
      id: entry.id,
      employee_id: entry.employeeId,
      date: entry.date,
      hours: entry.hours,
      reason: entry.reason,
      source: entry.source,
      created_at: entry.createdAt
    }))

    const queueResult = queuePayload.length > 0
      ? await supabase.from("overtime_queue").upsert(queuePayload, { onConflict: "employee_id" })
      : { error: null }
    if (queueResult.error) {
      window.alert(`Failed to push overtime queue: ${queueResult.error.message}`)
      appendAuditEvent(
        "Settings",
        "Push Local Overtime Failed",
        "Failed to copy the overtime queue into Supabase.",
        queueResult.error.message
      )
      return
    }

    const requestsResult = requestsPayload.length > 0
      ? await supabase.from("overtime_shift_requests").upsert(requestsPayload, { onConflict: "id" })
      : { error: null }
    if (requestsResult.error) {
      window.alert(`Failed to push overtime shifts: ${requestsResult.error.message}`)
      appendAuditEvent(
        "Settings",
        "Push Local Overtime Failed",
        "Failed to copy overtime shift requests into Supabase.",
        requestsResult.error.message
      )
      return
    }

    const entriesResult = entriesPayload.length > 0
      ? await supabase.from("overtime_entries").upsert(entriesPayload, { onConflict: "id" })
      : { error: null }
    if (entriesResult.error) {
      window.alert(`Failed to push overtime entries: ${entriesResult.error.message}`)
      appendAuditEvent(
        "Settings",
        "Push Local Overtime Failed",
        "Failed to copy overtime entries into Supabase.",
        entriesResult.error.message
      )
      return
    }

    window.alert("Local overtime queue and shifts were pushed to Supabase successfully.")
    appendAuditEvent(
      "Settings",
      "Pushed Local Overtime To Supabase",
      "Copied local overtime queue and shift data into Supabase."
    )
  }

  function restoreOvertimeSafetySnapshot() {
    const snapshot = readOvertimeNotificationsSafetySnapshot() as PersistedSchedulerState | null
    if (!snapshot) {
      window.alert("No overtime safety snapshot is available on this device yet.")
      return
    }

    setOvertimeQueueIds(Array.isArray(snapshot.overtimeQueueIds) ? snapshot.overtimeQueueIds : [])
    setOvertimeShiftRequests(Array.isArray(snapshot.overtimeShiftRequests) ? snapshot.overtimeShiftRequests : [])
    setOvertimeEntries(Array.isArray(snapshot.overtimeEntries) ? snapshot.overtimeEntries : [])
    setNotificationPreferences(Array.isArray(snapshot.notificationPreferences) ? snapshot.notificationPreferences : [])
    setNotificationCampaigns(Array.isArray(snapshot.notificationCampaigns) ? snapshot.notificationCampaigns : [])
    setNotificationDeliveries(Array.isArray(snapshot.notificationDeliveries) ? snapshot.notificationDeliveries : [])
    if (snapshot.notificationProviderConfig) {
      setNotificationProviderConfig(snapshot.notificationProviderConfig)
    }

    window.alert("Restored overtime and notification data from the local safety snapshot.")
    appendAuditEvent(
      "Settings",
      "Restored Overtime Safety Snapshot",
      "Recovered overtime, notifications, and provider config from the local safety snapshot."
    )
  }

  function downloadOvertimeBackup() {
    if (typeof window === "undefined") return

    const payload = {
      exportedAt: new Date().toISOString(),
      overtimeQueueIds,
      overtimeShiftRequests,
      overtimeEntries,
      notificationPreferences,
      notificationCampaigns,
      notificationDeliveries,
      notificationProviderConfig
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `androscoggin-overtime-backup-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    window.URL.revokeObjectURL(url)

    appendAuditEvent(
      "Settings",
      "Downloaded Overtime Backup",
      "Downloaded a manual backup of overtime, notifications, and provider config."
    )
  }

  function importOvertimeBackup(file: File) {
    const reader = new FileReader()

    reader.onload = () => {
      try {
        const raw = typeof reader.result === "string" ? reader.result : ""
        const parsed = JSON.parse(raw) as Partial<PersistedSchedulerState>

        setOvertimeQueueIds(Array.isArray(parsed.overtimeQueueIds) ? parsed.overtimeQueueIds : [])
        setOvertimeShiftRequests(Array.isArray(parsed.overtimeShiftRequests) ? parsed.overtimeShiftRequests : [])
        setOvertimeEntries(Array.isArray(parsed.overtimeEntries) ? parsed.overtimeEntries : [])
        setNotificationPreferences(Array.isArray(parsed.notificationPreferences) ? parsed.notificationPreferences : [])
        setNotificationCampaigns(Array.isArray(parsed.notificationCampaigns) ? parsed.notificationCampaigns : [])
        setNotificationDeliveries(Array.isArray(parsed.notificationDeliveries) ? parsed.notificationDeliveries : [])
        if (parsed.notificationProviderConfig) {
          setNotificationProviderConfig(parsed.notificationProviderConfig)
        }

        writeOvertimeNotificationsSafetySnapshot({
          overtimeQueueIds: Array.isArray(parsed.overtimeQueueIds) ? parsed.overtimeQueueIds : [],
          overtimeShiftRequests: Array.isArray(parsed.overtimeShiftRequests) ? parsed.overtimeShiftRequests : [],
          overtimeEntries: Array.isArray(parsed.overtimeEntries) ? parsed.overtimeEntries : [],
          notificationPreferences: Array.isArray(parsed.notificationPreferences) ? parsed.notificationPreferences : [],
          notificationCampaigns: Array.isArray(parsed.notificationCampaigns) ? parsed.notificationCampaigns : [],
          notificationDeliveries: Array.isArray(parsed.notificationDeliveries) ? parsed.notificationDeliveries : [],
          notificationProviderConfig: parsed.notificationProviderConfig || buildDefaultNotificationProviderConfig()
        })

        window.alert("Imported overtime backup file successfully.")
        appendAuditEvent(
          "Settings",
          "Imported Overtime Backup",
          `Imported overtime backup from ${file.name}.`
        )
      } catch {
        window.alert("That backup file could not be read.")
      }
    }

    reader.onerror = () => {
      window.alert("That backup file could not be read.")
    }

    reader.readAsText(file)
  }

  function applyOvertimeNotificationsSyncData(data: Awaited<ReturnType<typeof loadSupabaseOvertimeNotificationsState>>["data"]) {
    if (!data) return

    const initialQueue = buildInitialOvertimeQueue(employees)
    const defaultPreferences = buildInitialNotificationPreferences(employees)

    const nextQueueIds =
      data.overtimeQueueIds.length > 0
        ? data.overtimeQueueIds
        : (overtimeQueueIds.length > 0 ? overtimeQueueIds : initialQueue)

    const nextShiftRequests = data.overtimeShiftRequests

    const nextEntries = data.overtimeEntries
    const nextPreferences =
      data.notificationPreferences.length > 0
        ? data.notificationPreferences
        : defaultPreferences
    const nextCampaigns = data.notificationCampaigns
    const nextDeliveries = data.notificationDeliveries
    const storedProviderConfig = readStoredNotificationProviderConfig()
    const nextProviderConfig = hasMeaningfulNotificationProviderConfig(data.notificationProviderConfig)
      ? data.notificationProviderConfig!
      : hasMeaningfulNotificationProviderConfig(storedProviderConfig)
        ? storedProviderConfig
        : hasMeaningfulNotificationProviderConfig(notificationProviderConfig)
          ? notificationProviderConfig
          : buildDefaultNotificationProviderConfig()

    setOvertimeQueueIds(nextQueueIds)
    setOvertimeShiftRequests(nextShiftRequests)
    setOvertimeEntries(nextEntries)
    setNotificationPreferences(nextPreferences)
    setNotificationCampaigns(nextCampaigns)
    setNotificationDeliveries(nextDeliveries)
    setNotificationProviderConfig(nextProviderConfig)
    hasHydratedNotificationProviderConfig.current = true

    lastSupabaseOvertimeNotificationsRef.current = JSON.stringify({
      overtimeQueueIds: nextQueueIds,
      overtimeShiftRequests: nextShiftRequests,
      overtimeEntries: nextEntries,
      notificationPreferences: nextPreferences,
      notificationCampaigns: nextCampaigns,
      notificationDeliveries: nextDeliveries
    })
    lastSupabaseNotificationProviderConfigRef.current = JSON.stringify(nextProviderConfig)
    writeOvertimeNotificationsSafetySnapshot({
      overtimeQueueIds: nextQueueIds,
      overtimeShiftRequests: nextShiftRequests,
      overtimeEntries: nextEntries,
      notificationPreferences: nextPreferences,
      notificationCampaigns: nextCampaigns,
      notificationDeliveries: nextDeliveries,
      notificationProviderConfig: nextProviderConfig
    })
  }
  const coverageEvaluatedPatrolSummaryRows = useMemo(() => {
    const positions: PatrolPositionCode[] = ["SUP1", "SUP2", "DEP1", "DEP2", "POL"]
    const shifts: ShiftType[] = ["Days", "Nights"]
    const today = new Date()
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const end = new Date(start)
    end.setDate(end.getDate() + 45)

    const seededRows: PatrolScheduleSummaryRow[] = []

    for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      for (const shift of shifts) {
        for (const position of positions) {
          const assignedEmployee = getDefaultEmployeeForSummaryPosition(employees, shift, cursor, position)
          const shiftHours = shift === "Days" ? "5a-5p" : "5p-5a"

          seededRows.push({
            assignment_date: toIsoDate(cursor),
            shift_type: shift,
            position_code: position,
            employee_id: assignedEmployee?.id || null,
            vehicle: assignedEmployee?.defaultVehicle || null,
            shift_hours: assignedEmployee?.defaultShiftHours || shiftHours,
            status: assignedEmployee ? "Scheduled" : "Open Shift",
            replacement_employee_id: null,
            replacement_vehicle: null,
            replacement_hours: assignedEmployee?.defaultShiftHours || shiftHours
          })
        }
      }
    }

    return mergePatrolSummaryRows(seededRows, effectivePatrolSummaryRows)
  }, [effectivePatrolSummaryRows, employees])

  useEffect(() => {
    let active = true

    async function hydrateAuth() {
      try {
        const authResult = await Promise.race([
          supabase.auth.getUser(),
          new Promise<{ data: { user: null } }>((resolve) =>
            window.setTimeout(() => resolve({ data: { user: null } }), 3500)
          )
        ])
        const nextUser = authResult.data.user ?? getLocalAccessUser()
        const nextProfileRole =
          nextUser && "id" in nextUser
            ? await getCurrentProfileRole(
                typeof nextUser.id === "string" ? nextUser.id : null,
                typeof nextUser.email === "string" ? nextUser.email : null
              )
            : null

        if (!active) return

        setAuthUser(nextUser)
        setProfileRole(nextProfileRole || resolveAppRole(nextUser))
      } catch {
        if (!active) return
        const localUser = getLocalAccessUser()
        setAuthUser(localUser)
        setProfileRole(localUser ? resolveAppRole(localUser) : null)
      } finally {
        if (active) {
          setAuthLoading(false)
        }
      }
    }

    hydrateAuth()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void (async () => {
        try {
          const nextUser = session?.user ?? getLocalAccessUser()
          const nextProfileRole =
            nextUser && "id" in nextUser
              ? await getCurrentProfileRole(
                  typeof nextUser.id === "string" ? nextUser.id : null,
                  typeof nextUser.email === "string" ? nextUser.email : null
                )
              : null
          setAuthUser(nextUser)
          setProfileRole(nextProfileRole || resolveAppRole(nextUser))
        } catch {
          const fallbackUser = session?.user ?? getLocalAccessUser()
          setAuthUser(fallbackUser)
          setProfileRole(fallbackUser ? resolveAppRole(fallbackUser) : null)
        } finally {
          setAuthLoading(false)
        }
      })()
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    let active = true

    async function refreshProfileRoleFromUser() {
      if (!authUser || !("id" in authUser) || typeof authUser.id !== "string") {
        setProfileRole(authUser ? resolveAppRole(authUser) : null)
        return
      }

      const nextProfileRole = await getCurrentProfileRole(
        authUser.id,
        typeof authUser.email === "string" ? authUser.email : null
      )
      if (!active) return

      setProfileRole(nextProfileRole || resolveAppRole(authUser))
    }

    void refreshProfileRoleFromUser()

    return () => {
      active = false
    }
  }, [authUser])

  useEffect(() => {
    let active = true

    async function hydratePatrolOverrides() {
      const result = await loadSupabasePatrolOverrides()

      if (!active) return

      if (result.data) {
        setLocalPatrolOverrideRows(result.data)
        lastSupabasePatrolOverridesRef.current = JSON.stringify(result.data)
      }

      hasHydratedPatrolOverrides.current = true
      setPatrolOverridesSyncReady(true)
    }

    void hydratePatrolOverrides()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    let refreshTimeout: number | null = null

    async function refreshPatrolOverrides() {
      const result = await loadSupabasePatrolOverrides()
      if (!active || !result.data) return
      setLocalPatrolOverrideRows(result.data)
      lastSupabasePatrolOverridesRef.current = JSON.stringify(result.data)
    }

    const channel = supabase
      .channel("app_patrol_overrides")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "patrol_overrides"
        },
        () => {
          if (refreshTimeout) {
            window.clearTimeout(refreshTimeout)
          }

          refreshTimeout = window.setTimeout(() => {
            void refreshPatrolOverrides()
          }, 300)
        }
      )
      .subscribe()

    return () => {
      active = false
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout)
      }
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    if (!hasHydratedPatrolOverrides.current) return

    const snapshotJson = JSON.stringify(localPatrolOverrideRows)
    const actorChanged = currentSyncActorKey !== lastSupabasePatrolSyncActorRef.current
    if (snapshotJson === lastSupabasePatrolOverridesRef.current && !actorChanged) return

    const timeoutId = window.setTimeout(async () => {
      const result = await saveSupabasePatrolOverrides(localPatrolOverrideRows)

      if (result.ok) {
        lastSupabasePatrolOverridesRef.current = snapshotJson
        lastSupabasePatrolSyncActorRef.current = currentSyncActorKey
      }
    }, 500)

    return () => window.clearTimeout(timeoutId)
  }, [currentSyncActorKey, localPatrolOverrideRows])

  useEffect(() => {
    let active = true

    async function loadForceHistory() {
      const { data, error } = await supabase
        .from("force_history")
        .select("employee_id,forced_date")
        .order("forced_date", { ascending: false })

      if (error) {
        console.error("Failed loading force history:", error)
        return
      }

      if (active) {
        setForceHistoryRows((data || []) as ForceHistoryRow[])
      }
    }

    function scheduleForceHistoryRefresh() {
      if (forceHistoryRefreshTimeoutRef.current) {
        window.clearTimeout(forceHistoryRefreshTimeoutRef.current)
      }

      forceHistoryRefreshTimeoutRef.current = window.setTimeout(() => {
        void loadForceHistory()
      }, 350)
    }

    void loadForceHistory()

    const channel = supabase
      .channel("app_force_history")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "force_history"
        },
        () => scheduleForceHistoryRefresh()
      )
      .subscribe()

    return () => {
      active = false
      if (forceHistoryRefreshTimeoutRef.current) {
        window.clearTimeout(forceHistoryRefreshTimeoutRef.current)
      }
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const variant = params.get("variant") as AppLayoutVariant | null
    const moduleParam = params.get("module") as ModuleKey | null

    if (variant && layoutVariants.some((option) => option.value === variant)) {
      setLayoutVariant(variant)
    } else {
      setLayoutVariant(settings.defaultLayoutVariant)
    }

    if (moduleParam && moduleOrder.some((module) => module.key === moduleParam)) {
      setActiveModule(moduleParam)
    }
  }, [settings.defaultLayoutVariant])

  useEffect(() => {
    setLayoutVariant(settings.defaultLayoutVariant)
  }, [settings.defaultLayoutVariant])

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CID_ROTATION_START_STORAGE_KEY, cidRotationStartDate)
    }
  }, [cidRotationStartDate])

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(EMPLOYEES_STORAGE_KEY, JSON.stringify(employees))
    }
  }, [employees])

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
    }
  }, [settings])

  useEffect(() => {
    const requiredModules: ModuleKey[] = ["overtime", "notifications"]
    const missingModules = requiredModules.filter((moduleKey) => !settings.visibleModules.includes(moduleKey))

    if (missingModules.length === 0) return

    setSettings((current) => ({
      ...current,
      visibleModules: [...current.visibleModules, ...missingModules]
    }))
  }, [settings.visibleModules])

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(REFERENCE_SETTINGS_STORAGE_KEY, JSON.stringify(referenceSettings))
    }
  }, [referenceSettings])

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CID_OVERRIDES_STORAGE_KEY, JSON.stringify(cidDailyOverrides))
    }
  }, [cidDailyOverrides])

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DETAIL_RECORDS_STORAGE_KEY, JSON.stringify(detailRecords))
    }
  }, [detailRecords])

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DETAIL_QUEUE_EVENTS_STORAGE_KEY, JSON.stringify(detailQueueEvents))
    }
  }, [detailQueueEvents])

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DETAIL_QUEUE_IDS_STORAGE_KEY, JSON.stringify(detailQueueIds))
    }
  }, [detailQueueIds])

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(OVERTIME_QUEUE_IDS_STORAGE_KEY, JSON.stringify(overtimeQueueIds))
      window.localStorage.setItem(OVERTIME_QUEUE_VERSION_STORAGE_KEY, CURRENT_OVERTIME_QUEUE_VERSION)
    }
  }, [overtimeQueueIds])

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        NOTIFICATION_PROVIDER_CONFIG_STORAGE_KEY,
        JSON.stringify(notificationProviderConfig)
      )
      window.localStorage.setItem(
        PROVIDER_CONFIG_DRAFT_STORAGE_KEY,
        JSON.stringify(notificationProviderConfig)
      )
    }
  }, [notificationProviderConfig])

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(AUDIT_EVENTS_STORAGE_KEY, JSON.stringify(auditEvents))
    }
  }, [auditEvents])

  const schedulerSnapshot = useMemo<PersistedSchedulerState>(
    () => ({
      employees,
      settings,
      referenceSettings,
      cidRotationStartDate,
      cidDailyOverrides,
      detailRecords,
      detailQueueEvents,
      detailQueueIds,
      overtimeQueueIds,
      overtimeShiftRequests,
      overtimeEntries,
      notificationPreferences,
      notificationCampaigns,
      notificationDeliveries,
      notificationProviderConfig,
      auditEvents
    }),
    [
      auditEvents,
      cidDailyOverrides,
      cidRotationStartDate,
      detailQueueEvents,
      detailQueueIds,
      detailRecords,
      employees,
      overtimeQueueIds,
      overtimeShiftRequests,
      overtimeEntries,
      notificationCampaigns,
      notificationDeliveries,
      notificationProviderConfig,
      notificationPreferences,
      referenceSettings,
      settings
    ]
  )
  const staffSnapshot = useMemo<PersistedStaffState>(
    () => ({
      employees,
      settings,
      referenceSettings
    }),
    [employees, referenceSettings, settings]
  )
  const cidDetailSnapshot = useMemo<PersistedCidDetailState>(
    () => ({
      cidRotationStartDate,
      cidDailyOverrides,
      detailRecords,
      detailQueueEvents,
      detailQueueIds
    }),
    [cidDailyOverrides, cidRotationStartDate, detailQueueEvents, detailQueueIds, detailRecords]
  )
  const overtimeNotificationSnapshot = useMemo(
    () => ({
      overtimeQueueIds,
      overtimeShiftRequests,
      overtimeEntries,
      notificationPreferences,
      notificationCampaigns,
      notificationDeliveries
    }),
    [
      notificationCampaigns,
      notificationDeliveries,
      notificationPreferences,
      overtimeEntries,
      overtimeQueueIds,
      overtimeShiftRequests
    ]
  )
  const auditSnapshot = useMemo<PersistedAuditState>(
    () => ({
      auditEvents
    }),
    [auditEvents]
  )

  useEffect(() => {
    let active = true

    async function hydrateAppState() {
      const fallbackSnapshot = schedulerSnapshot
      const result = await loadSupabaseAppStates<Partial<PersistedSchedulerState>>([
        ...Object.values(SUPABASE_APP_STATE_KEYS),
        LEGACY_SUPABASE_APP_STATE_KEY
      ])

      if (!active) return

      const mergedPayload = {
        ...(result.data[LEGACY_SUPABASE_APP_STATE_KEY] || {}),
        ...(result.data[SUPABASE_APP_STATE_KEYS.staff] || {}),
        ...(result.data[SUPABASE_APP_STATE_KEYS.cidDetail] || {}),
        ...(result.data[SUPABASE_APP_STATE_KEYS.audit] || {})
      }

      if (Object.keys(mergedPayload).length > 0) {
        const normalized = normalizePersistedState(mergedPayload, fallbackSnapshot)
        setEmployees(normalized.employees)
        setSettings(normalized.settings)
        setReferenceSettings(normalized.referenceSettings)
        setCidRotationStartDate(normalized.cidRotationStartDate)
        setCidDailyOverrides(normalized.cidDailyOverrides)
        setDetailRecords(normalized.detailRecords)
        setDetailQueueEvents(normalized.detailQueueEvents)
        setDetailQueueIds(normalized.detailQueueIds)
        setAuditEvents(normalized.auditEvents)
        lastSupabaseSnapshotRef.current = JSON.stringify(normalized)
        setAppStateSyncStatus({
          mode: "connected",
          message: "Supabase sync is active for Employees, CID, Detail, Settings, audit, overtime, notifications, and patrol overrides."
        })
      } else if (result.error) {
        setAppStateSyncStatus({
          mode: "local",
          message: "Using local browser storage for Employees, CID, Detail, Settings, and audit until Supabase app_state is available."
        })
      } else {
        setAppStateSyncStatus({
          mode: "local",
          message: "No Supabase app state found yet. Local browser storage is active until app_state is set up."
        })
      }

      hasHydratedSupabaseState.current = true
    }

    hydrateAppState()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    async function hydrateOvertimeNotifications() {
      const result = await loadSupabaseOvertimeNotificationsState()

      if (!active) return

      if (result.data) {
        applyOvertimeNotificationsSyncData(result.data)
        hasHydratedOvertimeNotifications.current = true
        setOvertimeNotificationsSyncReady(true)
        setOvertimeNotificationsSyncError("")
        return
      }

      console.error("Skipping overtime/notification autosave because no Supabase baseline was loaded.", result.error)
      setOvertimeNotificationsSyncError(result.error || "Live overtime and notification state did not load.")
    }

    void hydrateOvertimeNotifications()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    async function refreshOvertimeNotifications() {
      const result = await loadSupabaseOvertimeNotificationsState()
      if (!active || !result.data) return
      applyOvertimeNotificationsSyncData(result.data)
    }

    const scheduleRefresh = () => {
      if (overtimeNotificationsRefreshTimeoutRef.current) {
        window.clearTimeout(overtimeNotificationsRefreshTimeoutRef.current)
      }

      overtimeNotificationsRefreshTimeoutRef.current = window.setTimeout(() => {
        void refreshOvertimeNotifications()
      }, 1200)
    }

    const channel = supabase
      .channel("app_overtime_notifications")
      .on("postgres_changes", { event: "*", schema: "public", table: "overtime_queue" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "overtime_shift_requests" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "overtime_entries" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "notification_preferences" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "notification_campaigns" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "notification_deliveries" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "notification_provider_config" }, scheduleRefresh)
      .subscribe()

    return () => {
      active = false
      if (overtimeNotificationsRefreshTimeoutRef.current) {
        window.clearTimeout(overtimeNotificationsRefreshTimeoutRef.current)
      }
      supabase.removeChannel(channel)
    }
  }, [employees, notificationCampaigns, notificationDeliveries, notificationPreferences, notificationProviderConfig, overtimeEntries])

  useEffect(() => {
    if (!hasHydratedSupabaseState.current) return

    const snapshotJson = JSON.stringify(schedulerSnapshot)
    const actorChanged = currentSyncActorKey !== lastSupabaseSyncActorRef.current
    if (snapshotJson === lastSupabaseSnapshotRef.current && !actorChanged) return

    const timeoutId = window.setTimeout(async () => {
      const result = await saveSupabaseAppStates([
        { stateKey: SUPABASE_APP_STATE_KEYS.staff, payload: staffSnapshot },
        { stateKey: SUPABASE_APP_STATE_KEYS.cidDetail, payload: cidDetailSnapshot },
        { stateKey: SUPABASE_APP_STATE_KEYS.audit, payload: auditSnapshot }
      ])

      if (result.ok) {
        lastSupabaseSnapshotRef.current = snapshotJson
        lastSupabaseSyncActorRef.current = currentSyncActorKey
        setAppStateSyncStatus({
          mode: "connected",
          message: "Supabase sync is active for Employees, CID, Detail, Settings, audit, overtime, notifications, and patrol overrides."
        })
      } else {
        setAppStateSyncStatus({
          mode: "local",
          message: "Local browser storage is still active. Add the app_state schema in Supabase to turn on cloud sync."
        })
      }
    }, 700)

    return () => window.clearTimeout(timeoutId)
  }, [auditSnapshot, cidDetailSnapshot, currentSyncActorKey, schedulerSnapshot, staffSnapshot])

  useEffect(() => {
    if (!hasHydratedOvertimeNotifications.current) return

    const snapshotJson = JSON.stringify(overtimeNotificationSnapshot)
    const actorChanged = currentSyncActorKey !== lastSupabaseOvertimeNotificationsActorRef.current
    if (snapshotJson === lastSupabaseOvertimeNotificationsRef.current && !actorChanged) return

    const timeoutId = window.setTimeout(async () => {
      const result = await saveSupabaseOvertimeNotificationsState(overtimeNotificationSnapshot)

      if (result.ok) {
        lastSupabaseOvertimeNotificationsRef.current = snapshotJson
        lastSupabaseOvertimeNotificationsActorRef.current = currentSyncActorKey
        writeOvertimeNotificationsSafetySnapshot(overtimeNotificationSnapshot)
      }
    }, 700)

    return () => window.clearTimeout(timeoutId)
  }, [currentSyncActorKey, overtimeNotificationSnapshot])

  useEffect(() => {
    setDetailQueueIds((currentQueue) => {
      const initialSorted = buildInitialDetailQueue(employees)
      const hasMeaningfulDetailQueueActivity =
        detailQueueEvents.length > 0 || detailRecords.length > 0

      if (!hasMeaningfulDetailQueueActivity) {
        return initialSorted
      }

      const currentSet = new Set(currentQueue)
      const activeEmployeeIds = new Set(employees.map((employee) => employee.id))
      const retained = currentQueue.filter((id) => activeEmployeeIds.has(id))
      const added = initialSorted.filter((id) => !currentSet.has(id))
      return [...retained, ...added]
    })
  }, [detailQueueEvents.length, detailRecords.length, employees])

  useEffect(() => {
    setOvertimeQueueIds((currentQueue) => {
      const initialSorted = buildInitialOvertimeQueue(employees)
      const hasMeaningfulQueueMovement = hasMeaningfulOvertimeQueueActivity(overtimeShiftRequests, overtimeEntries)

      if (!hasMeaningfulQueueMovement) {
        return initialSorted
      }

      const currentSet = new Set(currentQueue)
      const activeEmployeeIds = new Set(
        employees
          .filter((employee) => employee.status === "Active")
          .map((employee) => employee.id)
      )
      const retained = currentQueue.filter((id) => activeEmployeeIds.has(id))
      const added = initialSorted.filter((id) => !currentSet.has(id))
      return [...retained, ...added]
    })
  }, [employees, overtimeEntries, overtimeShiftRequests])

  useEffect(() => {
    setNotificationPreferences((current) => {
      const defaults = buildInitialNotificationPreferences(employees)
      const currentMap = new Map(current.map((entry) => [entry.employeeId, entry]))
      return defaults.map((entry) => currentMap.get(entry.employeeId) || entry)
    })
  }, [employees])

  useEffect(() => {
    let active = true

    async function loadPatrolSummary() {
      const today = new Date()
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
      const end = new Date(start)
      end.setDate(end.getDate() + 45)

      const { data, error } = await fetchPatrolScheduleRange(toIsoDate(start), toIsoDate(end))

      if (error) {
        console.error("Failed loading patrol summary:", error)
        return
      }

      if (active) {
        setPatrolSummaryRows((data || []) as PatrolScheduleSummaryRow[])
      }
    }

    function schedulePatrolSummaryRefresh() {
      if (patrolSummaryRefreshTimeoutRef.current) {
        window.clearTimeout(patrolSummaryRefreshTimeoutRef.current)
      }

      patrolSummaryRefreshTimeoutRef.current = window.setTimeout(() => {
        void loadPatrolSummary()
      }, 350)
    }

    void loadPatrolSummary()

    const channel = supabase
      .channel("app_patrol_summary")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "patrol_schedule"
        },
        () => {
          invalidatePatrolScheduleCache()
          schedulePatrolSummaryRefresh()
        }
      )
      .subscribe()

    return () => {
      active = false
      if (patrolSummaryRefreshTimeoutRef.current) {
        window.clearTimeout(patrolSummaryRefreshTimeoutRef.current)
      }
      supabase.removeChannel(channel)
    }
  }, [])

  const activeTheme = useMemo(() => layoutThemes[layoutVariant], [layoutVariant])
  const cidOnCallEmployee = useMemo(
    () =>
      getEffectiveCidOnCallForDate(
        new Date(),
        employees,
        cidRotationStartDate,
        cidDailyOverrides
      ),
    [employees, cidRotationStartDate, cidDailyOverrides]
  )
  const cidOnCallName = cidOnCallEmployee
    ? `${cidOnCallEmployee.firstName} ${cidOnCallEmployee.lastName}`
    : "Not Assigned"
  const activeColorSettings = settings.useCustomColors ? settings.colors : undefined
  const canAccessCommandTools = currentUserRole === "admin" || currentUserRole === "sergeant"
  function appendAuditEvent(
    module: AuditEvent["module"],
    action: string,
    summary: string,
    details?: string
  ) {
    setAuditEvents((current) => [
      {
        id: crypto.randomUUID(),
        module,
        action,
        summary,
        details,
        actorRole: currentUserRole,
        createdAt: new Date().toISOString()
      },
      ...current
    ].slice(0, 500))
  }

  function rebuildQueuesBySeniority() {
    const nextDetailQueue = buildInitialDetailQueue(employees)
    const nextOvertimeQueue = buildInitialOvertimeQueue(employees)
    setDetailQueueIds(nextDetailQueue)
    setOvertimeQueueIds(nextOvertimeQueue)
    appendAuditEvent(
      "Settings",
      "Queues Rebuilt",
      "Rebuilt Detail and Overtime queues by hire-date seniority.",
      `Detail queue: ${nextDetailQueue.length} employees | Overtime queue: ${nextOvertimeQueue.length} employees`
    )
  }

  function clearPatrolOverrideCache() {
    setLocalPatrolOverrideRows([])
    invalidatePatrolScheduleCache()
    appendAuditEvent(
      "Settings",
      "Local Patrol Overrides Cleared",
      "Cleared local Patrol override cache from the admin repair tools."
    )
  }

  function repairOvertimeFromPatrol() {
    setOvertimeShiftRequests((current) =>
      reconcilePatrolGeneratedOvertimeRequests(current, localPatrolOverrideRows, employees)
    )

    setLocalPatrolOverrideRows(localPatrolOverrideRows)
    invalidatePatrolScheduleCache()
    appendAuditEvent(
      "Settings",
      "Overtime Repaired From Patrol",
      "Reconciled Patrol-generated overtime shifts against the current Patrol override rows."
    )
  }

  useEffect(() => {
    if (!hasHydratedPatrolOverrides.current) return

    setOvertimeShiftRequests((current) => {
      const reconciled = reconcilePatrolGeneratedOvertimeRequests(current, localPatrolOverrideRows, employees)
      return JSON.stringify(reconciled) === JSON.stringify(current) ? current : reconciled
    })
  }, [employees, localPatrolOverrideRows])

  const visibleModulesForRole = useMemo(() => {
    if (isMobileLayout) {
      return mobileModuleOrder.map((module) => module.key)
    }

    return settings.visibleModules.filter((moduleKey) =>
      moduleKey === "command" || moduleKey === "audit" ? canAccessCommandTools : true
    )
  }, [canAccessCommandTools, isMobileLayout, settings.visibleModules])
  const staffingAlerts = useMemo(() => {
    const grouped = new Map<string, PatrolScheduleSummaryRow[]>()

    for (const row of coverageEvaluatedPatrolSummaryRows) {
      const key = `${row.assignment_date}-${row.shift_type}`
      const existing = grouped.get(key) || []
      existing.push(row)
      grouped.set(key, existing)
    }

    return [...grouped.entries()]
      .flatMap(([key, rows]) => {
        if (!rows[0] || !isForceRequired(rows[0], rows)) return []

        const coveredRows = rows.filter((row) => isShiftCovered(row))
        const coveredSupervisors = coveredRows.filter((row) => row.position_code === "SUP1" || row.position_code === "SUP2")
        const reasons: string[] = []

        if (coveredSupervisors.length === 0) {
          reasons.push("No supervisor on duty")
        }

        if (coveredRows.length < 4) {
          reasons.push(`Only ${coveredRows.length} covered employees`)
        }

        return [{
          key,
          assignmentDate: rows[0].assignment_date,
          shiftType: rows[0].shift_type,
          reasons
          }]
        })
        .sort((a, b) => a.assignmentDate.localeCompare(b.assignmentDate) || a.shiftType.localeCompare(b.shiftType))
  }, [coverageEvaluatedPatrolSummaryRows, localPatrolOverrideRows])

  useEffect(() => {
    if (typeof window === "undefined") return

    const widthMedia = window.matchMedia("(max-width: 1100px)")
    const pointerMedia = window.matchMedia("(pointer: coarse)")
    const syncLayout = () => {
      const ua = window.navigator.userAgent.toLowerCase()
      const isPhoneUserAgent =
        ua.includes("iphone") ||
        ua.includes("android") ||
        ua.includes("mobile") ||
        ua.includes("ipad")

      setIsMobileLayout(widthMedia.matches || pointerMedia.matches || isPhoneUserAgent)
    }

    syncLayout()
    widthMedia.addEventListener("change", syncLayout)
    pointerMedia.addEventListener("change", syncLayout)

    return () => {
      widthMedia.removeEventListener("change", syncLayout)
      pointerMedia.removeEventListener("change", syncLayout)
    }
  }, [])

  useEffect(() => {
    function syncFromQuery() {
      if (typeof window === "undefined") return
      const searchParams = new URLSearchParams(window.location.search)
      const responseToken = searchParams.get("response") || ""
      setResponseTokenFromQuery(responseToken)

      if (responseToken) {
        setActiveModule("notifications")
      }
    }

    syncFromQuery()
    if (typeof window !== "undefined") {
      window.addEventListener("popstate", syncFromQuery)
      return () => window.removeEventListener("popstate", syncFromQuery)
    }
  }, [])

  useEffect(() => {
    if (!visibleModulesForRole.includes(activeModule)) {
      const fallbackModule = moduleOrder.find((module) => visibleModulesForRole.includes(module.key))
      if (fallbackModule) {
        setActiveModule(fallbackModule.key)
      }
    }
  }, [activeModule, visibleModulesForRole])

  function formatSummaryDate(date: string) {
    return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    })
  }

  const queuedOvertimeRequests = useMemo(
    () => {
      const patrolTimeOffFeed = [...overtimeShiftRequests].filter(
        (request) => request.source === "Patrol Open Shift" && request.status !== "Closed"
      )
      const groupedRequests = new Map<string, OvertimeShiftRequest[]>()

      for (const request of patrolTimeOffFeed) {
        const key = `${request.assignmentDate}-${request.shiftType}`
        const current = groupedRequests.get(key) || []
        current.push(request)
        groupedRequests.set(key, current)
      }

      return patrolTimeOffFeed
        .filter((request) => {
          if (request.manuallyQueued) return true

          const peerRequests = groupedRequests.get(`${request.assignmentDate}-${request.shiftType}`) || []
          const totalStaffingSlots = 5
          const totalSupervisorSlots = 2
          const offCount = peerRequests.length
          const supervisorOffCount = peerRequests.filter(
            (peerRequest) => peerRequest.positionCode === "SUP1" || peerRequest.positionCode === "SUP2"
          ).length
          const remainingStaffing = totalStaffingSlots - offCount
          const remainingSupervisors = totalSupervisorSlots - supervisorOffCount

          return remainingSupervisors < 1 || remainingStaffing < 4
        })
        .sort(
          (a, b) =>
            a.assignmentDate.localeCompare(b.assignmentDate) ||
            a.shiftType.localeCompare(b.shiftType) ||
            a.positionCode.localeCompare(b.positionCode)
        )
    },
    [overtimeShiftRequests]
  )

  if (authLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: activeTheme.pageBackground
        }}
      >
        <div style={{ fontWeight: 700, color: "#334155" }}>
          Loading secure session...
        </div>
      </div>
    )
  }

  if (!authUser) {
    return (
      <LoginPage
        onLogin={async (user) => {
          const nextUser = user as typeof authUser
          const nextUserId =
            nextUser && typeof nextUser === "object" && "id" in nextUser
              ? (nextUser as { id?: unknown }).id
              : null
          const nextUserEmail =
            nextUser && typeof nextUser === "object" && "email" in nextUser
              ? (nextUser as { email?: unknown }).email
              : null
          setAuthUser(nextUser)
          const nextResolvedRole =
            typeof nextUserId === "string"
              ? await getCurrentProfileRole(
                  nextUserId,
                  typeof nextUserEmail === "string" ? nextUserEmail : null
                )
              : null
          setProfileRole(nextResolvedRole || resolveAppRole(nextUser))
          appendAuditEvent(
            "App",
            "User Signed In",
            `${resolveDisplayName(nextUser)} signed in.`,
            `Role resolved as ${(nextResolvedRole || resolveAppRole(nextUser)).toUpperCase()}.`
          )
        }}
      />
    )
  }

  const requiresLiveSyncBarrier =
    activeModule === "patrol" ||
    activeModule === "overtime" ||
    activeModule === "notifications"

  if (requiresLiveSyncBarrier && (!patrolOverridesSyncReady || !overtimeNotificationsSyncReady)) {
    return (
      <div
        style={{
          width: "100%",
          minHeight: "100vh",
          padding: "12px",
          boxSizing: "border-box",
          background: activeTheme.pageBackground
        }}
      >
        <div style={{ maxWidth: "760px", margin: "80px auto 0 auto" }}>
          <Card>
            <CardHeader>
              <CardTitle>Syncing Live Scheduler Data</CardTitle>
            </CardHeader>
            <CardContent>
              <div style={{ display: "grid", gap: "10px", color: "#334155", fontSize: "14px", lineHeight: 1.5 }}>
                <div>
                  The app is waiting for the current live Patrol, Overtime, and Notifications state before opening this module.
                </div>
                <div>
                  This prevents stale or half-loaded startup data from overwriting your live production work.
                </div>
                {overtimeNotificationsSyncError && (
                  <div style={{ color: "#991b1b", fontWeight: 700 }}>
                    {overtimeNotificationsSyncError}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (

    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        padding: isMobileLayout ? "8px" : "12px",
        boxSizing: "border-box",
        background: activeTheme.pageBackground
      }}
    >
      <div
        style={{
          maxWidth: isMobileLayout ? "100%" : "1760px",
          margin: "0 auto",
          background: activeTheme.shellBackground,
          border: activeColorSettings ? `1px solid ${activeColorSettings.border}` : activeTheme.shellBorder,
          boxShadow: activeTheme.shellShadow,
          borderRadius: isMobileLayout ? "18px" : "24px",
          padding: isMobileLayout ? "12px" : "18px"
        }}
      >
        <Header
          variant={layoutVariant}
          title={settings.departmentTitle}
          badgeSrc="/sheriff-badge-transparent.png"
          user={{
            username: currentUserDisplayName,
            secondary: currentUserRole.toUpperCase()
          }}
          onSignOut={() => {
            void signOut()
            appendAuditEvent("App", "User Signed Out", `${currentUserDisplayName} signed out.`)
          }}
          compact={isMobileLayout}
          colorSettings={
            activeColorSettings
              ? {
                  accent: activeColorSettings.accent,
                  border: activeColorSettings.border,
                  cardBackground: activeColorSettings.cardBackground
                }
              : undefined
          }
        />

        {!isMobileLayout && <div style={{ marginTop: "14px", marginBottom: "14px" }}>
          <SummaryCards
            variant={layoutVariant}
            cidOnCallName={cidOnCallName}
            openShiftCount={queuedOvertimeRequests.length}
            staffingAlertCount={staffingAlerts.length}
            activeCard={activeSummaryCard}
            onCardClick={(card) => {
              if (card === "open_shifts") {
                setActiveModule("overtime")
                setActiveSummaryCard(null)
                if (typeof window !== "undefined") {
                  window.location.hash = "overtime-queue"
                }
                return
              }

              setActiveSummaryCard((current) => (current === card ? null : card))
            }}
            colorSettings={
              activeColorSettings
                ? {
                    accent: activeColorSettings.accent,
                    border: activeColorSettings.border,
                    cardBackground: activeColorSettings.cardBackground,
                    cardBorder: activeColorSettings.cardBorder
                  }
                : undefined
            }
          />
        </div>}

        {!isMobileLayout && <div
          style={{
            marginBottom: "14px",
            borderRadius: "12px",
            padding: "10px 12px",
            border: appStateSyncStatus.mode === "connected" ? "1px solid #bfdbfe" : "1px solid #fcd34d",
            background: appStateSyncStatus.mode === "connected" ? "#eff6ff" : "#fffbeb",
            color: appStateSyncStatus.mode === "connected" ? "#1d4ed8" : "#92400e",
            fontSize: "13px",
            fontWeight: 600
          }}
        >
          {appStateSyncStatus.message}
        </div>}

        {!isMobileLayout && activeSummaryCard === "staffing_alerts" && (
          <div style={{ marginBottom: "14px" }}>
            <Card>
              <CardHeader>
                <CardTitle>
                  Staffing Alerts
                </CardTitle>
              </CardHeader>

              <CardContent>
                <div style={{ display: "grid", gap: "10px" }}>
                  {staffingAlerts.length === 0 && (
                    <div style={{ color: "#475569", fontSize: "13px" }}>
                      No active staffing alerts right now.
                    </div>
                  )}

                  {staffingAlerts.map((alert) => (
                    <button
                      key={alert.key}
                      onClick={() => setActiveModule("patrol")}
                      style={{
                        border: "1px solid #fecaca",
                        borderRadius: "12px",
                        padding: "12px",
                        background: "#fff7f7",
                        textAlign: "left",
                        cursor: "pointer"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "10px" }}>
                        <div style={{ fontWeight: 700 }}>
                          {formatSummaryDate(alert.assignmentDate)} | {alert.shiftType}
                        </div>
                        <div style={{ color: "#dc2626", fontWeight: 700 }}>
                          Alert
                        </div>
                      </div>
                      <div style={{ marginTop: "6px", color: "#7f1d1d", fontSize: "13px" }}>
                        {alert.reasons.join(" | ")}
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <ModuleTabs
          active={activeModule}
          onChange={setActiveModule}
          moduleOrder={isMobileLayout ? mobileModuleOrder : moduleOrder}
          visibleModules={visibleModulesForRole as ModuleKey[]}
          variant={layoutVariant}
          compact={isMobileLayout}
          colorSettings={
            activeColorSettings
              ? {
                  accent: activeColorSettings.accent,
                  border: activeColorSettings.border,
                  cardBackground: activeColorSettings.cardBackground
                }
              : undefined
          }
        />

        {activeModule === "command" && (
          <CommandPage
            currentUserRole={currentUserRole}
            employees={employees}
            patrolRows={effectivePatrolSummaryRows}
            cidOnCallName={cidOnCallName}
            detailRecords={detailRecords}
            detailQueueEvents={detailQueueEvents}
            detailQueueIds={detailQueueIds}
            overtimeEntries={overtimeEntries}
            forceHistory={forceHistoryRows}
            auditEvents={auditEvents}
            onOpenModule={setActiveModule}
          />
        )}

        {activeModule === "audit" && (
          <AuditPage
            currentUserRole={currentUserRole}
            auditEvents={auditEvents}
          />
        )}

        {activeModule === "patrol" && (
          <PatrolPage
            employees={employees}
            canEdit={!isMobileLayout}
            defaultView={settings.defaultPatrolView}
            patrolOverrideRows={localPatrolOverrideRows}
            setPatrolOverrideRows={setLocalPatrolOverrideRows}
            overtimeShiftRequests={overtimeShiftRequests}
            setOvertimeShiftRequests={setOvertimeShiftRequests}
            colorSettings={activeColorSettings}
            onAuditEvent={(action, summary, details) => appendAuditEvent("Patrol", action, summary, details)}
          />
        )}

        {activeModule === "overtime" && (
          <OvertimePage
            employees={employees}
            currentUserRole={currentUserRole}
            patrolRows={effectivePatrolSummaryRows}
            patrolOverrideRows={localPatrolOverrideRows}
            setPatrolOverrideRows={setLocalPatrolOverrideRows}
            detailRecords={detailRecords}
            forceHistory={forceHistoryRows}
            setForceHistory={setForceHistoryRows}
            overtimeQueueIds={overtimeQueueIds}
            setOvertimeQueueIds={setOvertimeQueueIds}
            overtimeShiftRequests={overtimeShiftRequests}
            setOvertimeShiftRequests={setOvertimeShiftRequests}
            onOpenNotificationsForShiftIds={openNotificationsForShiftIds}
            onQueueAssignmentNotice={queueAssignmentNoticeForShift}
            onAuditEvent={(action, summary, details) => appendAuditEvent("Overtime", action, summary, details)}
          />
        )}

        {activeModule === "notifications" && (
          <NotificationsPage
            currentUserRole={currentUserRole}
            employees={employees}
            overtimeShiftRequests={overtimeShiftRequests}
            setOvertimeShiftRequests={setOvertimeShiftRequests}
            notificationPreferences={notificationPreferences}
            setNotificationPreferences={setNotificationPreferences}
            notificationCampaigns={notificationCampaigns}
            setNotificationCampaigns={setNotificationCampaigns}
            notificationDeliveries={notificationDeliveries}
            setNotificationDeliveries={setNotificationDeliveries}
            notificationProviderConfig={notificationProviderConfig}
            setNotificationProviderConfig={setNotificationProviderConfig}
            initialSelectedShiftIds={notificationDraftShiftIds}
            initialSelectedRecipientIds={notificationDraftRecipientIds}
            responseToken={responseTokenFromQuery}
            compactMode={isMobileLayout}
            onConsumeDraftSelections={() => {
              setNotificationDraftShiftIds([])
              setNotificationDraftRecipientIds([])
            }}
            onAuditEvent={(action, summary, details) => appendAuditEvent("Notifications", action, summary, details)}
          />
        )}

        {activeModule === "force" && (
          <ForcePage
            employees={employees}
            overtimeEntries={overtimeEntries}
            detailRecords={detailRecords}
            forceHistory={forceHistoryRows}
            setForceHistory={setForceHistoryRows}
            readOnly={isMobileLayout}
            onAuditEvent={(action, summary, details) => appendAuditEvent("Force", action, summary, details)}
          />
        )}

        {activeModule === "employees" && (
          <EmployeesPage
            employees={employees}
            setEmployees={setEmployees}
            onEmployeeAdded={(employee) =>
              appendAuditEvent(
                "Employees",
                "Employee Added",
                `Added ${employee.firstName} ${employee.lastName}.`,
                `${employee.rank} | ${employee.team} | ${employee.defaultVehicle}`
              )
            }
            onEmployeeUpdated={(previous, next) =>
              appendAuditEvent(
                "Employees",
                "Employee Updated",
                `Updated ${next.firstName} ${next.lastName}.`,
                `Previous: ${previous.rank} ${previous.team} ${previous.defaultVehicle} ${previous.status} | Next: ${next.rank} ${next.team} ${next.defaultVehicle} ${next.status}`
              )
            }
            onEmployeeDeleted={(employee) =>
              appendAuditEvent(
                "Employees",
                "Employee Deleted",
                `Deleted ${employee.firstName} ${employee.lastName}.`,
                `${employee.rank} | ${employee.team} | ${employee.defaultVehicle}`
              )
            }
          />
        )}

        {activeModule === "cid" && (
          <CIDPage
            employees={employees}
            currentUserRole={isMobileLayout ? "deputy" : currentUserRole}
            rotationStartDate={cidRotationStartDate}
            setRotationStartDate={setCidRotationStartDate}
            dailyOverrides={cidDailyOverrides}
            setDailyOverrides={setCidDailyOverrides}
            onAuditEvent={(action, summary, details) => appendAuditEvent("CID", action, summary, details)}
          />
        )}

        {activeModule === "detail" && (
          <DetailPage
            employees={employees}
            currentUserRole={isMobileLayout ? "deputy" : currentUserRole}
            detailRecords={detailRecords}
            setDetailRecords={setDetailRecords}
            detailQueueEvents={detailQueueEvents}
            setDetailQueueEvents={setDetailQueueEvents}
            detailQueueIds={detailQueueIds}
            setDetailQueueIds={setDetailQueueIds}
            onAuditEvent={(action, summary, details) => appendAuditEvent("Detail", action, summary, details)}
          />
        )}

        {activeModule === "reports" && (
          <ReportsPage
            employees={employees}
            currentUserRole={currentUserRole}
            overtimeEntries={overtimeEntries}
            setOvertimeEntries={setOvertimeEntries}
            detailRecords={detailRecords}
            forceHistory={forceHistoryRows}
            cidOnCallName={cidOnCallName}
            defaultReportType={settings.defaultReportType}
            onAuditEvent={(action, summary, details) => appendAuditEvent("Reports", action, summary, details)}
          />
        )}

        {activeModule === "settings" && (
          <SettingsPage
            currentUserRole={currentUserRole}
            settings={settings}
            setSettings={setSettings}
            referenceSettings={referenceSettings}
            setReferenceSettings={setReferenceSettings}
            cidRotationStartDate={cidRotationStartDate}
            setCidRotationStartDate={setCidRotationStartDate}
            onRepairOvertimeFromPatrol={repairOvertimeFromPatrol}
            onRebuildQueuesBySeniority={rebuildQueuesBySeniority}
            onClearPatrolOverrideCache={clearPatrolOverrideCache}
            onPushLocalOvertimeToSupabase={() => void pushLocalOvertimeToSupabase()}
            onRestoreOvertimeSafetySnapshot={restoreOvertimeSafetySnapshot}
            onDownloadOvertimeBackup={downloadOvertimeBackup}
            onImportOvertimeBackup={importOvertimeBackup}
            onAuditEvent={(action, summary, details) => appendAuditEvent("Settings", action, summary, details)}
            moduleOptions={moduleOrder.map((module) => ({
              key: module.key,
              label: module.label
            }))}
          />
        )}
      </div>
    </div>

  )

}

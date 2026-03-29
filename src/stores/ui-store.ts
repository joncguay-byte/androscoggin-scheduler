import { create } from "zustand"
import type { StateCreator } from "zustand"
import type { Employee, PatrolPositionCode, ShiftType } from "../types"

export type UiModuleKey =
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

type ActiveSummaryCard = "open_shifts" | "staffing_alerts" | null

type PatrolMultiDatePickerHandoff = {
  employeeId: string
  positionCode: PatrolPositionCode
  shiftType: ShiftType
  team: Employee["team"]
  assignmentDate: string
}

type UiStore = {
  activeModule: UiModuleKey
  activeSummaryCard: ActiveSummaryCard
  notificationDraftShiftIds: string[]
  notificationDraftRecipientIds: string[]
  patrolMultiDatePickerHandoff: PatrolMultiDatePickerHandoff | null
  setActiveModule: (module: UiModuleKey) => void
  setActiveSummaryCard: (card: ActiveSummaryCard | ((current: ActiveSummaryCard) => ActiveSummaryCard)) => void
  openNotificationsForShiftIds: (shiftIds: string[], recipientIds?: string[]) => void
  openPatrolMultiDatePicker: (payload: PatrolMultiDatePickerHandoff) => void
  clearPatrolMultiDatePickerHandoff: () => void
  clearNotificationDraftSelections: () => void
}

export type { UiStore }

const createUiStore: StateCreator<UiStore> = (set) => ({
  activeModule: "patrol",
  activeSummaryCard: null,
  notificationDraftShiftIds: [],
  notificationDraftRecipientIds: [],
  patrolMultiDatePickerHandoff: null,
  setActiveModule: (module: UiModuleKey) => set({ activeModule: module }),
  setActiveSummaryCard: (card: ActiveSummaryCard | ((current: ActiveSummaryCard) => ActiveSummaryCard)) =>
    set((state) => ({
      activeSummaryCard: typeof card === "function" ? card(state.activeSummaryCard) : card
    })),
  openNotificationsForShiftIds: (shiftIds: string[], recipientIds: string[] = []) =>
    set({
      activeModule: "notifications",
      notificationDraftShiftIds: shiftIds,
      notificationDraftRecipientIds: recipientIds
    }),
  openPatrolMultiDatePicker: (payload: PatrolMultiDatePickerHandoff) =>
    set({
      activeModule: "patrol",
      patrolMultiDatePickerHandoff: payload
    }),
  clearPatrolMultiDatePickerHandoff: () =>
    set({
      patrolMultiDatePickerHandoff: null
    }),
  clearNotificationDraftSelections: () =>
    set({
      notificationDraftShiftIds: [],
      notificationDraftRecipientIds: []
    })
})

export const useUiStore = create<UiStore>(createUiStore)

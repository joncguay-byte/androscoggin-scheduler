import { create } from "zustand"

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

type UiStore = {
  activeModule: UiModuleKey
  activeSummaryCard: ActiveSummaryCard
  notificationDraftShiftIds: string[]
  notificationDraftRecipientIds: string[]
  setActiveModule: (module: UiModuleKey) => void
  setActiveSummaryCard: (card: ActiveSummaryCard | ((current: ActiveSummaryCard) => ActiveSummaryCard)) => void
  openNotificationsForShiftIds: (shiftIds: string[], recipientIds?: string[]) => void
  clearNotificationDraftSelections: () => void
}

export const useUiStore = create<UiStore>((set) => ({
  activeModule: "patrol",
  activeSummaryCard: null,
  notificationDraftShiftIds: [],
  notificationDraftRecipientIds: [],
  setActiveModule: (module) => set({ activeModule: module }),
  setActiveSummaryCard: (card) =>
    set((state) => ({
      activeSummaryCard: typeof card === "function" ? card(state.activeSummaryCard) : card
    })),
  openNotificationsForShiftIds: (shiftIds, recipientIds = []) =>
    set({
      activeModule: "notifications",
      notificationDraftShiftIds: shiftIds,
      notificationDraftRecipientIds: recipientIds
    }),
  clearNotificationDraftSelections: () =>
    set({
      notificationDraftShiftIds: [],
      notificationDraftRecipientIds: []
    })
}))

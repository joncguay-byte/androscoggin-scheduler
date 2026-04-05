import { create } from "zustand"
import type { StateCreator } from "zustand"

export type UiModuleKey =
  | "command"
  | "ai"
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

export type AppToastTone = "success" | "error" | "warning" | "info"

export type AppToast = {
  id: string
  title: string
  message?: string
  tone: AppToastTone
  createdAt: string
}

type UiStore = {
  activeModule: UiModuleKey
  activeSummaryCard: ActiveSummaryCard
  notificationDraftShiftIds: string[]
  notificationDraftRecipientIds: string[]
  toasts: AppToast[]
  setActiveModule: (module: UiModuleKey) => void
  setActiveSummaryCard: (card: ActiveSummaryCard | ((current: ActiveSummaryCard) => ActiveSummaryCard)) => void
  openNotificationsForShiftIds: (shiftIds: string[], recipientIds?: string[]) => void
  clearNotificationDraftSelections: () => void
  pushToast: (toast: Omit<AppToast, "id" | "createdAt">) => string
  dismissToast: (id: string) => void
}

export type { UiStore }

const createUiStore: StateCreator<UiStore> = (set) => ({
  activeModule: "patrol",
  activeSummaryCard: null,
  notificationDraftShiftIds: [],
  notificationDraftRecipientIds: [],
  toasts: [],
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
  clearNotificationDraftSelections: () =>
    set({
      notificationDraftShiftIds: [],
      notificationDraftRecipientIds: []
    }),
  pushToast: (toast) => {
    const id = crypto.randomUUID()
    set((state) => ({
      toasts: [
        ...state.toasts.slice(-4),
        {
          id,
          createdAt: new Date().toISOString(),
          ...toast
        }
      ]
    }))
    return id
  },
  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id)
    }))
})

export const useUiStore = create<UiStore>(createUiStore)

export function pushAppToast(toast: Omit<AppToast, "id" | "createdAt">) {
  return useUiStore.getState().pushToast(toast)
}

export function dismissAppToast(id: string) {
  useUiStore.getState().dismissToast(id)
}

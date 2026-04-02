import { useEffect, useRef } from "react"

import { dismissAppToast, useUiStore } from "../stores/ui-store"

const toneStyles = {
  success: {
    border: "#86efac",
    background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)",
    title: "#166534",
    body: "#166534"
  },
  error: {
    border: "#fda4af",
    background: "linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%)",
    title: "#be123c",
    body: "#9f1239"
  },
  warning: {
    border: "#fcd34d",
    background: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)",
    title: "#b45309",
    body: "#92400e"
  },
  info: {
    border: "#93c5fd",
    background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
    title: "#1d4ed8",
    body: "#1e40af"
  }
} as const

export default function AppToastViewport() {
  const toasts = useUiStore((state) => state.toasts)
  const timersRef = useRef<Record<string, number>>({})

  useEffect(() => {
    const activeIds = new Set(toasts.map((toast) => toast.id))

    toasts.forEach((toast) => {
      if (timersRef.current[toast.id]) return

      timersRef.current[toast.id] = window.setTimeout(() => {
        dismissAppToast(toast.id)
        delete timersRef.current[toast.id]
      }, toast.tone === "error" ? 9000 : 5200)
    })

    Object.keys(timersRef.current).forEach((toastId) => {
      if (activeIds.has(toastId)) return
      window.clearTimeout(timersRef.current[toastId])
      delete timersRef.current[toastId]
    })

    return () => {
      Object.values(timersRef.current).forEach((timerId) => window.clearTimeout(timerId))
      timersRef.current = {}
    }
  }, [toasts])

  if (toasts.length === 0) return null

  return (
    <div
      style={{
        position: "fixed",
        right: "18px",
        bottom: "18px",
        zIndex: 9999,
        display: "grid",
        gap: "10px",
        maxWidth: "360px",
        width: "min(360px, calc(100vw - 20px))",
        pointerEvents: "none"
      }}
    >
      {toasts.map((toast) => {
        const style = toneStyles[toast.tone]

        return (
          <div
            key={toast.id}
            style={{
              border: `1px solid ${style.border}`,
              background: style.background,
              borderRadius: "16px",
              boxShadow: "0 18px 44px rgba(15, 23, 42, 0.18)",
              padding: "12px 14px",
              pointerEvents: "auto",
              transform: "translateY(0)",
              animation: "toast-slide-in 180ms ease-out"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "start" }}>
              <div style={{ display: "grid", gap: "4px" }}>
                <div style={{ fontSize: "13px", fontWeight: 800, color: style.title }}>
                  {toast.title}
                </div>
                {toast.message && (
                  <div style={{ fontSize: "12px", lineHeight: 1.45, color: style.body }}>
                    {toast.message}
                  </div>
                )}
              </div>

              <button
                onClick={() => dismissAppToast(toast.id)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: style.body,
                  fontWeight: 800,
                  cursor: "pointer",
                  padding: 0
                }}
              >
                Close
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

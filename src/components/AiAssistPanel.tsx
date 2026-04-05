import { useState } from "react"
import { Button } from "./ui/simple-ui"
import { hasAiAssistantConfig, readAiAssistantConfig, requestAiAssistantResponse } from "../lib/ai-assistant"
import { pushAppToast } from "../stores/ui-store"

type AiAssistPanelProps = {
  title: string
  feature: string
  context: string
  instruction?: string
}

export function AiAssistPanel({ title, feature, context, instruction }: AiAssistPanelProps) {
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState("")
  const [open, setOpen] = useState(false)
  const [statusMessage, setStatusMessage] = useState("Ready")
  const configReady = hasAiAssistantConfig(readAiAssistantConfig())

  async function handleGenerate() {
    if (!configReady) {
      setOpen(true)
      setStatusMessage("Save the AI function name and model in Settings first.")
      pushAppToast({
        tone: "warning",
        title: "AI assistant not configured",
        message: "Save the AI function name and model in Settings first."
      })
      return
    }

    setLoading(true)
    setOpen(true)
    setResponse("")
    setStatusMessage("Generating live assistant response...")
    pushAppToast({
      tone: "info",
      title: "AI request started",
      message: "Generating live assistant response..."
    })

    try {
      const text = await requestAiAssistantResponse({
        feature,
        context,
        instruction
      })
      setResponse(text)
      setStatusMessage("Live assistant response ready.")
      pushAppToast({
        tone: "success",
        title: "AI response ready",
        message: "The live assistant returned guidance for this panel."
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI request failed."
      setResponse("")
      setStatusMessage(message)
      pushAppToast({
        tone: "error",
        title: "AI assistant failed",
        message
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: "grid", gap: "8px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: "4px" }}>
          <div style={{ fontWeight: 800, color: "#0f172a" }}>{title}</div>
          <div style={{ fontSize: "11px", color: loading ? "#1d4ed8" : open ? "#475569" : "#64748b" }}>
            {statusMessage}
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {!configReady && (
            <div style={{ fontSize: "11px", color: "#92400e" }}>Configure AI in Settings</div>
          )}
          <Button data-no-print="true" onClick={() => void handleGenerate()} disabled={loading}>
            {loading ? "Thinking..." : "Enhance With AI"}
          </Button>
        </div>
      </div>

      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.3)",
            display: "grid",
            placeItems: "center",
            zIndex: 10000,
            padding: "16px"
          }}
        >
          <div
            style={{
              width: "min(720px, 100%)",
              maxHeight: "80vh",
              overflow: "auto",
              border: loading ? "1px solid #93c5fd" : "1px solid #dbeafe",
              borderRadius: "16px",
              padding: "16px",
              background: loading ? "#eff6ff" : "#f8fbff",
              boxShadow: "0 24px 60px rgba(15, 23, 42, 0.18)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "start", marginBottom: "12px" }}>
              <div style={{ display: "grid", gap: "4px" }}>
                <div style={{ fontWeight: 800, fontSize: "14px", color: "#0f172a" }}>{title}</div>
                <div style={{ fontSize: "12px", color: loading ? "#1d4ed8" : "#475569" }}>
                  {loading ? "Generating live assistant response..." : statusMessage}
                </div>
              </div>
              <Button onClick={() => setOpen(false)} disabled={loading}>
                Close
              </Button>
            </div>

            {response ? (
              <div style={{ whiteSpace: "pre-wrap", fontSize: "12px", color: "#334155", lineHeight: 1.5 }}>
                {response}
              </div>
            ) : (
              <div style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.5 }}>
                {loading ? "Generating live assistant response..." : statusMessage}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

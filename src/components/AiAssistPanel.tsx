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
  const configReady = hasAiAssistantConfig(readAiAssistantConfig())

  async function handleGenerate() {
    setLoading(true)
    setOpen(true)

    try {
      const text = await requestAiAssistantResponse({
        feature,
        context,
        instruction
      })
      setResponse(text)
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI request failed."
      setResponse("")
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
        <div style={{ fontWeight: 800, color: "#0f172a" }}>{title}</div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {!configReady && (
            <div style={{ fontSize: "11px", color: "#92400e" }}>Configure AI in Settings</div>
          )}
          <Button data-no-print="true" onClick={() => void handleGenerate()} disabled={loading || !configReady}>
            {loading ? "Thinking..." : "Enhance With AI"}
          </Button>
        </div>
      </div>

      {open && (
        <div style={{ border: "1px solid #dbeafe", borderRadius: "12px", padding: "12px", background: "#f8fbff" }}>
          {response ? (
            <div style={{ whiteSpace: "pre-wrap", fontSize: "12px", color: "#334155", lineHeight: 1.45 }}>
              {response}
            </div>
          ) : (
            <div style={{ fontSize: "12px", color: "#64748b" }}>
              {loading ? "Generating live assistant response..." : "No AI output yet."}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export type AiAssistantConfig = {
  endpointUrl: string
  apiKey: string
  model: string
  systemPrompt: string
}

const AI_ASSISTANT_STORAGE_KEY = "scheduler.aiAssistantConfig"

const defaultAiAssistantConfig: AiAssistantConfig = {
  endpointUrl: "https://api.openai.com/v1/responses",
  apiKey: "",
  model: "gpt-5.4-mini",
  systemPrompt:
    "You are an operations scheduling assistant for public safety scheduling software. Give concise, practical answers. Prefer bullets. Explain fairness, staffing, audit, reporting, and configuration in plain language."
}

export function getDefaultAiAssistantConfig() {
  return { ...defaultAiAssistantConfig }
}

export function readAiAssistantConfig(): AiAssistantConfig {
  if (typeof window === "undefined") return getDefaultAiAssistantConfig()

  try {
    const raw = window.localStorage.getItem(AI_ASSISTANT_STORAGE_KEY)
    if (!raw) return getDefaultAiAssistantConfig()
    const parsed = JSON.parse(raw) as Partial<AiAssistantConfig>
    return {
      endpointUrl: parsed.endpointUrl || defaultAiAssistantConfig.endpointUrl,
      apiKey: parsed.apiKey || "",
      model: parsed.model || defaultAiAssistantConfig.model,
      systemPrompt: parsed.systemPrompt || defaultAiAssistantConfig.systemPrompt
    }
  } catch {
    return getDefaultAiAssistantConfig()
  }
}

export function saveAiAssistantConfig(config: AiAssistantConfig) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(AI_ASSISTANT_STORAGE_KEY, JSON.stringify(config))
}

export function hasAiAssistantConfig(config = readAiAssistantConfig()) {
  return config.endpointUrl.trim().length > 0 && config.apiKey.trim().length > 0 && config.model.trim().length > 0
}

function extractResponseText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  if (Array.isArray(payload?.output)) {
    const texts = payload.output
      .flatMap((entry: any) => Array.isArray(entry?.content) ? entry.content : [])
      .map((item: any) => item?.text || item?.output_text || "")
      .filter((value: string) => typeof value === "string" && value.trim().length > 0)

    if (texts.length > 0) return texts.join("\n\n").trim()
  }

  throw new Error("The AI provider returned an unreadable response.")
}

export async function requestAiAssistantResponse(params: {
  feature: string
  context: string
  instruction?: string
  config?: AiAssistantConfig
}) {
  const config = params.config || readAiAssistantConfig()

  if (!hasAiAssistantConfig(config)) {
    throw new Error("Configure the AI assistant in Settings first.")
  }

  const response = await fetch(config.endpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey.trim()}`
    },
    body: JSON.stringify({
      model: config.model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: config.systemPrompt
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Feature: ${params.feature}`,
                params.instruction || "Explain the current operational state and provide concrete guidance.",
                "",
                "Context:",
                params.context,
                "",
                "Return concise markdown with a short summary and flat bullet points."
              ].join("\n")
            }
          ]
        }
      ]
    })
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `AI request failed with status ${response.status}.`)
  }

  const payload = await response.json()
  return extractResponseText(payload)
}

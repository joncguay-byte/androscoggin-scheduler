import { supabase } from "./supabase"

export type AiAssistantConfig = {
  functionName: string
  model: string
  systemPrompt: string
}

const AI_ASSISTANT_STORAGE_KEY = "scheduler.aiAssistantConfig"

const defaultAiAssistantConfig: AiAssistantConfig = {
  functionName: "ai-assistant",
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
      functionName: parsed.functionName || defaultAiAssistantConfig.functionName,
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
  return config.functionName.trim().length > 0 && config.model.trim().length > 0
}

function extractFunctionText(payload: any): string {
  if (typeof payload?.text === "string" && payload.text.trim()) {
    return payload.text.trim()
  }
  throw new Error(payload?.error || "The AI function returned an unreadable response.")
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

  const { data, error } = await supabase.functions.invoke(config.functionName, {
    body: {
      feature: params.feature,
      context: params.context,
      instruction: params.instruction || "Explain the current operational state and provide concrete guidance.",
      model: config.model,
      systemPrompt: config.systemPrompt
    }
  })

  if (error) {
    throw new Error(error.message || "AI function request failed.")
  }

  return extractFunctionText(data)
}

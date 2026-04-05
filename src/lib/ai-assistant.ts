import { supabaseAnonKey, supabaseUrl } from "./supabase"

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

async function extractHttpErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.clone().json()
    if (typeof payload?.error === "string" && payload.error.trim()) {
      return payload.error.trim()
    }
    if (typeof payload?.message === "string" && payload.message.trim()) {
      return payload.message.trim()
    }
  } catch {
    // Fall through to text parsing.
  }

  try {
    const text = await response.clone().text()
    if (typeof text === "string" && text.trim()) {
      return text.trim()
    }
  } catch {
    // Fall through to status parsing.
  }

  return `AI function request failed with status ${response.status}.`
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

  const response = await fetch(`${supabaseUrl}/functions/v1/${config.functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`
    },
    body: JSON.stringify({
      feature: params.feature,
      context: params.context,
      instruction: params.instruction || "Explain the current operational state and provide concrete guidance.",
      model: config.model,
      systemPrompt: config.systemPrompt
    })
  })

  if (!response.ok) {
    throw new Error(await extractHttpErrorMessage(response))
  }

  return extractFunctionText(await response.json())
}

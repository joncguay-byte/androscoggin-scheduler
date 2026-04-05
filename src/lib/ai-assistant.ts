import { supabaseAnonKey, supabaseUrl } from "./supabase"

export type AiAssistantConfig = {
  functionName: string
  model: string
  systemPrompt: string
  maxCallsPerMonth: number
  maxContextChars: number
}

const AI_ASSISTANT_STORAGE_KEY = "scheduler.aiAssistantConfig"
const AI_ASSISTANT_USAGE_STORAGE_KEY = "scheduler.aiAssistantUsage"

const defaultAiAssistantConfig: AiAssistantConfig = {
  functionName: "ai-assistant",
  model: "gpt-5.4-mini",
  systemPrompt:
    "You are an operations scheduling assistant for public safety scheduling software. Give concise, practical answers. Prefer bullets. Explain fairness, staffing, audit, reporting, and configuration in plain language. Keep responses under 150 words unless the user explicitly asks for more.",
  maxCallsPerMonth: 50,
  maxContextChars: 12000
}

type AiAssistantUsage = {
  monthKey: string
  calls: number
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
      systemPrompt: parsed.systemPrompt || defaultAiAssistantConfig.systemPrompt,
      maxCallsPerMonth:
        typeof parsed.maxCallsPerMonth === "number" && Number.isFinite(parsed.maxCallsPerMonth)
          ? Math.max(0, Math.floor(parsed.maxCallsPerMonth))
          : defaultAiAssistantConfig.maxCallsPerMonth,
      maxContextChars:
        typeof parsed.maxContextChars === "number" && Number.isFinite(parsed.maxContextChars)
          ? Math.max(1000, Math.floor(parsed.maxContextChars))
          : defaultAiAssistantConfig.maxContextChars
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

function getCurrentMonthKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

export function readAiAssistantUsage(): AiAssistantUsage {
  if (typeof window === "undefined") {
    return { monthKey: getCurrentMonthKey(), calls: 0 }
  }

  try {
    const raw = window.localStorage.getItem(AI_ASSISTANT_USAGE_STORAGE_KEY)
    if (!raw) {
      return { monthKey: getCurrentMonthKey(), calls: 0 }
    }
    const parsed = JSON.parse(raw) as Partial<AiAssistantUsage>
    const currentMonthKey = getCurrentMonthKey()
    if (parsed.monthKey !== currentMonthKey) {
      return { monthKey: currentMonthKey, calls: 0 }
    }
    return {
      monthKey: currentMonthKey,
      calls: typeof parsed.calls === "number" && Number.isFinite(parsed.calls) ? Math.max(0, Math.floor(parsed.calls)) : 0
    }
  } catch {
    return { monthKey: getCurrentMonthKey(), calls: 0 }
  }
}

function saveAiAssistantUsage(usage: AiAssistantUsage) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(AI_ASSISTANT_USAGE_STORAGE_KEY, JSON.stringify(usage))
}

function incrementAiAssistantUsage() {
  const usage = readAiAssistantUsage()
  const nextUsage = {
    ...usage,
    calls: usage.calls + 1
  }
  saveAiAssistantUsage(nextUsage)
  return nextUsage
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

  const trimmedContext = params.context.trim()
  if (trimmedContext.length > config.maxContextChars) {
    throw new Error(
      `This AI request is too large (${trimmedContext.length.toLocaleString()} chars). Narrow the selection or reduce context below ${config.maxContextChars.toLocaleString()} characters.`
    )
  }

  const usage = readAiAssistantUsage()
  if (config.maxCallsPerMonth > 0 && usage.calls >= config.maxCallsPerMonth) {
    throw new Error(
      `Monthly AI limit reached (${usage.calls}/${config.maxCallsPerMonth}). Raise the cap in Settings or wait until next month.`
    )
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

  const text = extractFunctionText(await response.json())
  incrementAiAssistantUsage()
  return text
}

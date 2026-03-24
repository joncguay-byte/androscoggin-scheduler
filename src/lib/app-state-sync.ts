import { supabase } from "./supabase"

const APP_STATE_TABLE = "app_state"

type AppStateRow = {
  state_key: string
  payload: unknown
  updated_at?: string
}

export type AppStateLoadResult<T> = {
  data: T | null
  error: string | null
}

export type AppStateSaveResult = {
  ok: boolean
  error: string | null
}

export type AppStateLoadMapResult<T> = {
  data: Partial<Record<string, T>>
  error: string | null
}

function toErrorMessage(error: unknown) {
  if (!error) return "Unknown Supabase sync error."
  if (typeof error === "string") return error
  if (typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message
  }

  return "Unknown Supabase sync error."
}

export async function loadSupabaseAppState<T>(stateKey: string): Promise<AppStateLoadResult<T>> {
  try {
    const { data, error } = await supabase
      .from(APP_STATE_TABLE)
      .select("payload")
      .eq("state_key", stateKey)
      .maybeSingle()

    if (error) {
      return {
        data: null,
        error: toErrorMessage(error)
      }
    }

    return {
      data: (data?.payload as T | undefined) ?? null,
      error: null
    }
  } catch (error) {
    return {
      data: null,
      error: toErrorMessage(error)
    }
  }
}

export async function saveSupabaseAppState(stateKey: string, payload: unknown): Promise<AppStateSaveResult> {
  const row: AppStateRow = {
    state_key: stateKey,
    payload,
    updated_at: new Date().toISOString()
  }

  try {
    const { error } = await supabase
      .from(APP_STATE_TABLE)
      .upsert(row, { onConflict: "state_key" })

    if (error) {
      return {
        ok: false,
        error: toErrorMessage(error)
      }
    }

    return {
      ok: true,
      error: null
    }
  } catch (error) {
    return {
      ok: false,
      error: toErrorMessage(error)
    }
  }
}

export async function loadSupabaseAppStates<T>(stateKeys: string[]): Promise<AppStateLoadMapResult<T>> {
  if (stateKeys.length === 0) {
    return {
      data: {},
      error: null
    }
  }

  try {
    const { data, error } = await supabase
      .from(APP_STATE_TABLE)
      .select("state_key,payload")
      .in("state_key", stateKeys)

    if (error) {
      return {
        data: {},
        error: toErrorMessage(error)
      }
    }

    const mapped = Object.fromEntries(
      ((data || []) as Array<Pick<AppStateRow, "state_key" | "payload">>).map((row) => [row.state_key, row.payload as T])
    )

    return {
      data: mapped,
      error: null
    }
  } catch (error) {
    return {
      data: {},
      error: toErrorMessage(error)
    }
  }
}

export async function saveSupabaseAppStates(stateRows: Array<{ stateKey: string; payload: unknown }>): Promise<AppStateSaveResult> {
  if (stateRows.length === 0) {
    return {
      ok: true,
      error: null
    }
  }

  const rows: AppStateRow[] = stateRows.map(({ stateKey, payload }) => ({
    state_key: stateKey,
    payload,
    updated_at: new Date().toISOString()
  }))

  try {
    const { error } = await supabase
      .from(APP_STATE_TABLE)
      .upsert(rows, { onConflict: "state_key" })

    if (error) {
      return {
        ok: false,
        error: toErrorMessage(error)
      }
    }

    return {
      ok: true,
      error: null
    }
  } catch (error) {
    return {
      ok: false,
      error: toErrorMessage(error)
    }
  }
}

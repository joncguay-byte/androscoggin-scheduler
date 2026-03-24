import { supabase } from "./supabase"
import type { PatrolScheduleRow } from "../types"

const PATROL_OVERRIDES_TABLE = "patrol_overrides"

type PatrolOverridesLoadResult = {
  data: PatrolScheduleRow[] | null
  error: string | null
}

type PatrolOverridesSaveResult = {
  ok: boolean
  error: string | null
}

function toErrorMessage(error: unknown) {
  if (!error) return "Unknown Supabase patrol override sync error."
  if (typeof error === "string") return error
  if (typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message
  }

  return "Unknown Supabase patrol override sync error."
}

export async function loadSupabasePatrolOverrides(): Promise<PatrolOverridesLoadResult> {
  try {
    const { data, error } = await supabase
      .from(PATROL_OVERRIDES_TABLE)
      .select("assignment_date,shift_type,position_code,employee_id,vehicle,shift_hours,status,replacement_employee_id,replacement_vehicle,replacement_hours")
      .order("assignment_date", { ascending: true })
      .order("shift_type", { ascending: true })
      .order("position_code", { ascending: true })

    if (error) {
      return {
        data: null,
        error: toErrorMessage(error)
      }
    }

    return {
      data: (data || []) as PatrolScheduleRow[],
      error: null
    }
  } catch (error) {
    return {
      data: null,
      error: toErrorMessage(error)
    }
  }
}

export async function saveSupabasePatrolOverrides(rows: PatrolScheduleRow[]): Promise<PatrolOverridesSaveResult> {
  try {
    const { error: deleteError } = await supabase
      .from(PATROL_OVERRIDES_TABLE)
      .delete()
      .neq("assignment_date", "")

    if (deleteError) {
      return {
        ok: false,
        error: toErrorMessage(deleteError)
      }
    }

    if (rows.length === 0) {
      return {
        ok: true,
        error: null
      }
    }

    const payload = rows.map((row) => ({
      assignment_date: row.assignment_date,
      shift_type: row.shift_type,
      position_code: row.position_code,
      employee_id: row.employee_id,
      vehicle: row.vehicle,
      shift_hours: row.shift_hours,
      status: row.status,
      replacement_employee_id: row.replacement_employee_id,
      replacement_vehicle: row.replacement_vehicle,
      replacement_hours: row.replacement_hours
    }))

    const { error: insertError } = await supabase
      .from(PATROL_OVERRIDES_TABLE)
      .insert(payload)

    if (insertError) {
      return {
        ok: false,
        error: toErrorMessage(insertError)
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

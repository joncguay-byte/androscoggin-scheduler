import { supabase } from "./supabase"
import type { PatrolScheduleRow } from "../types"

const patrolRangeCache = new Map<string, PatrolScheduleRow[]>()
const patrolRangeInFlight = new Map<string, Promise<PatrolScheduleRow[]>>()

function getRangeKey(startDate: string, endDate: string) {
  return `${startDate}:${endDate}`
}

export function invalidatePatrolScheduleCache() {
  patrolRangeCache.clear()
  patrolRangeInFlight.clear()
}

export async function fetchPatrolScheduleRange(startDate: string, endDate: string) {
  const key = getRangeKey(startDate, endDate)

  if (patrolRangeCache.has(key)) {
    return {
      data: patrolRangeCache.get(key) || [],
      error: null
    }
  }

  if (patrolRangeInFlight.has(key)) {
    try {
      const rows = await patrolRangeInFlight.get(key)!
      return { data: rows, error: null }
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error : new Error("Failed to load patrol schedule")
      }
    }
  }

  const request = (async () => {
    const { data, error } = await supabase
      .from("patrol_schedule")
      .select("id,assignment_date,shift_type,position_code,employee_id,vehicle,shift_hours,status,replacement_employee_id,replacement_vehicle,replacement_hours")
      .gte("assignment_date", startDate)
      .lte("assignment_date", endDate)
      .order("assignment_date", { ascending: true })

    try {
      if (error) {
        throw error
      }

      const rows = (data || []) as PatrolScheduleRow[]
      patrolRangeCache.set(key, rows)
      return rows
    } finally {
      patrolRangeInFlight.delete(key)
    }
  })()

  patrolRangeInFlight.set(key, request)

  try {
    const rows = await request
    return { data: rows, error: null }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error : new Error("Failed to load patrol schedule")
    }
  }
}

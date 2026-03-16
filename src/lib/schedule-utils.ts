import { supabase } from "./supabase"

export async function fetchSchedule() {

  const { data, error } = await supabase
    .from("patrol_schedule")
    .select("*")

  if (error) {
    console.error("Schedule fetch error:", error)
    return []
  }

  return data
}



export async function saveScheduleCell(cell) {

  const { error } = await supabase
    .from("patrol_schedule")
    .upsert(cell)

  if (error) {
    console.error("Schedule save error:", error)
  }

}



export function subscribeToSchedule(callback) {

  const channel = supabase
    .channel("schedule_changes")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "patrol_schedule"
      },
      payload => {
        callback(payload)
      }
    )
    .subscribe()

  return channel

}
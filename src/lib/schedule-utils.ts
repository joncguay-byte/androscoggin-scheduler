import { supabase } from "./supabase"


/* =========================
   SUPABASE DATABASE
========================= */

export async function fetchSchedule() {

  const { data, error } = await supabase
    .from("patrol_schedule")
    .select("*")

  if (error) {
    console.error(error)
    return []
  }

  return data
}


export async function saveScheduleCell(cell:any) {

  const { error } = await supabase
    .from("patrol_schedule")
    .upsert(cell)

  if (error) console.error(error)

}


export function subscribeToSchedule(callback:any) {

  const channel = supabase
    .channel("schedule_changes")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "patrol_schedule"
      },
      payload => callback(payload)
    )
    .subscribe()

  return channel
}



/* =========================
   DATE UTILITIES
========================= */

export function formatShortDate(d:Date) {

  return d.toLocaleDateString(undefined,{
    weekday:"short",
    month:"numeric",
    day:"numeric"
  })

}


export function formatLongDate(d:Date) {

  return d.toLocaleDateString(undefined,{
    month:"long",
    day:"numeric",
    year:"numeric"
  })

}


export function buildVisibleDates(baseDate:Date, view:string) {

  const dates:Date[] = []

  if(view === "day") {

    dates.push(baseDate)

  }

  else if(view === "week") {

    for(let i=0;i<7;i++){
      const d=new Date(baseDate)
      d.setDate(baseDate.getDate()+i)
      dates.push(d)
    }

  }

  else if(view === "two_week") {

    for(let i=0;i<14;i++){
      const d=new Date(baseDate)
      d.setDate(baseDate.getDate()+i)
      dates.push(d)
    }

  }

  else {

    const lastDay = new Date(baseDate.getFullYear(), baseDate.getMonth()+1,0).getDate()

    for(let i=1;i<=lastDay;i++){
      dates.push(new Date(baseDate.getFullYear(), baseDate.getMonth(), i))
    }

  }

  return dates

}



/* =========================
   PATROL SCHEDULE
========================= */

export function buildPatrolCellsForDate(date:any, employees:any[]) {

  return []

}



/* =========================
   TEAM ROTATION
========================= */

export function getActiveTeam(date:Date, shift:"Days"|"Nights") {

  const pitman = [0,1,1,0,0,1,1,1,0,0,1,1,0,0]

  const start = new Date("2024-01-01")

  const diff = Math.floor(
    (date.getTime() - start.getTime()) / (1000*60*60*24)
  )

  const idx = pitman[Math.abs(diff) % pitman.length]

  if(shift==="Days") {
    return idx ? "Days A" : "Days B"
  }

  return idx ? "Nights A" : "Nights B"

}



/* =========================
   STAFFING VALIDATION
========================= */

export function validateMinimumStaffing(cells:any[]) {

  const supervisors = cells.filter(c=>c.positionCode?.startsWith("SUP") && c.employeeId)
  const deputies = cells.filter(c=>c.positionCode?.startsWith("DEP") && c.employeeId)
  const poland = cells.find(c=>c.positionCode==="POL" && c.employeeId)

  return {
    ok: supervisors.length>0 && deputies.length>1 && poland
  }

}
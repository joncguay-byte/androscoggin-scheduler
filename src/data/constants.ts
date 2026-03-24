import type { PatrolPositionCode, PatrolStatus, ScheduleView } from "../types"

export const patrolPositions = [
  { code: "SUP1" as PatrolPositionCode, label: "Supervisor" },
  { code: "SUP2" as PatrolPositionCode, label: "Supervisor" },
  { code: "DEP1" as PatrolPositionCode, label: "Deputy" },
  { code: "DEP2" as PatrolPositionCode, label: "Deputy" },
  { code: "POL" as PatrolPositionCode, label: "Poland" }
]

export const scheduleViews = [
  { value: "month" as ScheduleView, label: "Month" },
  { value: "two_week" as ScheduleView, label: "2 Week" },
  { value: "week" as ScheduleView, label: "Week" },
  { value: "day" as ScheduleView, label: "Day" }
]

export const statusOptions: PatrolStatus[] = [
  "Scheduled",
  "Sick",
  "Vacation",
  "Court",
  "Training",
  "FMLA",
  "Professional Leave",
  "Bereavement",
  "Call Out",
  "Detail",
  "Extra",
  "Swap",
  "Open Shift",
  "Off"
]

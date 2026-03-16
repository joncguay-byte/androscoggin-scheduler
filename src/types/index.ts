export type AppRole = "admin" | "sergeant" | "detective" | "deputy"

export type Rank =
  | "Sgt"
  | "Cpl"
  | "Deputy"
  | "Poland Deputy"
  | "Detective"

export type Team =
  | "Days A"
  | "Days B"
  | "Nights A"
  | "Nights B"
  | "CID"
  | "SRO"
  | "None"

export type ScheduleView =
  | "month"
  | "two_week"
  | "week"
  | "day"

export type ShiftType = "Days" | "Nights"

export type PatrolPositionCode =
  | "SUP1"
  | "SUP2"
  | "DEP1"
  | "DEP2"
  | "POL"

export type PatrolStatus =
  | "Scheduled"
  | "Sick"
  | "Vacation"
  | "Court"
  | "Training"
  | "FMLA"
  | "Professional Leave"
  | "Bereavement"
  | "Call Out"
  | "Detail"
  | "Extra"
  | "Swap"
  | "Open Shift"
  | "Off"

export type Employee = {
  id: string
  firstName: string
  lastName: string
  rank: Rank
  team: Team
  defaultVehicle: string
  defaultShiftHours: string
  hireDate: string
  status: "Active" | "Inactive"
}

export type PatrolCellRecord = {
  id: string
  assignmentDate: string
  shiftType: ShiftType
  team: Team
  positionCode: PatrolPositionCode
  employeeId: string | null
  vehicle: string | null
  shiftHours: string | null
  status: PatrolStatus
  replacementEmployeeId: string | null
  replacementVehicle: string | null
  replacementHours: string | null
}
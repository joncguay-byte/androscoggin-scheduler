import type { Employee } from "../types"

const preferredCidRotationOrder = [
  "Moe Drouin",
  "Troy Young",
  "Nate McNally",
  "Mike Mejia"
] as const

export function addDays(date: Date, days: number) {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function startOfWeek(date: Date) {
  const copy = new Date(date)
  const day = copy.getDay()
  const daysSinceMonday = (day + 6) % 7
  copy.setDate(copy.getDate() - daysSinceMonday)
  copy.setHours(0, 0, 0, 0)
  return copy
}

export function endOfWeek(date: Date) {
  return addDays(startOfWeek(date), 6)
}

export function startOfCidRotationWeek(date: Date) {
  const copy = new Date(date)
  const day = copy.getDay()
  const hours = copy.getHours()
  const daysSinceMonday = (day + 6) % 7

  copy.setDate(copy.getDate() - daysSinceMonday)
  copy.setHours(5, 0, 0, 0)

  const isBeforeMondayFiveAm = day === 1 && hours < 5

  if (isBeforeMondayFiveAm) {
    copy.setDate(copy.getDate() - 7)
  }

  return copy
}

export function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

export function buildCalendarDays(baseDate: Date) {
  const firstDay = startOfMonth(baseDate)
  const gridStart = startOfWeek(firstDay)
  const lastDay = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0)
  const gridEnd = endOfWeek(lastDay)
  const dates: Date[] = []

  for (let cursor = new Date(gridStart); cursor <= gridEnd; cursor = addDays(cursor, 1)) {
    dates.push(new Date(cursor))
  }

  return dates
}

export function getCidRoster(employees: Employee[]) {
  const roster = employees.filter(
    (employee) =>
      employee.status === "Active" &&
      employee.team === "CID" &&
      (employee.rank === "Detective" || employee.rank === "Sgt")
  )

  return [...roster].sort((a, b) => {
    const aName = `${a.firstName} ${a.lastName}`
    const bName = `${b.firstName} ${b.lastName}`
    const aIndex = preferredCidRotationOrder.indexOf(aName as (typeof preferredCidRotationOrder)[number])
    const bIndex = preferredCidRotationOrder.indexOf(bName as (typeof preferredCidRotationOrder)[number])

    if (aIndex !== -1 || bIndex !== -1) {
      if (aIndex === -1) return 1
      if (bIndex === -1) return -1
      return aIndex - bIndex
    }

    return a.hireDate.localeCompare(b.hireDate)
  })
}

function mod(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor
}

export function getPrimaryCidDetectiveForDate(
  date: Date,
  employees: Employee[],
  rotationStartDate: string
) {
  const cidRoster = getCidRoster(employees)

  if (cidRoster.length === 0) return null

  const rotationAnchor = new Date(`${rotationStartDate}T05:00:00`)
  const weekStart = startOfCidRotationWeek(date)
  const diffInWeeks = Math.floor(
    (weekStart.getTime() - rotationAnchor.getTime()) / (7 * 24 * 60 * 60 * 1000)
  )

  return cidRoster[mod(diffInWeeks, cidRoster.length)]
}

export function getDisplayedCidDetectiveForDate(
  date: Date,
  employees: Employee[],
  rotationStartDate: string
) {
  const cidRoster = getCidRoster(employees)

  if (cidRoster.length === 0) return null

  const rotationAnchor = startOfWeek(new Date(`${rotationStartDate}T12:00:00`))
  const displayedWeekStart = startOfWeek(date)
  const diffInWeeks = Math.floor(
    (displayedWeekStart.getTime() - rotationAnchor.getTime()) / (7 * 24 * 60 * 60 * 1000)
  )

  return cidRoster[mod(diffInWeeks, cidRoster.length)]
}

export function getEffectiveCidOnCallForDate(
  date: Date,
  employees: Employee[],
  rotationStartDate: string,
  dailyOverrides: Record<string, string>
) {
  const cidRoster = getCidRoster(employees)
  const overrideId = dailyOverrides[toIsoDate(date)]

  if (overrideId) {
    return cidRoster.find((employee) => employee.id === overrideId) || null
  }

  return getPrimaryCidDetectiveForDate(date, employees, rotationStartDate)
}

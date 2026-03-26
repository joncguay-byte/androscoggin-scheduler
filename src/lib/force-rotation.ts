import type { Employee, ForceHistoryRow } from "../types"

function getEmployeeForceDates(forceHistory: ForceHistoryRow[], employeeId: string) {
  return forceHistory
    .filter((row) => row.employee_id === employeeId)
    .map((row) => row.forced_date)
    .sort((a, b) => b.localeCompare(a))
}

export function buildForceRotationOrder(employees: Employee[], forceHistory: ForceHistoryRow[]) {
  return [...employees].sort((a, b) => {
    const aDates = getEmployeeForceDates(forceHistory, a.id)
    const bDates = getEmployeeForceDates(forceHistory, b.id)
    const aLast = aDates[0] || ""
    const bLast = bDates[0] || ""

    if (!aLast && !bLast) {
      return a.hireDate.localeCompare(b.hireDate)
    }

    if (!aLast) return -1
    if (!bLast) return 1

    if (aLast !== bLast) {
      return aLast.localeCompare(bLast)
    }

    const aPrevious = aDates[1] || ""
    const bPrevious = bDates[1] || ""
    if (aPrevious !== bPrevious) {
      if (!aPrevious) return -1
      if (!bPrevious) return 1
      return aPrevious.localeCompare(bPrevious)
    }

    return a.hireDate.localeCompare(b.hireDate)
  })
}

export function getEmployeeForceSummary(forceHistory: ForceHistoryRow[], employeeId: string) {
  const dates = getEmployeeForceDates(forceHistory, employeeId)
  return {
    total: dates.length,
    last1: dates[0] || "-",
    last2: dates[1] || "-"
  }
}

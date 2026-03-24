type ForceRecord = {
  employeeId: string
  lastForcedDates: string[]
  totalForced: number
}

// sort by fairness: lowest total, then oldest last forced
export function calculateForceList(
  employees: any[],
  history: Record<string, ForceRecord>
) {
  return employees
    .map((emp) => {
      const record = history[emp.id] || {
        employeeId: emp.id,
        lastForcedDates: [],
        totalForced: 0
      }

      return {
        ...emp,
        ...record
      }
    })
    .sort((a, b) => {
      if (a.totalForced !== b.totalForced) {
        return a.totalForced - b.totalForced
      }

      const aLast = a.lastForcedDates[0] || ""
      const bLast = b.lastForcedDates[0] || ""

      return aLast.localeCompare(bLast)
    })
}

export function recordForce(
  employeeId: string,
  history: Record<string, ForceRecord>,
  date: string
) {
  const existing = history[employeeId] || {
    employeeId,
    lastForcedDates: [],
    totalForced: 0
  }

  const updatedDates = [date, ...existing.lastForcedDates].slice(0, 2)

  return {
    ...history,
    [employeeId]: {
      employeeId,
      lastForcedDates: updatedDates,
      totalForced: existing.totalForced + 1
    }
  }
}
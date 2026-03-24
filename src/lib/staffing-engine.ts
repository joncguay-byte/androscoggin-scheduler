type StaffingRow = {
  assignment_date: string
  shift_type: string
  position_code: string
  employee_id: string | null
  replacement_employee_id?: string | null
  status?: string | null
}

const supervisorPositions = new Set(["SUP1", "SUP2"])

export function isShiftCovered(row: StaffingRow | null | undefined) {
  if (!row) return false
  if (row.replacement_employee_id) return true
  if (row.employee_id && row.status === "Scheduled") return true
  return false
}

export function isForceRequired(
  row: StaffingRow | null | undefined,
  shiftRows: StaffingRow[]
) {
  if (!row) return false

  const relevantRows = shiftRows.filter(
    (shiftRow) =>
      shiftRow.assignment_date === row.assignment_date &&
      shiftRow.shift_type === row.shift_type
  )

  if (relevantRows.length === 0) return false

  const coveredRows = relevantRows.filter((shiftRow) => isShiftCovered(shiftRow))
  const coveredSupervisors = coveredRows.filter((shiftRow) =>
    supervisorPositions.has(shiftRow.position_code)
  )

  const bothSupervisorsOff = coveredSupervisors.length === 0
  const belowMinimumStaff = coveredRows.length < 4

  return bothSupervisorsOff || belowMinimumStaff
}

import { useEffect, useState } from "react"

import { supabase } from "../../lib/supabase"
import { printElementById } from "../../lib/print"
import type { DetailRecord, Employee, ForceHistoryRow, OvertimeEntry } from "../../types"

type ForceListRow = Employee & {
  total: number
  last1: string
  last2: string
  daysSince: number | "Never"
  totalOvertimeHours: number
}

export function ForcePage({
  employees,
  overtimeEntries,
  detailRecords,
  forceHistory,
  setForceHistory,
  onAuditEvent
}: {
  employees: Employee[]
  overtimeEntries: OvertimeEntry[]
  detailRecords: DetailRecord[]
  forceHistory: ForceHistoryRow[]
  setForceHistory: React.Dispatch<React.SetStateAction<ForceHistoryRow[]>>
  onAuditEvent?: (action: string, summary: string, details?: string) => void
}) {
  const [draftDatesByEmployee, setDraftDatesByEmployee] = useState<Record<string, { last1: string; last2: string }>>({})
  const [undoStack, setUndoStack] = useState<Array<{ rows: ForceHistoryRow[]; employeeIds: string[] }>>([])

  useEffect(() => {
    const nextDrafts: Record<string, { last1: string; last2: string }> = {}

    for (const employee of employees) {
      const records = forceHistory
        .filter((record) => record.employee_id === employee.id)
        .sort((a, b) => b.forced_date.localeCompare(a.forced_date))

      nextDrafts[employee.id] = {
        last1: records[0]?.forced_date || "",
        last2: records[1]?.forced_date || ""
      }
    }

    setDraftDatesByEmployee(nextDrafts)
  }, [employees, forceHistory])

  function pushUndoSnapshot(employeeIds: string[]) {
    const snapshot = forceHistory.map((row) => ({ ...row }))
    setUndoStack((current) => [{ rows: snapshot, employeeIds }, ...current].slice(0, 10))
  }

  async function syncForceHistoryForEmployees(nextRows: ForceHistoryRow[], employeeIds: string[]) {
    for (const employeeId of employeeIds) {
      await supabase
        .from("force_history")
        .delete()
        .eq("employee_id", employeeId)

      const employeeRows = nextRows.filter((row) => row.employee_id === employeeId)
      if (employeeRows.length > 0) {
        await supabase
          .from("force_history")
          .insert(employeeRows.map((row) => ({
            employee_id: row.employee_id,
            forced_date: row.forced_date
          })))
      }
    }
  }

  function buildForceList(): ForceListRow[] {
    return employees
      .map((employee) => {
        const records = forceHistory
          .filter((record) => record.employee_id === employee.id)
          .sort((a, b) =>
            b.forced_date.localeCompare(a.forced_date)
          )

        const lastDate = records[0]?.forced_date
        let daysSince: number | "Never" = "Never"

        if (lastDate) {
          const diff =
            (new Date().getTime() - new Date(lastDate).getTime()) /
            86400000
          daysSince = Math.floor(diff)
        }

        const manualOvertimeHours = overtimeEntries
          .filter((entry) => entry.employeeId === employee.id)
          .reduce((total, entry) => total + entry.hours, 0)

        const detailOvertimeHours = detailRecords
          .filter((detail) => detail.employeeId === employee.id && detail.status === "Accepted")
          .reduce((total, detail) => total + detail.hours, 0)

        return {
          ...employee,
          total: records.length,
          last1: records[0]?.forced_date || "-",
          last2: records[1]?.forced_date || "-",
          daysSince,
          totalOvertimeHours: manualOvertimeHours + detailOvertimeHours
        }
      })
      .sort((a, b) => {
        return a.hireDate.localeCompare(b.hireDate)
      })
  }

  async function forceEmployee(empId: string) {
    const today = new Date().toISOString().slice(0, 10)

    pushUndoSnapshot([empId])

    const nextRows = [
      { employee_id: empId, forced_date: today },
      ...forceHistory
    ]

    setForceHistory(nextRows)
    setDraftDatesByEmployee((current) => ({
      ...current,
      [empId]: {
        last1: today,
        last2: current[empId]?.last1 || ""
      }
    }))

    await syncForceHistoryForEmployees(nextRows, [empId])

    const employee = employees.find((row) => row.id === empId)
    onAuditEvent?.(
      "Force Added",
      `Added force entry for ${employee ? `${employee.firstName} ${employee.lastName}` : "Unknown employee"}.`,
      `Forced date: ${today}`
    )
  }

  async function saveForceDates(employeeId: string) {
    const draft = draftDatesByEmployee[employeeId] || { last1: "", last2: "" }
    const cleanedDates = [draft.last1, draft.last2]
      .filter((value) => value.trim().length > 0)
      .filter((value, index, array) => array.indexOf(value) === index)
      .sort((a, b) => b.localeCompare(a))

    pushUndoSnapshot([employeeId])

    const remainingRows = forceHistory.filter((row) => row.employee_id !== employeeId)
    const nextRows = [
      ...remainingRows,
      ...cleanedDates.map((forcedDate) => ({
        employee_id: employeeId,
        forced_date: forcedDate
      }))
    ]

    setForceHistory(nextRows)
    setDraftDatesByEmployee((current) => ({
      ...current,
      [employeeId]: {
        last1: cleanedDates[0] || "",
        last2: cleanedDates[1] || ""
      }
    }))

    await syncForceHistoryForEmployees(nextRows, [employeeId])

    const employee = employees.find((row) => row.id === employeeId)
    onAuditEvent?.(
      "Force Dates Saved",
      `Updated force dates for ${employee ? `${employee.firstName} ${employee.lastName}` : "employee"}.`,
      `Last Force: ${cleanedDates[0] || "-"} | Previous Force: ${cleanedDates[1] || "-"}`
    )
  }

  async function undoForceAction() {
    const previous = undoStack[0]
    if (!previous) return

    setUndoStack((current) => current.slice(1))
    setForceHistory(previous.rows)
    await syncForceHistoryForEmployees(previous.rows, previous.employeeIds)

    onAuditEvent?.(
      "Force Undo",
      "Undid the previous force rotation change."
    )
  }

  const forceList = buildForceList()

  return (
    <div id="force-print-section" style={{ padding: "20px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          marginBottom: "12px",
          flexWrap: "wrap"
        }}
      >
        <h2>Force Rotation</h2>
        <button
          data-no-print="true"
          onClick={() => printElementById("force-print-section", "Force Rotation")}
        >
          Print Force
        </button>
        <button
          data-no-print="true"
          onClick={() => void undoForceAction()}
          disabled={undoStack.length === 0}
        >
          Undo
        </button>
      </div>

      {forceList.map((employee, index) => (
        <div
          key={employee.id}
          style={{
            display: "grid",
            gridTemplateColumns: "40px 190px 100px 150px 150px 140px 120px 120px",
            padding: "8px",
            borderBottom: "1px solid #e5e7eb",
            alignItems: "center",
            background: index === 0 ? "#dcfce7" : "white"
          }}
        >
          <div>{index + 1}</div>

          <div>
            {employee.lastName}, {employee.firstName}
          </div>

          <div>
            Forced: <strong>{employee.total}</strong>
          </div>

          <div style={{ fontSize: "12px", color: "#475569", display: "grid", gap: "4px" }}>
            <div>Last Force</div>
            <input
              type="date"
              value={draftDatesByEmployee[employee.id]?.last1 || ""}
              onChange={(event) =>
                setDraftDatesByEmployee((current) => ({
                  ...current,
                  [employee.id]: {
                    last1: event.target.value,
                    last2: current[employee.id]?.last2 || ""
                  }
                }))
              }
            />
          </div>

          <div style={{ fontSize: "12px", color: "#475569", display: "grid", gap: "4px" }}>
            <div>Previous Force</div>
            <input
              type="date"
              value={draftDatesByEmployee[employee.id]?.last2 || ""}
              onChange={(event) =>
                setDraftDatesByEmployee((current) => ({
                  ...current,
                  [employee.id]: {
                    last1: current[employee.id]?.last1 || "",
                    last2: event.target.value
                  }
                }))
              }
            />
          </div>

          <div style={{ fontSize: "12px", color: "#16a34a" }}>
            <div>Lowest total forced: {employee.total}</div>
            <div>Last forced: {employee.daysSince} days ago</div>
          </div>

          <div style={{ fontSize: "12px", color: "#1e3a8a", fontWeight: 700 }}>
            Total Overtime: {employee.totalOvertimeHours.toFixed(1)}
          </div>

          <button onClick={() => void forceEmployee(employee.id)}>
            Force
          </button>

          <button onClick={() => void saveForceDates(employee.id)}>
            Save
          </button>
        </div>
      ))}
    </div>
  )
}

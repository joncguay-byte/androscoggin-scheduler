import { useEffect, useState } from "react"

import { supabase } from "../../lib/supabase"
import { printElementById } from "../../lib/print"
import { buildForceRotationOrder, getEmployeeForceSummary } from "../../lib/force-rotation"
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
  onAuditEvent,
  readOnly = false
}: {
  employees: Employee[]
  overtimeEntries: OvertimeEntry[]
  detailRecords: DetailRecord[]
  forceHistory: ForceHistoryRow[]
  setForceHistory: React.Dispatch<React.SetStateAction<ForceHistoryRow[]>>
  onAuditEvent?: (action: string, summary: string, details?: string) => void
  readOnly?: boolean
}) {
  const [draftDatesByEmployee, setDraftDatesByEmployee] = useState<Record<string, { last1: string; last2: string }>>({})
  const [undoStack, setUndoStack] = useState<Array<{ rows: ForceHistoryRow[]; employeeIds: string[] }>>([])
  const [showForceHistory, setShowForceHistory] = useState(false)
  const [historyDrafts, setHistoryDrafts] = useState<Record<string, string>>({})
  const [selectedHistoryRows, setSelectedHistoryRows] = useState<string[]>([])

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

  useEffect(() => {
    const nextDrafts: Record<string, string> = {}
    forceHistory.forEach((row, index) => {
      nextDrafts[`${row.employee_id}-${row.forced_date}-${index}`] = row.forced_date
    })
    setHistoryDrafts(nextDrafts)
  }, [forceHistory])

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
    return buildForceRotationOrder(employees, forceHistory)
      .map((employee) => {
        const forceSummary = getEmployeeForceSummary(forceHistory, employee.id)
        const lastDate = forceSummary.last1 !== "-" ? forceSummary.last1 : undefined

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
          total: forceSummary.total,
          last1: forceSummary.last1,
          last2: forceSummary.last2,
          daysSince,
          totalOvertimeHours: manualOvertimeHours + detailOvertimeHours
        }
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

  async function saveForceHistoryEntry(originalRow: ForceHistoryRow, originalIndex: number) {
    const rowKey = `${originalRow.employee_id}-${originalRow.forced_date}-${originalIndex}`
    const nextForcedDate = historyDrafts[rowKey]?.trim() || ""
    if (!nextForcedDate) return

    const nextRows = forceHistory
      .map((row, index) =>
        index === originalIndex
          ? { ...row, forced_date: nextForcedDate }
          : row
      )
      .filter((row, index, rows) =>
        rows.findIndex((candidate) => candidate.employee_id === row.employee_id && candidate.forced_date === row.forced_date) === index
      )

    pushUndoSnapshot([originalRow.employee_id])
    setForceHistory(nextRows)
    await syncForceHistoryForEmployees(nextRows, [originalRow.employee_id])

    const employee = employees.find((row) => row.id === originalRow.employee_id)
    onAuditEvent?.(
      "Force History Edited",
      `Updated force history for ${employee ? `${employee.firstName} ${employee.lastName}` : "employee"}.`,
      `Previous date: ${originalRow.forced_date} | New date: ${nextForcedDate}`
    )
  }

  async function deleteForceHistoryEntry(targetRow: ForceHistoryRow, originalIndex: number) {
    const nextRows = forceHistory.filter((_, index) => index !== originalIndex)

    pushUndoSnapshot([targetRow.employee_id])
    setForceHistory(nextRows)
    await syncForceHistoryForEmployees(nextRows, [targetRow.employee_id])

    const employee = employees.find((row) => row.id === targetRow.employee_id)
    onAuditEvent?.(
      "Force History Deleted",
      `Deleted force history for ${employee ? `${employee.firstName} ${employee.lastName}` : "employee"}.`,
      `Deleted date: ${targetRow.forced_date}`
    )
  }

  async function deleteSelectedForceHistoryEntries() {
    if (selectedHistoryRows.length === 0) return

    const selectedIndexSet = new Set(selectedHistoryRows.map((value) => Number(value)))
    const targetRows = forceHistory.filter((_, index) => selectedIndexSet.has(index))
    const employeeIds = [...new Set(targetRows.map((row) => row.employee_id))]
    const nextRows = forceHistory.filter((_, index) => !selectedIndexSet.has(index))

    pushUndoSnapshot(employeeIds)
    setForceHistory(nextRows)
    setSelectedHistoryRows([])
    await syncForceHistoryForEmployees(nextRows, employeeIds)

    onAuditEvent?.(
      "Force History Deleted",
      `Deleted ${targetRows.length} selected force history entr${targetRows.length === 1 ? "y" : "ies"}.`
    )
  }

  const forceList = buildForceList()
  const forceHistoryList = forceHistory
    .map((row, originalIndex) => ({ row, originalIndex }))
    .sort((a, b) => b.row.forced_date.localeCompare(a.row.forced_date) || a.row.employee_id.localeCompare(b.row.employee_id))

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
        {!readOnly && (
          <>
            <button
              data-no-print="true"
              onClick={() => printElementById("force-print-section", "Force Rotation")}
            >
              Print Force
            </button>
            <button
              data-no-print="true"
              onClick={() => setShowForceHistory((current) => !current)}
            >
              {showForceHistory ? "Hide Force History" : "Force History"}
            </button>
            <button
              data-no-print="true"
              onClick={() => void undoForceAction()}
              disabled={undoStack.length === 0}
            >
              Undo
            </button>
          </>
        )}
      </div>

      {!readOnly && showForceHistory && (
        <div
          data-no-print="true"
          style={{
            display: "grid",
            gap: "10px",
            marginBottom: "16px",
            padding: "14px",
            border: "1px solid #dbeafe",
            borderRadius: "14px",
            background: "#f8fbff"
          }}
        >
          <div style={{ fontWeight: 800, color: "#0f172a" }}>Force History</div>
          <div style={{ fontSize: "12px", color: "#475569" }}>
            Edit or delete individual force entries here. This is the best place to clean up experimental dates.
          </div>

          {forceHistoryList.length === 0 ? (
            <div style={{ fontSize: "13px", color: "#64748b" }}>
              No force history entries yet.
            </div>
          ) : (
            <div style={{ display: "grid", gap: "10px" }}>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={() => void deleteSelectedForceHistoryEntries()}
                  disabled={selectedHistoryRows.length === 0}
                >
                  Delete Selected
                </button>
              </div>

              <div style={{ display: "grid", gap: "8px" }}>
                {forceHistoryList.map(({ row, originalIndex }) => {
                  const employee = employees.find((candidate) => candidate.id === row.employee_id)
                  const rowKey = `${row.employee_id}-${row.forced_date}-${originalIndex}`
                  const isSelected = selectedHistoryRows.includes(String(originalIndex))

                  return (
                    <div
                      key={rowKey}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "36px 1.6fr 160px 110px 110px",
                        gap: "10px",
                        alignItems: "center",
                        padding: "10px 12px",
                        border: isSelected ? "2px solid #2563eb" : "1px solid #e2e8f0",
                        borderRadius: "12px",
                        background: isSelected ? "#eff6ff" : "#ffffff"
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(event) =>
                          setSelectedHistoryRows((current) =>
                            event.target.checked
                              ? [...current, String(originalIndex)]
                              : current.filter((value) => value !== String(originalIndex))
                          )
                        }
                      />

                      <div>
                        <div style={{ fontWeight: 700 }}>
                          {employee ? `${employee.lastName}, ${employee.firstName}` : row.employee_id}
                        </div>
                        <div style={{ fontSize: "12px", color: "#64748b" }}>
                          Original date: {row.forced_date}
                        </div>
                      </div>

                      <input
                        type="date"
                        value={historyDrafts[rowKey] || row.forced_date}
                        onChange={(event) =>
                          setHistoryDrafts((current) => ({
                            ...current,
                            [rowKey]: event.target.value
                          }))
                        }
                      />

                      <button onClick={() => void saveForceHistoryEntry(row, originalIndex)}>
                        Save
                      </button>

                      <button onClick={() => void deleteForceHistoryEntry(row, originalIndex)}>
                        Delete
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

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
              disabled={readOnly}
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
              disabled={readOnly}
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

          {!readOnly && (
            <button onClick={() => void forceEmployee(employee.id)}>
              Force
            </button>
          )}

          {!readOnly && (
            <button onClick={() => void saveForceDates(employee.id)}>
              Save
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

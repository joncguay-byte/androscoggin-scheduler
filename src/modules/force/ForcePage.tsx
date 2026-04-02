import { useEffect, useState } from "react"

import { supabase } from "../../lib/supabase"
import { printElementById } from "../../lib/print"
import { buildForceRotationOrder, getEmployeeForceSummary } from "../../lib/force-rotation"
import { pushAppToast } from "../../stores/ui-store"
import type { DetailRecord, Employee, ForceHistoryRow, OvertimeEntry } from "../../types"

type ForceListRow = Employee & {
  total: number
  last1: string
  last2: string
  daysSince: number | "Never"
  totalOvertimeHours: number
}

function getForceHistoryRowKey(row: ForceHistoryRow, fallbackIndex: number) {
  return row.id || `${row.employee_id}-${row.forced_date}-${fallbackIndex}`
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
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

  useEffect(() => {
    setSelectedHistoryRows((current) =>
      current.filter((selectedKey) =>
        forceHistory.some((row, index) => getForceHistoryRowKey(row, index) === selectedKey)
      )
    )
  }, [forceHistory])

  function pushUndoSnapshot(employeeIds: string[]) {
    const snapshot = forceHistory.map((row) => ({ ...row }))
    setUndoStack((current) => [{ rows: snapshot, employeeIds }, ...current].slice(0, 10))
  }

  async function loadLiveForceHistory() {
    const { data, error } = await supabase
      .from("force_history")
      .select("*")
      .order("forced_date", { ascending: false })

    if (error) throw error
    return (data || []) as ForceHistoryRow[]
  }

  async function syncEntireForceHistory(nextRows: ForceHistoryRow[]) {
    const currentRows = forceHistory

    if (currentRows.some((row) => !row.id)) {
      const { error: resetError } = await supabase
        .from("force_history")
        .delete()
        .not("employee_id", "is", null)
      if (resetError) throw resetError

      if (nextRows.length === 0) {
        return []
      }

      const { data, error: insertError } = await supabase
        .from("force_history")
        .insert(
          nextRows.map((row) => ({
            employee_id: row.employee_id,
            forced_date: row.forced_date
          }))
        )
        .select("*")
      if (insertError) throw insertError

      const { data: reloadedRows, error: reloadError } = await supabase
        .from("force_history")
        .select("*")
        .order("forced_date", { ascending: false })
      if (reloadError) throw reloadError

      return (reloadedRows || data || []) as ForceHistoryRow[]
    }

    if (nextRows.length === 0) {
      const { data: liveRows, error: liveRowsError } = await supabase
        .from("force_history")
        .select("*")
        .order("forced_date", { ascending: false })
      if (liveRowsError) throw liveRowsError

      const liveForceRows = (liveRows || []) as ForceHistoryRow[]
      const liveIds = liveForceRows.map((row) => row.id).filter(Boolean) as string[]

      for (const idChunk of chunkArray(liveIds, 100)) {
        if (idChunk.length === 0) continue
        const { error: deleteChunkError } = await supabase
          .from("force_history")
          .delete()
          .in("id", idChunk)
        if (deleteChunkError) throw deleteChunkError
      }

      const idlessRows = liveForceRows.filter((row) => !row.id)
      for (const row of idlessRows) {
        const { error: deleteRowError } = await supabase
          .from("force_history")
          .delete()
          .eq("employee_id", row.employee_id)
          .eq("forced_date", row.forced_date)
        if (deleteRowError) throw deleteRowError
      }

      const { data: reloadedRows, error: reloadError } = await supabase
        .from("force_history")
        .select("*")
        .order("forced_date", { ascending: false })
      if (reloadError) throw reloadError

      if ((reloadedRows || []).length > 0) {
        throw new Error("Force history still contains rows after delete.")
      }

      return (reloadedRows || []) as ForceHistoryRow[]
    }

    const currentIds = new Set(currentRows.map((row) => row.id!))
    const nextIds = new Set(nextRows.map((row) => row.id!).filter(Boolean))
    const rowsToDelete = currentRows.filter((row) => row.id && !nextIds.has(row.id))
    const rowsToUpdate = nextRows.filter((row) => row.id && currentIds.has(row.id))
    const rowsToInsert = nextRows.filter((row) => !row.id)

    if (rowsToDelete.length > 0) {
      const { error } = await supabase
        .from("force_history")
        .delete()
        .in("id", rowsToDelete.map((row) => row.id!))
      if (error) throw error
    }

    for (const row of rowsToUpdate) {
      const existing = currentRows.find((candidate) => candidate.id === row.id)
      if (!existing || existing.forced_date === row.forced_date) continue

      const { error } = await supabase
        .from("force_history")
        .update({ forced_date: row.forced_date })
        .eq("id", row.id!)
      if (error) throw error
    }

    let insertedRows: ForceHistoryRow[] = []
    if (rowsToInsert.length > 0) {
      const { data, error } = await supabase
        .from("force_history")
        .insert(
          rowsToInsert.map((row) => ({
            employee_id: row.employee_id,
            forced_date: row.forced_date
          }))
        )
        .select("*")
      if (error) throw error

      insertedRows = (data || []) as ForceHistoryRow[]
    }

    const insertedBuckets = new Map<string, ForceHistoryRow[]>()
    insertedRows.forEach((row) => {
      const key = `${row.employee_id}-${row.forced_date}`
      insertedBuckets.set(key, [...(insertedBuckets.get(key) || []), row])
    })

    const mergedRows = nextRows.map((row) => {
      if (row.id) return row
      const key = `${row.employee_id}-${row.forced_date}`
      const matches = insertedBuckets.get(key)
      if (!matches || matches.length === 0) return row
      const nextMatch = matches.shift()!
      insertedBuckets.set(key, matches)
      return nextMatch
    })

    const { data: reloadedRows, error: reloadError } = await supabase
      .from("force_history")
      .select("*")
      .order("forced_date", { ascending: false })
    if (reloadError) throw reloadError

    return (reloadedRows || mergedRows) as ForceHistoryRow[]
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
    const liveRows = await loadLiveForceHistory()

    pushUndoSnapshot([empId])

    const nextRows = [
      { employee_id: empId, forced_date: today },
      ...liveRows
    ]

    setForceHistory(nextRows)
    setDraftDatesByEmployee((current) => ({
      ...current,
      [empId]: {
        last1: today,
        last2: current[empId]?.last1 || ""
      }
    }))

    try {
      const syncedRows = await syncEntireForceHistory(nextRows)
      setForceHistory(syncedRows)
    } catch (error) {
      pushAppToast({
        tone: "error",
        title: "Force history save failed",
        message: error instanceof Error ? error.message : "Failed to save force history."
      })
      return
    }

    const employee = employees.find((row) => row.id === empId)
    onAuditEvent?.(
      "Force Added",
      `Added force entry for ${employee ? `${employee.firstName} ${employee.lastName}` : "Unknown employee"}.`,
      `Forced date: ${today}`
    )
  }

  async function saveForceDates(employeeId: string) {
    const draft = draftDatesByEmployee[employeeId] || { last1: "", last2: "" }
    const liveRows = await loadLiveForceHistory()
    const cleanedDates = [draft.last1, draft.last2]
      .filter((value) => value.trim().length > 0)
      .filter((value, index, array) => array.indexOf(value) === index)
      .sort((a, b) => b.localeCompare(a))

    pushUndoSnapshot([employeeId])

    const remainingRows = liveRows.filter((row) => row.employee_id !== employeeId)
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

    try {
      const syncedRows = await syncEntireForceHistory(nextRows)
      setForceHistory(syncedRows)
    } catch (error) {
      pushAppToast({
        tone: "error",
        title: "Force dates save failed",
        message: error instanceof Error ? error.message : "Failed to save force dates."
      })
      return
    }

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
    try {
      const syncedRows = await syncEntireForceHistory(previous.rows)
      setForceHistory(syncedRows)
    } catch (error) {
      pushAppToast({
        tone: "error",
        title: "Force undo failed",
        message: error instanceof Error ? error.message : "Failed to undo the force change."
      })
      return
    }

    onAuditEvent?.(
      "Force Undo",
      "Undid the previous force rotation change."
    )
  }

  async function saveForceHistoryEntry(originalRow: ForceHistoryRow, originalIndex: number) {
    const rowKey = getForceHistoryRowKey(originalRow, originalIndex)
    const nextForcedDate = historyDrafts[rowKey]?.trim() || ""
    if (!nextForcedDate) return
    const liveRows = await loadLiveForceHistory()

    const nextRows = liveRows
      .map((row, index) =>
        getForceHistoryRowKey(row, index) === getForceHistoryRowKey(originalRow, originalIndex)
          ? { ...row, forced_date: nextForcedDate }
          : row
      )
      .filter((row, index, rows) =>
        rows.findIndex((candidate) => candidate.employee_id === row.employee_id && candidate.forced_date === row.forced_date) === index
      )

    pushUndoSnapshot([originalRow.employee_id])
    setForceHistory(nextRows)
    try {
      const syncedRows = await syncEntireForceHistory(nextRows)
      setForceHistory(syncedRows)
    } catch (error) {
      pushAppToast({
        tone: "error",
        title: "Force history edit failed",
        message: error instanceof Error ? error.message : "Failed to edit force history."
      })
      return
    }

    const employee = employees.find((row) => row.id === originalRow.employee_id)
    onAuditEvent?.(
      "Force History Edited",
      `Updated force history for ${employee ? `${employee.firstName} ${employee.lastName}` : "employee"}.`,
      `Previous date: ${originalRow.forced_date} | New date: ${nextForcedDate}`
    )
  }

  async function deleteSelectedForceHistoryEntries() {
    if (selectedHistoryRows.length === 0) return

    const liveRows = await loadLiveForceHistory()
    const selectedKeySet = new Set(selectedHistoryRows)
    const targetRows = liveRows.filter((row, index) => selectedKeySet.has(getForceHistoryRowKey(row, index)))
    const nextRows = liveRows.filter((row, index) => !selectedKeySet.has(getForceHistoryRowKey(row, index)))

    pushUndoSnapshot([...new Set(targetRows.map((row) => row.employee_id))])
    setForceHistory(nextRows)
    setSelectedHistoryRows([])
    try {
      const syncedRows = await syncEntireForceHistory(nextRows)
      setForceHistory(syncedRows)
    } catch (error) {
      pushAppToast({
        tone: "error",
        title: "Force history delete failed",
        message: error instanceof Error ? error.message : "Failed to delete force history."
      })
      return
    }

    onAuditEvent?.(
      "Force History Deleted",
      `Deleted ${targetRows.length} selected force history entr${targetRows.length === 1 ? "y" : "ies"}.`
    )
  }

  const forceList = buildForceList()
  const forceHistoryList = forceHistory
    .map((row, originalIndex) => ({ row, originalIndex }))
    .sort((a, b) => b.row.forced_date.localeCompare(a.row.forced_date) || a.row.employee_id.localeCompare(b.row.employee_id))
  const allVisibleHistoryRowIds = forceHistoryList.map(({ row, originalIndex }) => getForceHistoryRowKey(row, originalIndex))
  const allVisibleSelected =
    forceHistoryList.length > 0 && allVisibleHistoryRowIds.every((id) => selectedHistoryRows.includes(id))
  const neverForcedCount = forceList.filter((employee) => employee.total === 0).length
  const totalForceEntries = forceHistory.length
  const topCandidate = forceList[0] || null
  const recentForcedLabel = forceHistoryList[0]
    ? (() => {
        const employee = employees.find((candidate) => candidate.id === forceHistoryList[0].row.employee_id)
        return employee ? `${employee.lastName}, ${employee.firstName}` : forceHistoryList[0].row.employee_id
      })()
    : "None"

  return (
    <div id="force-print-section" style={{ padding: "20px", display: "grid", gap: "16px" }}>
      <div
        style={{
          display: "grid",
          gap: "8px",
          padding: "10px 12px",
          background: "linear-gradient(180deg, #f8fbff 0%, #eef4ff 100%)",
          borderRadius: "16px",
          border: "1px solid #dbeafe"
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "12px",
            flexWrap: "wrap"
          }}
        >
          <div style={{ display: "grid", gap: "2px" }}>
            <div style={{ fontSize: "9px", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "#1d4ed8" }}>
              Force Operations
            </div>
            <div style={{ fontSize: "18px", lineHeight: 1.05, fontWeight: 800, color: "#0f172a" }}>
              Force Rotation
            </div>
            <div style={{ fontSize: "11px", color: "#475569", lineHeight: 1.3 }}>
              Track the live force queue, keep history clean, and manage overrides without losing the rotation.
            </div>
          </div>

          {!readOnly && (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
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
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px" }}>
          {[
            { label: "Next Candidate", value: topCandidate ? `${topCandidate.lastName}, ${topCandidate.firstName}` : "None", tone: "#1d4ed8", bg: "#eff6ff" },
            { label: "Never Forced", value: String(neverForcedCount), tone: "#166534", bg: "#ecfdf5" },
            { label: "History Entries", value: String(totalForceEntries), tone: "#7c3aed", bg: "#f5f3ff" },
            { label: "Recent Force", value: recentForcedLabel, tone: "#92400e", bg: "#fffbeb" }
          ].map((card) => (
            <div
              key={card.label}
              style={{
                border: "1px solid rgba(148, 163, 184, 0.22)",
                borderRadius: "12px",
                padding: "12px 14px",
                background: card.bg,
                display: "grid",
                gap: "3px"
              }}
            >
                  <div style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>
                    {card.label}
                  </div>
                  <div style={{ fontSize: card.label === "Next Candidate" || card.label === "Recent Force" ? "13px" : "18px", lineHeight: 1.05, fontWeight: 800, color: card.tone }}>
                    {card.value}
                  </div>
                </div>
              ))}
        </div>
      </div>

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
        <h2 style={{ margin: 0 }}>Rotation Board</h2>
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
            padding: "16px",
            border: "1px solid #dbeafe",
            borderRadius: "16px",
            background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)"
          }}
        >
          <div style={{ display: "grid", gap: "3px" }}>
            <div style={{ fontWeight: 800, color: "#0f172a" }}>Force History</div>
            <div style={{ fontSize: "12px", color: "#64748b" }}>
              Clean up exact force entries without disturbing the live queue.
            </div>
          </div>
          <div style={{ fontSize: "12px", color: "#475569" }}>
            Check the exact rows you want to remove, then press Delete Selected.
          </div>

          {forceHistoryList.length === 0 ? (
            <div style={{ fontSize: "13px", color: "#64748b" }}>
              No force history entries yet.
            </div>
          ) : (
            <div style={{ display: "grid", gap: "10px" }}>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button
                  onClick={() =>
                    setSelectedHistoryRows((current) =>
                      allVisibleSelected
                        ? current.filter((id) => !allVisibleHistoryRowIds.includes(id))
                        : [...allVisibleHistoryRowIds]
                    )
                  }
                  disabled={forceHistoryList.length === 0}
                >
                  {allVisibleSelected ? "Clear All" : "Select All"}
                </button>
                <button
                  onClick={() => setSelectedHistoryRows([])}
                  disabled={selectedHistoryRows.length === 0}
                >
                  Clear Selection
                </button>
                <button
                  onClick={() =>
                    setSelectedHistoryRows(forceHistory.map((row, index) => getForceHistoryRowKey(row, index)))
                  }
                  disabled={forceHistory.length === 0}
                >
                  Select Entire History
                </button>
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
                  const rowKey = getForceHistoryRowKey(row, originalIndex)
                  const isSelected = selectedHistoryRows.includes(rowKey)

                  return (
                    <div
                      key={rowKey}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "36px 1.8fr 160px 110px",
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
                              ? [...current, rowKey]
                              : current.filter((value) => value !== rowKey)
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
            padding: "10px 12px",
            borderBottom: "1px solid #e5e7eb",
            alignItems: "center",
            background: index === 0 ? "linear-gradient(90deg, #dcfce7 0%, #f8fffb 100%)" : index % 2 === 0 ? "#ffffff" : "#fbfdff",
            borderRadius: index === 0 ? "12px 12px 0 0" : "0"
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

import React, { useEffect, useMemo, useState } from "react"
import {
  calculateForceList,
  recordForce,
  moveForceRecord,
  type ForceRecord,
  type ForceHistoryEntry,
} from "./force-engine"

const FORCE_LIST_KEY = "andro-force-list"
const FORCE_HISTORY_KEY = "andro-force-history"

export function ForcePage({ employees }: { employees: any[] }) {
  const [history, setHistory] = useState<ForceHistoryEntry[]>([])
  const [forceList, setForceList] = useState<ForceRecord[]>([])
  const [reason, setReason] = useState("Call Out")

  useEffect(() => {
    try {
      const savedList = localStorage.getItem(FORCE_LIST_KEY)
      const savedHistory = localStorage.getItem(FORCE_HISTORY_KEY)

      const parsedList = savedList ? JSON.parse(savedList) : []
      const parsedHistory = savedHistory ? JSON.parse(savedHistory) : []

      setHistory(parsedHistory)
      setForceList(calculateForceList(employees, parsedList))
    } catch {
      setHistory([])
      setForceList(calculateForceList(employees, []))
    }
  }, [employees])

  useEffect(() => {
    localStorage.setItem(FORCE_LIST_KEY, JSON.stringify(forceList))
  }, [forceList])

  useEffect(() => {
    localStorage.setItem(FORCE_HISTORY_KEY, JSON.stringify(history))
  }, [history])

  const recommended = useMemo(() => forceList[0] || null, [forceList])

  const handleForce = (employeeId: string) => {
    const today = new Date().toISOString().slice(0, 10)
    const updated = recordForce(forceList, employeeId, today)
    const deputy = updated.find((p) => p.employeeId === employeeId)

    setForceList(updated)

    if (deputy) {
      setHistory((prev) => [
        {
          id: crypto.randomUUID(),
          employeeId,
          name: deputy.name,
          date: today,
          reason,
        },
        ...prev,
      ])
    }
  }

  const handleManualEdit = (
    employeeId: string,
    field: "name" | "lastForced" | "previousForced" | "totalForced",
    value: string
  ) => {
    setForceList((prev) =>
      prev.map((p) =>
        p.employeeId === employeeId
          ? {
              ...p,
              [field]: field === "totalForced" ? Number(value || 0) : value,
            }
          : p
      )
    )
  }

  const moveUp = (index: number) => {
    if (index === 0) return
    setForceList((prev) => moveForceRecord(prev, index, index - 1))
  }

  const moveDown = (index: number) => {
    if (index === forceList.length - 1) return
    setForceList((prev) => moveForceRecord(prev, index, index + 1))
  }

  return (
    <div style={{ padding: "20px" }}>
      <h2 style={{ fontSize: "20px", fontWeight: "700", marginBottom: "15px" }}>
        Force List
      </h2>

      {recommended && (
        <div
          style={{
            marginBottom: "16px",
            padding: "10px 12px",
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: "8px",
          }}
        >
          <strong>Suggested next up:</strong> {recommended.name}
        </div>
      )}

      <div style={{ marginBottom: "12px" }}>
        <label style={{ marginRight: "8px", fontWeight: 600 }}>Reason</label>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{ padding: "6px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
        >
          <option>Call Out</option>
          <option>Sick</option>
          <option>Vacation</option>
          <option>Court</option>
          <option>Training</option>
          <option>FMLA</option>
          <option>Detail</option>
          <option>Other</option>
        </select>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "24px" }}>
        <thead>
          <tr style={{ background: "#f1f5f9" }}>
            <th style={{ padding: "8px", textAlign: "left" }}>Order</th>
            <th style={{ padding: "8px", textAlign: "left" }}>Deputy</th>
            <th style={{ padding: "8px", textAlign: "center" }}>Last Forced</th>
            <th style={{ padding: "8px", textAlign: "center" }}>Previous Forced</th>
            <th style={{ padding: "8px", textAlign: "center" }}>Total</th>
            <th style={{ padding: "8px", textAlign: "center" }}>Move</th>
            <th style={{ padding: "8px", textAlign: "center" }}>Action</th>
          </tr>
        </thead>

        <tbody>
          {forceList.map((p, index) => (
            <tr key={p.employeeId} style={{ borderTop: "1px solid #e2e8f0" }}>
              <td style={{ padding: "8px", textAlign: "center" }}>{index + 1}</td>

              <td style={{ padding: "8px" }}>
                <input
                  value={p.name}
                  onChange={(e) => handleManualEdit(p.employeeId, "name", e.target.value)}
                  style={{ width: "100%", padding: "6px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                />
              </td>

              <td style={{ padding: "8px", textAlign: "center" }}>
                <input
                  value={p.lastForced || ""}
                  onChange={(e) => handleManualEdit(p.employeeId, "lastForced", e.target.value)}
                  style={{ width: "120px", padding: "6px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                />
              </td>

              <td style={{ padding: "8px", textAlign: "center" }}>
                <input
                  value={p.previousForced || ""}
                  onChange={(e) => handleManualEdit(p.employeeId, "previousForced", e.target.value)}
                  style={{ width: "120px", padding: "6px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                />
              </td>

              <td style={{ padding: "8px", textAlign: "center" }}>
                <input
                  type="number"
                  value={p.totalForced}
                  onChange={(e) => handleManualEdit(p.employeeId, "totalForced", e.target.value)}
                  style={{ width: "70px", padding: "6px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                />
              </td>

              <td style={{ padding: "8px", textAlign: "center" }}>
                <button
                  onClick={() => moveUp(index)}
                  style={{ marginRight: "6px", padding: "4px 8px", cursor: "pointer" }}
                >
                  ↑
                </button>
                <button
                  onClick={() => moveDown(index)}
                  style={{ padding: "4px 8px", cursor: "pointer" }}
                >
                  ↓
                </button>
              </td>

              <td style={{ padding: "8px", textAlign: "center" }}>
                <button
                  onClick={() => handleForce(p.employeeId)}
                  style={{
                    background: "#2563eb",
                    color: "white",
                    border: "none",
                    padding: "6px 10px",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Force
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ fontSize: "18px", fontWeight: "700", marginBottom: "10px" }}>
        Force History
      </h3>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#f8fafc" }}>
            <th style={{ padding: "8px", textAlign: "left" }}>Date</th>
            <th style={{ padding: "8px", textAlign: "left" }}>Deputy</th>
            <th style={{ padding: "8px", textAlign: "left" }}>Reason</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.id} style={{ borderTop: "1px solid #e2e8f0" }}>
              <td style={{ padding: "8px" }}>{h.date}</td>
              <td style={{ padding: "8px" }}>{h.name}</td>
              <td style={{ padding: "8px" }}>{h.reason || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
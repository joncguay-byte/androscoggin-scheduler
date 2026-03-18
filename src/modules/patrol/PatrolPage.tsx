import React, { useEffect, useMemo, useState } from "react"
import type { Employee } from "../../types"
import { patrolPositions } from "../../data/constants"
import { isShiftCovered, isForceRequired } from "../../lib/staffing-engine"
import { supabase } from "../../lib/supabase"
import { ensureMonthSchedule } from "../../lib/schedule-generator"

type ScheduleRow = {
  id?: string
  assignment_date: string
  shift_type: "Days" | "Nights"
  position_code: "SUP1" | "SUP2" | "DEP1" | "DEP2" | "POL"
  employee_id: string | null
  vehicle: string | null
  shift_hours: string | null
  status: string | null
  replacement_employee_id: string | null
  replacement_vehicle: string | null
  replacement_hours: string | null
}

type EditingRow = ScheduleRow

const STATUS_OPTIONS = [
  "Scheduled","Sick","Vacation","Court","Training","FMLA",
  "Professional Leave","Bereavement","Call Out","Detail",
  "Extra","Swap","Open Shift","Off"
]

function buildMonthDates(baseDate: Date) {
  const year = baseDate.getFullYear()
  const month = baseDate.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  return Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1))
}

function formatDayHeader(d: Date) {
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "numeric",
    day: "numeric"
  })
}

function formatRange(start: Date, end: Date) {
  return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`
}

function getActiveTeam(date: Date, shift: "Days" | "Nights") {
  const pitman = [0,1,1,0,0,1,1,1,0,0,1,1,0,0]
  const start = new Date("2024-01-01")
  const diff = Math.floor((date.getTime() - start.getTime()) / 86400000)
  const idx = pitman[Math.abs(diff) % pitman.length]
  return shift === "Days" ? (idx ? "Days A" : "Days B") : (idx ? "Nights A" : "Nights B")
}

function isProblemStatus(status?: string | null) {
  return !!status && status !== "Scheduled"
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

export function PatrolPage({ employees, canEdit }: { employees: Employee[], canEdit?: boolean }) {

  const today = new Date()

  const [baseDate, setBaseDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([])
  const [editingRow, setEditingRow] = useState<EditingRow | null>(null)
  const [saving, setSaving] = useState(false)

  // ✅ MOBILE DETECTION
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  const dates = useMemo(() => buildMonthDates(baseDate), [baseDate])

  useEffect(() => {
    async function loadSchedule() {
      const start = toIsoDate(new Date(baseDate.getFullYear(), baseDate.getMonth(), 1))
      const end = toIsoDate(new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0))

      await ensureMonthSchedule(baseDate)

      const { data } = await supabase
        .from("patrol_schedule")
        .select("*")
        .gte("assignment_date", start)
        .lte("assignment_date", end)

      setScheduleRows((data || []) as ScheduleRow[])
    }

    loadSchedule()
  }, [baseDate])

  function cellFor(date: Date, pos: any, shift: any) {
    const iso = toIsoDate(date)
    return scheduleRows.find(r =>
      r.assignment_date === iso &&
      r.position_code === pos &&
      r.shift_type === shift
    )
  }

  function openEditor(date: Date, pos: any, shift: any) {
    if (!canEdit) return
    const existing = cellFor(date, pos, shift)
    if (existing) setEditingRow({ ...existing })
  }

  // ✅ MOBILE GROUPING
  const groupedByDate = useMemo(() => {
    const map: Record<string, ScheduleRow[]> = {}
    scheduleRows.forEach(row => {
      if (!map[row.assignment_date]) map[row.assignment_date] = []
      map[row.assignment_date].push(row)
    })
    return map
  }, [scheduleRows])

  // ✅ MOBILE VIEW
  const renderMobile = () => (
    <div style={{ padding: 10 }}>
      {Object.entries(groupedByDate).map(([date, rows]) => (
        <div key={date} style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700 }}>{date}</div>

          {rows.map(row => {
            const emp = employees.find(e => e.id === row.employee_id)
            const rep = employees.find(e => e.id === row.replacement_employee_id)
            const leave = isProblemStatus(row.status)

            return (
              <div
                key={row.id}
                onClick={() => openEditor(new Date(row.assignment_date), row.position_code, row.shift_type)}
                style={{
                  padding: 10,
                  marginTop: 6,
                  border: "1px solid #ccc",
                  borderRadius: 6,
                  background: leave ? "#fde68a" : "#fff"
                }}
              >
                <div>{row.position_code} - {row.shift_type}</div>
                <div>{row.vehicle} {emp?.lastName}</div>
                <div>{leave ? row.status : row.shift_hours}</div>

                {rep && (
                  <div style={{ fontSize: 12, color: "blue" }}>
                    ↳ {row.replacement_vehicle} {rep.lastName}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )

  const rangeTitle = dates.length ? formatRange(dates[0], dates[dates.length - 1]) : ""

  // ✅ DESKTOP (UNCHANGED GRID)
  const renderDesktop = () => (
    <div style={{ overflowX: "auto" }}>
      <h2>Patrol Schedule</h2>
      <div>{rangeTitle}</div>

      {patrolPositions.map(pos => (
        <div key={pos.code}>
          <strong>{pos.label}</strong>

          {dates.map(d => (
            <div key={d.toISOString()}>
              {renderShiftCell(d, pos.code, "Days")}
            </div>
          ))}
        </div>
      ))}
    </div>
  )

  function renderShiftCell(date: Date, pos: any, shift: any) {
    const row = cellFor(date, pos, shift)
    if (!row) return <div>OPEN</div>

    const emp = employees.find(e => e.id === row.employee_id)
    return (
      <div>
        {row.vehicle} {emp?.lastName}
      </div>
    )
  }

  return isMobile ? renderMobile() : renderDesktop()
}
import type { Employee, PatrolScheduleRow, ShiftType } from "../../types"
import { patrolPositions } from "../../data/constants"
import { Button } from "../../components/ui/simple-ui"

type PatrolCalendarPreviewBoardProps = {
  rows: PatrolScheduleRow[]
  employees: Employee[]
  baseDate: Date
  availableMonthKeys: string[]
  onPrevMonth?: () => void
  onNextMonth?: () => void
}

const STATUS_ABBREVIATIONS: Record<string, string> = {
  Scheduled: "Sch",
  Sick: "Sick",
  Vacation: "Vac",
  Court: "Court",
  Training: "Trng",
  FMLA: "FMLA",
  "Professional Leave": "Prof",
  Bereavement: "BRVMT",
  "Call Out": "Call",
  Detail: "Det",
  Extra: "Extra",
  Swap: "Swap",
  "Open Shift": "Open",
  Off: "Off"
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function buildVisibleDates(baseDate: Date) {
  const year = baseDate.getFullYear()
  const month = baseDate.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const gridStart = new Date(firstDay)
  gridStart.setDate(firstDay.getDate() - firstDay.getDay())
  const gridEnd = new Date(lastDay)
  gridEnd.setDate(lastDay.getDate() + (6 - lastDay.getDay()))

  const dates: Date[] = []

  for (let date = new Date(gridStart); date <= gridEnd; date.setDate(date.getDate() + 1)) {
    dates.push(new Date(date))
  }

  return dates
}

function chunkDates(dates: Date[], chunkSize: number) {
  const chunks: Date[][] = []

  for (let index = 0; index < dates.length; index += chunkSize) {
    chunks.push(dates.slice(index, index + chunkSize))
  }

  return chunks
}

function getCalendarDayDiff(date: Date, anchor: Date) {
  const utcDate = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const utcAnchor = Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
  return Math.round((utcDate - utcAnchor) / 86400000)
}

function getActiveTeam(date: Date, shift: ShiftType) {
  const pitman = [0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0]
  const start = new Date("2026-03-01T12:00:00")
  const diff = getCalendarDayDiff(date, start)
  const idx = pitman[((diff % pitman.length) + pitman.length) % pitman.length]

  if (shift === "Days") return idx ? "Days A" : "Days B"
  return idx ? "Nights A" : "Nights B"
}

function formatStatusLabel(status?: string | null) {
  if (!status) return ""
  return STATUS_ABBREVIATIONS[status] || status
}

function isProblemStatus(status?: string | null) {
  return !!status && status !== "Scheduled"
}

export function PatrolCalendarPreviewBoard({
  rows,
  employees,
  baseDate,
  availableMonthKeys,
  onPrevMonth,
  onNextMonth
}: PatrolCalendarPreviewBoardProps) {
  const employeeMap = new Map(employees.map((employee) => [employee.id, employee]))
  const rowMap = new Map(
    rows.map((row) => [`${row.assignment_date}-${row.shift_type}-${row.position_code}`, row] as const)
  )
  const dates = buildVisibleDates(baseDate)
  const weekRows = chunkDates(dates, 7)
  const weekdayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  const labelColumnWidth = "90px"
  const rangeTitle = baseDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })
  const currentMonthKey = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, "0")}`
  const currentMonthIndex = availableMonthKeys.indexOf(currentMonthKey)
  const canGoPrev = currentMonthIndex > 0
  const canGoNext = currentMonthIndex >= 0 && currentMonthIndex < availableMonthKeys.length - 1
  const visiblePatrolCells = dates.flatMap((date) =>
    (["Days", "Nights"] as const).flatMap((shiftType) =>
      patrolPositions
        .map((position) => rowMap.get(`${toIsoDate(date)}-${shiftType}-${position.code}`) || null)
        .filter((row): row is PatrolScheduleRow => Boolean(row))
    )
  )
  const openShiftCount = visiblePatrolCells.filter(
    (row) => row.status === "Open Shift" || !row.employee_id
  ).length
  const timeOffCount = visiblePatrolCells.filter((row) => isProblemStatus(row.status)).length
  const replacementCount = visiblePatrolCells.filter((row) => !!row.replacement_employee_id).length

  const renderShiftCell = (date: Date, positionCode: PatrolScheduleRow["position_code"], shiftType: ShiftType) => {
    const isoDate = toIsoDate(date)
    const row = rowMap.get(`${isoDate}-${shiftType}-${positionCode}`) || null
    const inCurrentMonth = date.getMonth() === baseDate.getMonth()
    const employee = row?.employee_id ? employeeMap.get(row.employee_id) || null : null
    const replacement = row?.replacement_employee_id ? employeeMap.get(row.replacement_employee_id) || null : null
    const isOff = isProblemStatus(row?.status)
    const replacementHours = row?.replacement_hours || replacement?.defaultShiftHours || ""
    const replacementVehicle = row?.replacement_vehicle || replacement?.defaultVehicle || ""

    return (
      <div
        style={{
          display: "grid",
          gridTemplateRows: "1fr 1fr",
          minHeight: "58px",
          gap: "2px"
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "28px minmax(0, 1fr) 40px",
            alignItems: "center",
            gap: "4px",
            padding: "3px 4px",
            borderRadius: "6px",
            border: "1px solid #d1d5db",
            background: isOff ? "#fde68a" : "#ffffff",
            fontSize: "10px",
            fontWeight: 700,
            opacity: inCurrentMonth ? 1 : 0.75
          }}
        >
          <span>{row?.vehicle || ""}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {employee?.lastName || ""}
          </span>
          <span style={{ textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {isOff ? formatStatusLabel(row?.status) : row?.shift_hours || ""}
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "28px minmax(0, 1fr) 40px",
            alignItems: "center",
            gap: "4px",
            padding: "3px 4px",
            borderRadius: "6px",
            border: "1px solid #dbeafe",
            background: replacement ? "#eff6ff" : "#f8fafc",
            color: replacement ? "#1d4ed8" : "#94a3b8",
            fontSize: "10px",
            opacity: inCurrentMonth ? 1 : 0.75
          }}
        >
          <span>{replacementVehicle}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {replacement?.lastName || "Replacement"}
          </span>
          <span style={{ textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {replacementHours}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        width: "100%",
        background: "#fff",
        borderRadius: "16px",
        border: "1px solid #dbeafe",
        boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
        overflow: "hidden"
      }}
    >
      <div
        style={{
          display: "grid",
          gap: "8px",
          padding: "10px 12px 8px",
          background: "linear-gradient(180deg, #f8fbff 0%, #eef4ff 100%)",
          borderBottom: "1px solid #dbeafe"
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
            <div
              style={{
                fontSize: "9px",
                fontWeight: 800,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "#1d4ed8"
              }}
            >
              Patrol Import Preview
            </div>
            <h2 style={{ margin: 0, fontSize: "18px", lineHeight: 1.05 }}>Patrol Schedule</h2>
            <div style={{ fontSize: "11px", color: "#475569" }}>
              Preview the imported month exactly in Patrol-board format before committing.
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <Button onClick={onPrevMonth} disabled={!canGoPrev}>
              Prev Month
            </Button>
            <Button onClick={onNextMonth} disabled={!canGoNext}>
              Next Month
            </Button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(115px, 1fr))",
            gap: "6px"
          }}
        >
          {[
            { label: "Open Shifts", value: openShiftCount, tone: "#b91c1c", bg: "#fef2f2" },
            { label: "Time Off", value: timeOffCount, tone: "#92400e", bg: "#fffbeb" },
            { label: "Replacements", value: replacementCount, tone: "#1d4ed8", bg: "#eff6ff" }
          ].map((card) => (
            <div
              key={card.label}
              style={{
                border: "1px solid rgba(148, 163, 184, 0.22)",
                borderRadius: "10px",
                padding: "7px 9px",
                background: card.bg,
                display: "grid",
                gap: "2px"
              }}
            >
              <div
                style={{
                  fontSize: "9px",
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "#64748b"
                }}
              >
                {card.label}
              </div>
              <div style={{ fontSize: "18px", lineHeight: 1, fontWeight: 800, color: card.tone }}>
                {card.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          textAlign: "center",
          fontWeight: 700,
          background: "#0f172a",
          color: "#f8fafc",
          border: "1px solid #dbeafe",
          padding: "12px",
          borderRadius: "0",
          marginBottom: "10px",
          letterSpacing: "0.02em"
        }}
      >
        {rangeTitle}
      </div>

      <div style={{ display: "grid", gap: "8px", padding: "0 0 8px" }}>
        {weekRows.map((week, weekIndex) => (
          <div
            key={`week-${weekIndex}`}
            style={{
              border: "1px solid #dbeafe",
              borderRadius: "10px",
              overflow: "hidden",
              background: "#ffffff"
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `${labelColumnWidth} repeat(7, minmax(0, 1fr))`,
                background: "#f8fafc",
                borderBottom: "1px solid #dbeafe"
              }}
            >
              <div style={{ padding: "8px 6px", fontWeight: 700, color: "#475569", fontSize: "12px" }}>
                {`Week ${weekIndex + 1}`}
              </div>

              {week.map((date) => {
                const inCurrentMonth = date.getMonth() === baseDate.getMonth()

                return (
                  <div
                    key={`header-${date.toISOString()}`}
                    style={{
                      padding: "6px 4px",
                      textAlign: "center",
                      borderLeft: "1px solid #dbeafe",
                      background: !inCurrentMonth ? "#f8fafc" : "#ffffff",
                      opacity: !inCurrentMonth ? 0.65 : 1
                    }}
                  >
                    <div style={{ fontSize: "10px", fontWeight: 700, color: "#475569" }}>
                      {weekdayLabels[date.getDay()]}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: "12px" }}>
                      {date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}
                    </div>
                  </div>
                )
              })}
            </div>

            <div style={{ display: "grid", gap: "0" }}>
              {([
                { kind: "team", shift: "Days", label: "Days Team" },
                ...patrolPositions.map((position) => ({
                  kind: "position" as const,
                  shift: "Days" as const,
                  label: position.label,
                  code: position.code
                })),
                { kind: "team", shift: "Nights", label: "Nights Team" },
                ...patrolPositions.map((position) => ({
                  kind: "position" as const,
                  shift: "Nights" as const,
                  label: position.label,
                  code: position.code
                }))
              ] as const).map((row, rowIndex) => (
                <div
                  key={`${row.label}-${rowIndex}-${weekIndex}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: `${labelColumnWidth} repeat(7, minmax(0, 1fr))`,
                    borderTop: rowIndex === 0 ? "none" : "1px solid #e2e8f0"
                  }}
                >
                  <div
                    style={{
                      padding: row.kind === "team" ? "5px 6px" : "4px 6px",
                      fontWeight: 700,
                      fontSize: row.kind === "team" ? "11px" : "12px",
                      background: row.kind === "team" ? "#f8fafc" : "#ffffff",
                      color: "#ec4899",
                      display: "flex",
                      alignItems: row.kind === "team" ? "center" : "stretch"
                    }}
                  >
                    {row.kind === "team" ? (
                      row.label
                    ) : (
                      <div style={{ display: "grid", gridTemplateRows: "1fr 1fr", width: "100%" }}>
                        <div style={{ display: "flex", alignItems: "center" }}>{row.label}</div>
                        <div style={{ display: "flex", alignItems: "center", fontSize: "9px", color: "#ec4899" }}>
                          Replacement
                        </div>
                      </div>
                    )}
                  </div>

                  {week.map((date) => {
                    const inCurrentMonth = date.getMonth() === baseDate.getMonth()

                    return (
                      <div
                        key={`${row.label}-${date.toISOString()}`}
                        style={{
                          padding: "3px",
                          borderLeft: "1px solid #e2e8f0",
                          background: !inCurrentMonth ? "#f8fafc" : "#ffffff",
                          opacity: !inCurrentMonth ? 0.7 : 1
                        }}
                      >
                        {row.kind === "team" ? (
                          <div
                            style={{
                              textAlign: "center",
                              fontSize: "11px",
                              fontWeight: 800,
                              color: "#1e3a8a",
                              padding: "7px 2px",
                              borderRadius: "8px",
                              border: "1px solid #93c5fd",
                              background: "linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%)",
                              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8)"
                            }}
                          >
                            {getActiveTeam(date, row.shift)}
                          </div>
                        ) : (
                          renderShiftCell(date, row.code, row.shift)
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

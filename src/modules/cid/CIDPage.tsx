import { useMemo, useState } from "react"
import type { Dispatch, SetStateAction } from "react"
import {
  buildCalendarDays,
  endOfWeek,
  getDisplayedCidDetectiveForDate,
  getCidRoster,
  getEffectiveCidOnCallForDate,
  startOfWeek,
  toIsoDate
} from "../../lib/cid-schedule"
import { printElementById } from "../../lib/print"
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectItem
} from "../../components/ui/simple-ui"
import type { AppRole, Employee } from "../../types"

type CIDPageProps = {
  employees: Employee[]
  currentUserRole?: AppRole
  rotationStartDate: string
  setRotationStartDate: (date: string) => void
  dailyOverrides: Record<string, string>
  setDailyOverrides: Dispatch<SetStateAction<Record<string, string>>>
  onAuditEvent?: (action: string, summary: string, details?: string) => void
}

function formatMonthLabel(date: Date) {
  return date.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric"
  })
}

function formatLongDate(date: Date) {
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  })
}

function formatWeekRange(date: Date) {
  const start = startOfWeek(date)
  const end = endOfWeek(date)

  return `${start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  })} - ${end.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  })}`
}

function formatWeekOfLabel(date: Date) {
  const start = startOfWeek(date)
  return `Week of ${start.getMonth() + 1}/${start.getDate()}/${String(start.getFullYear()).slice(-2)}`
}

function toDisplayedCidDate(date: Date) {
  const copy = new Date(date)
  copy.setHours(12, 0, 0, 0)
  return copy
}

function formatShortCellDate(date: Date) {
  return `${date.getMonth() + 1}/${date.getDate()}`
}

export function CIDPage({
  employees,
  currentUserRole = "sergeant",
  rotationStartDate,
  setRotationStartDate,
  dailyOverrides,
  setDailyOverrides,
  onAuditEvent
}: CIDPageProps) {
  const today = new Date()
  const [baseDate, setBaseDate] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1)
  )
  const [selectedDateIso, setSelectedDateIso] = useState(toIsoDate(today))
  const [previewRole, setPreviewRole] = useState<AppRole>(currentUserRole)

  const canEdit =
    previewRole === "admin" ||
    previewRole === "sergeant" ||
    previewRole === "detective"
  const cidRoster = useMemo(() => getCidRoster(employees), [employees])
  const calendarDays = useMemo(() => buildCalendarDays(baseDate), [baseDate])
  const selectedDate = useMemo(() => new Date(`${selectedDateIso}T12:00:00`), [selectedDateIso])

  const selectedPrimary = useMemo(
    () => getDisplayedCidDetectiveForDate(selectedDate, employees, rotationStartDate),
    [employees, rotationStartDate, selectedDate]
  )
  const selectedEffectiveOnCall = useMemo(
    () =>
      dailyOverrides[selectedDateIso]
        ? getEffectiveCidOnCallForDate(selectedDate, employees, rotationStartDate, dailyOverrides)
        : getDisplayedCidDetectiveForDate(selectedDate, employees, rotationStartDate),
    [selectedDate, selectedDateIso, employees, rotationStartDate, dailyOverrides]
  )

  function prevMonth() {
    setBaseDate((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))
  }

  function nextMonth() {
    setBaseDate((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))
  }

  function setMonth(monthIndex: number) {
    setBaseDate((current) => new Date(current.getFullYear(), monthIndex, 1))
  }

  function setYear(year: number) {
    setBaseDate((current) => new Date(year, current.getMonth(), 1))
  }

  function updateOverride(dateIso: string, employeeId: string) {
    const previousEmployeeId = dailyOverrides[dateIso] || ""
    setDailyOverrides((current) => {
      if (!employeeId) {
        const next = { ...current }
        delete next[dateIso]
        return next
      }

      return {
        ...current,
        [dateIso]: employeeId
      }
    })

    const previousEmployee = cidRoster.find((employee) => employee.id === previousEmployeeId)
    const nextEmployee = cidRoster.find((employee) => employee.id === employeeId)

    if (!employeeId && previousEmployee) {
      onAuditEvent?.(
        "CID Override Cleared",
        `Cleared CID daily override for ${dateIso}.`,
        `Removed override: ${previousEmployee.firstName} ${previousEmployee.lastName}`
      )
      return
    }

    if (nextEmployee) {
      onAuditEvent?.(
        "CID Override Updated",
        `Updated CID daily override for ${dateIso}.`,
        `${previousEmployee ? `Previous: ${previousEmployee.firstName} ${previousEmployee.lastName} | ` : ""}New: ${nextEmployee.firstName} ${nextEmployee.lastName}`
      )
    }
  }

  const months = Array.from({ length: 12 }, (_, index) =>
    new Date(2026, index, 1).toLocaleDateString(undefined, { month: "long" })
  )
  const years = Array.from({ length: 9 }, (_, index) => today.getFullYear() - 4 + index)

  return (
    <Card>
      <CardHeader>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap"
          }}
        >
          <CardTitle>CID Rotation</CardTitle>
          <Button
            data-no-print="true"
            onClick={() => printElementById("cid-print-section", "CID Rotation")}
          >
            Print CID
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <div id="cid-print-section">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "16px",
            marginBottom: "16px",
            flexWrap: "wrap"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <Button onClick={prevMonth}>Previous</Button>
            <div style={{ fontWeight: 700 }}>{formatMonthLabel(baseDate)}</div>
            <Button onClick={nextMonth}>Next</Button>
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>
                Rotation Start
              </span>
              <input
                type="date"
                value={rotationStartDate}
                onChange={(event) => {
                  setRotationStartDate(event.target.value)
                  onAuditEvent?.(
                    "CID Rotation Start Changed",
                    `Changed CID rotation start date to ${event.target.value}.`,
                    `Previous start date: ${rotationStartDate}`
                  )
                }}
                style={{ padding: "8px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              />
            </label>

            <Select
              value={String(baseDate.getMonth())}
              onValueChange={(value) => setMonth(Number(value))}
            >
              {months.map((month, index) => (
                <SelectItem key={month} value={String(index)}>
                  {month}
                </SelectItem>
              ))}
            </Select>

            <Select
              value={String(baseDate.getFullYear())}
              onValueChange={(value) => setYear(Number(value))}
            >
              {years.map((year) => (
                <SelectItem key={year} value={String(year)}>
                  {year}
                </SelectItem>
              ))}
            </Select>

            <Select
              value={previewRole}
              onValueChange={(value) => setPreviewRole(value as AppRole)}
            >
              <SelectItem value="sergeant">Sergeant View</SelectItem>
              <SelectItem value="detective">Detective View</SelectItem>
              <SelectItem value="deputy">Deputy View</SelectItem>
              <SelectItem value="admin">Admin View</SelectItem>
            </Select>
          </div>
        </div>

        {cidRoster.length === 0 && (
          <div
            style={{
              border: "1px solid #f59e0b",
              background: "#fffbeb",
              color: "#92400e",
              borderRadius: "12px",
              padding: "14px",
              marginBottom: "16px"
            }}
          >
            No active CID roster found yet. Add Moe Drouin, Troy Young, Nate McNally, and Mike Mejia
            in the Employees tab with team set to <strong>CID</strong>. Moe can stay rank <strong>Sgt</strong>;
            the others should be <strong>Detective</strong>.
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr",
            gap: "16px",
            alignItems: "start"
          }}
        >
          <div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                gap: "8px",
                marginBottom: "8px"
              }}
            >
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
                <div
                  key={label}
                  style={{
                    textAlign: "center",
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "#475569"
                  }}
                >
                  {label}
                </div>
              ))}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                gap: "8px"
              }}
            >
              {calendarDays.map((day) => {
                const iso = toIsoDate(day)
                const displayedDay = toDisplayedCidDate(day)
                const primary = getDisplayedCidDetectiveForDate(displayedDay, employees, rotationStartDate)
                const overrideId = dailyOverrides[iso]
                const override = cidRoster.find((employee) => employee.id === overrideId) || null
                const inCurrentMonth = day.getMonth() === baseDate.getMonth()
                const isSelected = iso === selectedDateIso
                const isToday = iso === toIsoDate(today)

                return (
                  <div
                    key={iso}
                    onClick={() => setSelectedDateIso(iso)}
                    style={{
                      minHeight: "146px",
                      borderRadius: "12px",
                      border: isSelected ? "2px solid #1d4ed8" : "1px solid #dbeafe",
                      background: inCurrentMonth ? "#ffffff" : "#f8fafc",
                      padding: "10px",
                      textAlign: "left",
                      cursor: "pointer",
                      opacity: inCurrentMonth ? 1 : 0.7,
                      boxShadow: isToday ? "0 0 0 2px rgba(212,175,55,0.25)" : "none",
                      display: "grid",
                      alignContent: "start"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                      <span style={{ fontWeight: 700 }}>{formatShortCellDate(day)}</span>
                      {day.getDay() === 1 && (
                        <span style={{ fontSize: "11px", color: "#1d4ed8", fontWeight: 700 }}>
                          New Week
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: "12px", color: "#475569" }}>On-Call</div>
                    <div
                      style={{
                        fontSize: "13px",
                        fontWeight: 700,
                        color: override ? "#1d4ed8" : "#0f172a",
                        background: override ? "#dbeafe" : "transparent",
                        border: override ? "1px solid #93c5fd" : "1px solid transparent",
                        borderRadius: "8px",
                        padding: override ? "4px 6px" : "0"
                      }}
                    >
                      {override
                        ? `${override.firstName} ${override.lastName}`
                        : primary
                          ? `${primary.firstName} ${primary.lastName}`
                          : "Unassigned"}
                    </div>

                    <div style={{ marginTop: "4px" }}>
                      <select
                        value={overrideId || ""}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => updateOverride(iso, event.target.value)}
                        disabled={!canEdit}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          borderRadius: "8px",
                          border: "1px solid #cbd5e1",
                          fontSize: "12px",
                          background: "#ffffff"
                        }}
                      >
                        <option value="">Primary Rotation</option>
                        {cidRoster.map((employee) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.firstName} {employee.lastName}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: "12px",
              padding: "16px",
              background: "#ffffff"
            }}
          >
            <div style={{ fontSize: "12px", textTransform: "uppercase", color: "#64748b", marginBottom: "6px" }}>
              Selected Day
            </div>

            <div style={{ fontWeight: 700, fontSize: "18px", marginBottom: "4px" }}>
              {formatLongDate(selectedDate)}
            </div>

            <div style={{ color: "#475569", marginBottom: "12px" }}>
              {formatWeekOfLabel(selectedDate)} • {formatWeekRange(selectedDate)} • turns over Monday at 5:00 AM
            </div>

            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "12px", color: "#64748b" }}>Primary On-Call</div>
              <div style={{ fontWeight: 700 }}>
                {selectedPrimary ? `${selectedPrimary.firstName} ${selectedPrimary.lastName}` : "Unassigned"}
              </div>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "12px", color: "#64748b" }}>Effective On-Call</div>
              <div style={{ fontWeight: 700 }}>
                {selectedEffectiveOnCall
                  ? `${selectedEffectiveOnCall.firstName} ${selectedEffectiveOnCall.lastName}`
                  : "Unassigned"}
              </div>
            </div>

            <div style={{ fontSize: "13px", color: "#475569" }}>
              Weekly CID rotation now turns over on Monday at 5:00 AM. The dropdown inside each CID
              calendar cell replaces the weekly primary for that date only.
            </div>
          </div>
        </div>
        </div>
      </CardContent>
    </Card>
  )
}

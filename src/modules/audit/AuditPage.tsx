import { useMemo, useState } from "react"
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Select, SelectItem } from "../../components/ui/simple-ui"
import { printElementById } from "../../lib/print"
import type { AppRole, AuditEvent, AuditModule } from "../../types"

type AuditPageProps = {
  currentUserRole: AppRole
  auditEvents: AuditEvent[]
}

const moduleOptions: Array<AuditModule | "All"> = [
  "All",
  "Patrol",
  "CID",
  "Force",
  "Detail",
  "Reports",
  "Employees",
  "Settings",
  "Command",
  "Audit",
  "App"
]

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  })
}

function canAccessAudit(role: AppRole) {
  return role === "admin" || role === "sergeant"
}

export function AuditPage({ currentUserRole, auditEvents }: AuditPageProps) {
  const [moduleFilter, setModuleFilter] = useState<AuditModule | "All">("All")
  const [search, setSearch] = useState("")
  const [limit, setLimit] = useState("100")

  const filteredEvents = useMemo(() => {
    const lowered = search.trim().toLowerCase()
    const maxRows = Number(limit) || 100

    return auditEvents
      .filter((event) => moduleFilter === "All" || event.module === moduleFilter)
      .filter((event) => {
        if (!lowered) return true

        return [
          event.module,
          event.action,
          event.summary,
          event.details || "",
          event.actorRole
        ]
          .join(" ")
          .toLowerCase()
          .includes(lowered)
      })
      .slice(0, maxRows)
  }, [auditEvents, limit, moduleFilter, search])

  const moduleCounts = useMemo(() => {
    return [...auditEvents.reduce((map, event) => {
      map.set(event.module, (map.get(event.module) || 0) + 1)
      return map
    }, new Map<AuditModule, number>()).entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [auditEvents])

  if (!canAccessAudit(currentUserRole)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Audit Log</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ color: "#475569", fontSize: "14px" }}>
            Audit is available only to admins and sergeants.
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div id="audit-print-section" style={{ display: "grid", gap: "18px" }}>
      <Card>
        <CardHeader>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <CardTitle>Audit Log</CardTitle>
            <Button data-no-print="true" onClick={() => printElementById("audit-print-section", "Audit Log")}>
              Print Audit
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 180px", gap: "12px" }}>
            <label>
              <div style={{ fontWeight: 700, marginBottom: "4px" }}>Module</div>
              <Select value={moduleFilter} onValueChange={(value) => setModuleFilter(value as AuditModule | "All")}>
                {moduleOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </Select>
            </label>

            <label>
              <div style={{ fontWeight: 700, marginBottom: "4px" }}>Search</div>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search action, summary, details"
              />
            </label>

            <label>
              <div style={{ fontWeight: 700, marginBottom: "4px" }}>Rows</div>
              <Select value={limit} onValueChange={setLimit}>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value="250">250</SelectItem>
              </Select>
            </label>
          </div>
        </CardContent>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "18px" }}>
        <Card>
          <CardHeader>
            <CardTitle>By Module</CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ display: "grid", gap: "10px" }}>
              {moduleCounts.map(([module, count]) => (
                <div
                  key={module}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "12px",
                    padding: "10px 12px",
                    border: "1px solid #e2e8f0",
                    borderRadius: "12px",
                    background: "#ffffff"
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{module}</div>
                  <div style={{ fontWeight: 800 }}>{count}</div>
                </div>
              ))}

              {moduleCounts.length === 0 && (
                <div style={{ fontSize: "13px", color: "#64748b" }}>
                  No audit activity yet.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Audit Events</CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ display: "grid", gap: "10px" }}>
              {filteredEvents.map((event) => (
                <div
                  key={event.id}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: "12px",
                    padding: "12px",
                    background: "#ffffff"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "11px", textTransform: "uppercase", fontWeight: 800, color: "#1d4ed8" }}>
                        {event.module}
                      </span>
                      <span style={{ fontWeight: 800 }}>{event.action}</span>
                    </div>
                    <div style={{ fontSize: "12px", color: "#64748b" }}>
                      {formatDateTime(event.createdAt)} | {event.actorRole}
                    </div>
                  </div>

                  <div style={{ marginTop: "8px", fontWeight: 700, color: "#0f172a" }}>
                    {event.summary}
                  </div>

                  {event.details && (
                    <div style={{ marginTop: "6px", fontSize: "13px", color: "#475569" }}>
                      {event.details}
                    </div>
                  )}
                </div>
              ))}

              {filteredEvents.length === 0 && (
                <div style={{ fontSize: "13px", color: "#64748b" }}>
                  No audit events match the current filters.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

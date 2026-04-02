import type { AuditEvent, AppRole } from "../types"

type CommandStatusStripProps = {
  buildSyncStatus: "checking" | "current" | "update_available" | "error"
  deployedBuildId: string
  appStateSyncStatus: {
    mode: "checking" | "connected" | "local"
    message: string
  }
  currentUserRole: AppRole
  patrolOverridesSyncReady: boolean
  overtimeNotificationsSyncReady: boolean
  auditEvents: AuditEvent[]
  onReload: () => void
}

function formatTimeAgo(timestamp: string) {
  const diffMinutes = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 60000))
  if (diffMinutes < 1) return "just now"
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return `${Math.round(diffHours / 24)}d ago`
}

function getPillStyle(tone: "blue" | "green" | "amber" | "slate" | "red") {
  switch (tone) {
    case "green":
      return { background: "#ecfdf5", border: "#86efac", color: "#166534" }
    case "amber":
      return { background: "#fffbeb", border: "#fcd34d", color: "#b45309" }
    case "red":
      return { background: "#fff1f2", border: "#fda4af", color: "#be123c" }
    case "blue":
      return { background: "#eff6ff", border: "#93c5fd", color: "#1d4ed8" }
    default:
      return { background: "#f8fafc", border: "#cbd5e1", color: "#334155" }
  }
}

export default function CommandStatusStrip({
  buildSyncStatus,
  deployedBuildId,
  appStateSyncStatus,
  currentUserRole,
  patrolOverridesSyncReady,
  overtimeNotificationsSyncReady,
  auditEvents,
  onReload
}: CommandStatusStripProps) {
  const latestEvents = [...auditEvents].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3)
  const statusPills: Array<{ label: string; tone: "blue" | "green" | "amber" | "slate" | "red" }> = []
  const buildPill =
    buildSyncStatus === "update_available"
      ? { label: "Update Ready", tone: "amber" as const }
      : buildSyncStatus === "current"
        ? { label: "Build Current", tone: "green" as const }
        : buildSyncStatus === "error"
          ? { label: "Build Check Delayed", tone: "red" as const }
          : { label: "Checking Build", tone: "slate" as const }

  const appSyncPill =
    appStateSyncStatus.mode === "connected"
      ? { label: "Cloud Sync Live", tone: "blue" as const }
      : appStateSyncStatus.mode === "local"
        ? { label: "Local Sync Fallback", tone: "amber" as const }
        : { label: "Checking Sync", tone: "slate" as const }

  statusPills.push(
    buildPill,
    appSyncPill,
    { label: patrolOverridesSyncReady ? "Patrol Live" : "Patrol Syncing", tone: patrolOverridesSyncReady ? "green" : "amber" },
    { label: overtimeNotificationsSyncReady ? "OT/Notify Live" : "OT/Notify Syncing", tone: overtimeNotificationsSyncReady ? "green" : "amber" },
    { label: `Role ${currentUserRole.toUpperCase()}`, tone: "slate" }
  )

  return (
    <div
      style={{
        marginBottom: "16px",
        border: "1px solid #dbe3ee",
        borderRadius: "18px",
        padding: "14px 16px",
        background: "linear-gradient(135deg, #ffffff 0%, #f8fbff 100%)",
        boxShadow: "0 12px 28px rgba(15, 23, 42, 0.08)"
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.4fr) minmax(320px, 0.9fr)",
          gap: "18px",
          alignItems: "start"
        }}
      >
        <div style={{ display: "grid", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
            <div style={{ fontSize: "15px", fontWeight: 800, color: "#0f172a" }}>
              Command Status
            </div>
            {buildSyncStatus === "update_available" && (
              <button
                onClick={onReload}
                style={{
                  border: "none",
                  borderRadius: "999px",
                  background: "#1d4ed8",
                  color: "#ffffff",
                  fontWeight: 800,
                  padding: "8px 14px",
                  cursor: "pointer"
                }}
              >
                Reload Update
              </button>
            )}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            {statusPills.map((pill) => {
              const style = getPillStyle(pill.tone)
              return (
                <div
                  key={pill.label}
                  style={{
                    border: `1px solid ${style.border}`,
                    background: style.background,
                    color: style.color,
                    borderRadius: "999px",
                    padding: "8px 12px",
                    fontSize: "12px",
                    fontWeight: 800
                  }}
                >
                  {pill.label}
                </div>
              )
            })}
          </div>

          <div style={{ fontSize: "12px", color: "#475569", lineHeight: 1.5 }}>
            {appStateSyncStatus.message}
            {deployedBuildId && buildSyncStatus === "update_available" ? ` New build: ${deployedBuildId.replace("T", " ").slice(0, 16)}.` : ""}
          </div>
        </div>

        <div
          style={{
            border: "1px solid #dbe3ee",
            borderRadius: "14px",
            background: "#ffffff",
            padding: "12px 14px",
            display: "grid",
            gap: "10px"
          }}
        >
          <div style={{ fontSize: "13px", fontWeight: 800, color: "#0f172a" }}>
            Recent Activity
          </div>

          {latestEvents.length === 0 ? (
            <div style={{ fontSize: "12px", color: "#64748b" }}>
              No recent scheduler activity yet.
            </div>
          ) : latestEvents.map((event) => (
            <div
              key={event.id}
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: "12px",
                padding: "10px 12px",
                background: "#f8fafc"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center" }}>
                <div style={{ fontSize: "12px", fontWeight: 800, color: "#1e293b" }}>
                  {event.module} | {event.action}
                </div>
                <div style={{ fontSize: "11px", color: "#64748b" }}>
                  {formatTimeAgo(event.createdAt)}
                </div>
              </div>
              <div style={{ marginTop: "4px", fontSize: "12px", color: "#475569", lineHeight: 1.45 }}>
                {event.summary}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

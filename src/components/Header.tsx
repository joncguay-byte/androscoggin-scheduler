type HeaderProps = {
  user?: {
    username?: string
    secondary?: string
  }
  variant?: "command-brass" | "ops-strip" | "clean-ledger"
  title?: string
  colorSettings?: {
    accent: string
    border: string
    cardBackground: string
  }
  badgeSrc?: string
  onSignOut?: () => void
  compact?: boolean
}

const headerStyles = {
  "command-brass": {
    border: "2px solid #112b5c",
    background: "linear-gradient(135deg, #132b57 0%, #1b3f7e 100%)",
    titleColor: "#e0b85d",
    userColor: "#e5e7eb",
    eyebrowColor: "#d7c089"
  },
  "ops-strip": {
    border: "1px solid #91a4bf",
    background: "linear-gradient(135deg, #f7fbff 0%, #e6eef8 100%)",
    titleColor: "#173a63",
    userColor: "#334155",
    eyebrowColor: "#4b6b94"
  },
  "clean-ledger": {
    border: "1px solid #d0d4d8",
    background: "linear-gradient(135deg, #ffffff 0%, #f3f4f6 100%)",
    titleColor: "#111827",
    userColor: "#4b5563",
    eyebrowColor: "#6b7280"
  }
} as const

export default function Header({
  user,
  variant = "command-brass",
  title = "Androscoggin Patrol Schedule",
  colorSettings,
  badgeSrc,
  onSignOut,
  compact = false
}: HeaderProps) {

  const username = user?.username || "Admin"
  const secondary = user?.secondary || ""
  const style = headerStyles[variant]
  const buildLabel = typeof __APP_BUILD_ID__ === "string"
    ? __APP_BUILD_ID__.replace("T", " ").replace("Z", " UTC").slice(0, 20)
    : ""

  return (

    <div
      style={{
        width: "100%",
        display: "flex",
        justifyContent: "space-between",
        alignItems: compact ? "stretch" : "center",
        flexDirection: compact ? "column" : "row",
        marginBottom: "10px",
        border: style.border,
        borderRadius: "18px",
        padding: compact ? "12px 14px" : "12px 18px",
        boxSizing: "border-box",
        background: style.background,
        borderColor: colorSettings?.border || undefined
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: compact ? "10px" : "14px", width: compact ? "100%" : undefined }}>
        {badgeSrc ? (
          <div
            style={{
              width: compact ? "56px" : "82px",
              height: compact ? "56px" : "82px",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "999px",
              background: "transparent"
            }}
          >
            <img
              src={badgeSrc}
              alt="Androscoggin County Sheriff's Office badge"
              style={{
                width: compact ? "56px" : "82px",
                height: compact ? "56px" : "82px",
                objectFit: "contain",
                flexShrink: 0,
                filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.18))"
              }}
            />
          </div>
        ) : (
          <div
            style={{
              width: compact ? "48px" : "64px",
              height: compact ? "48px" : "64px",
              flexShrink: 0,
              clipPath: "polygon(50% 0%, 61% 18%, 82% 12%, 76% 33%, 100% 50%, 76% 67%, 82% 88%, 61% 82%, 50% 100%, 39% 82%, 18% 88%, 24% 67%, 0% 50%, 24% 33%, 18% 12%, 39% 18%)",
              background: "linear-gradient(180deg, #f6df9a 0%, #cda33a 100%)",
              border: "2px solid rgba(127, 90, 22, 0.8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 10px rgba(0,0,0,0.18)"
            }}
          >
            <div
              style={{
                width: compact ? "22px" : "28px",
                height: compact ? "22px" : "28px",
                borderRadius: "999px",
                background: "#112b5c",
                color: "#f7e6af",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: compact ? "9px" : "11px",
                fontWeight: 800
              }}
            >
              ACO
            </div>
          </div>
        )}

        <h2 style={{ margin: 0, color: colorSettings?.accent || style.titleColor, fontSize: compact ? "20px" : "30px", lineHeight: 1.15 }}>
          {title}
        </h2>
      </div>

      <div style={{ display: "flex", alignItems: compact ? "center" : "center", justifyContent: compact ? "space-between" : "flex-end", gap: "10px", width: compact ? "100%" : undefined, marginTop: compact ? "10px" : undefined }}>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "14px", color: style.userColor, fontWeight: 600 }}>
            {username}
          </div>
          {buildLabel && (
            <div style={{ fontSize: "10px", color: style.userColor, opacity: 0.72 }}>
              Build {buildLabel}
            </div>
          )}
          {secondary && (
            <div style={{ fontSize: "11px", color: style.userColor, opacity: 0.85 }}>
              {secondary}
            </div>
          )}
        </div>

        {onSignOut && (
          <button
            data-no-print="true"
            onClick={onSignOut}
            style={{
              padding: "6px 10px",
              borderRadius: "999px",
              border: "1px solid rgba(255,255,255,0.35)",
              background: "rgba(255,255,255,0.12)",
              color: style.userColor,
              cursor: "pointer",
              fontWeight: 700
            }}
          >
            Sign Out
          </button>
        )}
      </div>

    </div>

  )

}

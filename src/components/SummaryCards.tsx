type SummaryCardsProps = {
  variant?: "command-brass" | "ops-strip" | "clean-ledger"
  cidOnCallName: string
  openShiftCount: number
  staffingAlertCount: number
  activeCard?: "open_shifts" | "staffing_alerts" | null
  onCardClick?: (card: "open_shifts" | "staffing_alerts") => void
  colorSettings?: {
    accent: string
    border: string
    cardBackground: string
    cardBorder: string
  }
}

const cardStyles = {
  "command-brass": {
    cardBackground: "#fffdf7",
    border: "1px solid #d8c79d",
    shadow: "0 10px 24px rgba(71, 52, 19, 0.08)",
    labelColor: "#7a6640"
  },
  "ops-strip": {
    cardBackground: "#f8fbff",
    border: "1px solid #c3d3e7",
    shadow: "0 12px 28px rgba(30, 64, 175, 0.08)",
    labelColor: "#53708f"
  },
  "clean-ledger": {
    cardBackground: "#ffffff",
    border: "1px solid #e5e7eb",
    shadow: "0 8px 20px rgba(15, 23, 42, 0.05)",
    labelColor: "#6b7280"
  }
} as const

export default function SummaryCards({
  variant = "command-brass",
  cidOnCallName,
  openShiftCount,
  staffingAlertCount,
  activeCard = null,
  onCardClick,
  colorSettings
}: SummaryCardsProps) {
  const cards = [
    {
      key: "cid_on_call",
      label: "CID On-Call",
      value: cidOnCallName,
      color: "#2563eb"
    },
    {
      key: "open_shifts",
      label: "Open Shifts",
      value: String(openShiftCount),
      color: "#ea580c"
    },
    {
      key: "staffing_alerts",
      label: "Staffing Alerts",
      value: String(staffingAlertCount),
      color: "#dc2626"
    }
  ] as const
  const style = cardStyles[variant]

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.2fr 0.9fr 0.9fr",
        gap: "10px"
      }}
    >
      {cards.map((card) => (
        <button
          key={card.label}
          onClick={() => {
            if (card.key === "open_shifts" || card.key === "staffing_alerts") {
              onCardClick?.(card.key)
            }
          }}
          style={{
            background: colorSettings?.cardBackground || style.cardBackground,
            borderRadius: "12px",
            padding: "10px 12px",
            border: `1px solid ${colorSettings?.cardBorder || colorSettings?.border || style.border.replace("1px solid ", "")}`,
            boxShadow: style.shadow,
            textAlign: "left",
            cursor: card.key === "cid_on_call" ? "default" : "pointer",
            outline: activeCard === card.key ? "2px solid rgba(37, 99, 235, 0.35)" : "none"
          }}
        >
          <div
            style={{
              fontSize: "10px",
              fontWeight: "600",
              color: style.labelColor,
              marginBottom: "3px",
              textTransform: "uppercase",
              letterSpacing: "0.04em"
            }}
          >
            {card.label}
          </div>

          <div
            style={{
              fontSize: card.label === "CID On-Call" ? "16px" : "19px",
              fontWeight: "800",
              color: card.label === "CID On-Call" && colorSettings?.accent ? colorSettings.accent : card.color
            }}
          >
            {card.value}
          </div>
        </button>
      ))}
    </div>
  )
}

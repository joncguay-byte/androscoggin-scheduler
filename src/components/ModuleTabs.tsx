import type { LucideIcon } from "lucide-react"

type ModuleKey =
  | "command"
  | "audit"
  | "patrol"
  | "overtime"
  | "cid"
  | "force"
  | "detail"
  | "notifications"
  | "reports"
  | "employees"
  | "settings"

type ModuleDefinition = {
  key: ModuleKey
  label: string
  icon: LucideIcon
}

type ModuleTabsProps = {
  active: ModuleKey
  onChange: (key: ModuleKey) => void
  moduleOrder: ModuleDefinition[]
  visibleModules?: ModuleKey[]
  variant?: "command-brass" | "ops-strip" | "clean-ledger"
  colorSettings?: {
    accent: string
    border: string
    cardBackground: string
  }
  compact?: boolean
}

const tabStyles = {
  "command-brass": {
    activeBackground: "#122a58",
    activeColor: "#f6e4b8",
    inactiveBackground: "#fffdf7",
    inactiveColor: "#1f2937",
    border: "1px solid #d8c79d"
  },
  "ops-strip": {
    activeBackground: "#163b67",
    activeColor: "#eef6ff",
    inactiveBackground: "#eef4fb",
    inactiveColor: "#173a63",
    border: "1px solid #bfd1e6"
  },
  "clean-ledger": {
    activeBackground: "#111827",
    activeColor: "#f9fafb",
    inactiveBackground: "#f9fafb",
    inactiveColor: "#1f2937",
    border: "1px solid #d1d5db"
  }
} as const

export default function ModuleTabs({
  active,
  onChange,
  moduleOrder,
  visibleModules,
  variant = "command-brass",
  colorSettings,
  compact = false
}: ModuleTabsProps) {
  const style = tabStyles[variant]
  const allowedModules = visibleModules || moduleOrder.map((module) => module.key)

  return (

    <div
      style={{
        display: "flex",
        gap: compact ? "8px" : "10px",
        marginBottom: "20px",
        flexWrap: compact ? "nowrap" : "wrap",
        overflowX: compact ? "auto" : "visible",
        paddingBottom: compact ? "4px" : undefined
      }}
    >

      {moduleOrder.filter((module) => allowedModules.includes(module.key)).map((m) => {

        const Icon = m.icon

        const isActive = active === m.key

        return (

          <button
            key={m.key}
            onClick={() => onChange(m.key)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: compact ? "9px 12px" : "10px 16px",
              borderRadius: "999px",
              border: `1px solid ${colorSettings?.border || style.border.replace("1px solid ", "")}`,
              background: isActive ? colorSettings?.accent || style.activeBackground : colorSettings?.cardBackground || style.inactiveBackground,
              color: isActive ? style.activeColor : style.inactiveColor,
              cursor: "pointer",
              fontWeight: "700",
              fontSize: compact ? "12px" : undefined,
              whiteSpace: "nowrap",
              flexShrink: 0,
              boxShadow: isActive ? "0 8px 18px rgba(15, 23, 42, 0.14)" : "none",
              transform: isActive ? "translateY(-1px)" : "translateY(0)",
              transition: "transform 140ms ease, box-shadow 140ms ease, background 140ms ease, color 140ms ease"
            }}
          >

            <Icon size={compact ? 14 : 16} />

            {m.label}

          </button>

        )

      })}

    </div>

  )

}

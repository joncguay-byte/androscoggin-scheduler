import React from "react"

export default function ModuleTabs({
  active,
  onChange,
  moduleOrder
}: any) {

  return (

    <div
      style={{
        display: "flex",
        gap: "10px",
        marginBottom: "20px",
        flexWrap: "wrap"
      }}
    >

      {moduleOrder.map((m: any) => {

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
              padding: "8px 14px",
              borderRadius: "8px",
              border: "1px solid #cbd5e1",
              background: isActive ? "#1e293b" : "#f8fafc",
              color: isActive ? "white" : "#0f172a",
              cursor: "pointer",
              fontWeight: "600"
            }}
          >

            <Icon size={16} />

            {m.label}

          </button>

        )

      })}

    </div>

  )

}
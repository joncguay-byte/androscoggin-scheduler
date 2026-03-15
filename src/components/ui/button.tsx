import React from "react"

export function Button({ children, ...props }: any) {
  return (
    <button
      {...props}
      style={{
        padding: "6px 12px",
        border: "1px solid #ccc",
        borderRadius: 6,
        cursor: "pointer",
        background: "#f5f5f5"
      }}
    >
      {children}
    </button>
  )
}
import type { ButtonHTMLAttributes, ReactNode } from "react"

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: ReactNode
}

export function Button({ children, style, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      style={{
        padding: "6px 12px",
        border: "1px solid #ccc",
        borderRadius: 6,
        cursor: "pointer",
        background: "#f5f5f5",
        ...style
      }}
    >
      {children}
    </button>
  )
}

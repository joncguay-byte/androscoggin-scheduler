import type { ReactNode } from "react"

type CardProps = {
  children?: ReactNode
  className?: string
}

export function Card({ children, className }: CardProps) {
  return <div className={className} style={{border:"1px solid #ddd",borderRadius:12,padding:12}}>{children}</div>
}

export function CardHeader({ children }: { children?: ReactNode }) {
  return <div style={{marginBottom:10}}>{children}</div>
}

export function CardTitle({ children }: { children?: ReactNode }) {
  return <h3>{children}</h3>
}

export function CardContent({ children }: { children?: ReactNode }) {
  return <div>{children}</div>
}

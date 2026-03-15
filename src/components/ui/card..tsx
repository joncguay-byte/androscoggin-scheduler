import React from "react"

export function Card({ children, className }: any) {
  return <div className={className} style={{border:"1px solid #ddd",borderRadius:12,padding:12}}>{children}</div>
}

export function CardHeader({ children }: any) {
  return <div style={{marginBottom:10}}>{children}</div>
}

export function CardTitle({ children }: any) {
  return <h3>{children}</h3>
}

export function CardContent({ children }: any) {
  return <div>{children}</div>
}
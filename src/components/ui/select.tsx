import type { ReactNode } from "react"

export function Select({
  children
}: {
  children?: ReactNode
}){
  return <div>{children}</div>
}

export function SelectTrigger({children}:{ children?: ReactNode }){
  return <div>{children}</div>
}

export function SelectValue(){ return null }

export function SelectContent({children}:{ children?: ReactNode }){
  return <div>{children}</div>
}

export function SelectItem({ value: _value, children }:{ value: string, children?: ReactNode }){
  return <div>{children}</div>
}

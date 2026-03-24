import type { ReactNode } from "react"

export function Dialog({open,children}:{ open: boolean, children?: ReactNode }){
  if(!open) return null
  return <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.3)"}}>{children}</div>
}

export function DialogContent({children}:{ children?: ReactNode }){
  return <div style={{background:"#fff",padding:20,margin:"10% auto",width:400}}>{children}</div>
}

export function DialogHeader({children}:{ children?: ReactNode }){ return <div>{children}</div> }
export function DialogTitle({children}:{ children?: ReactNode }){ return <h3>{children}</h3> }
export function DialogFooter({children}:{ children?: ReactNode }){ return <div style={{marginTop:10}}>{children}</div> }

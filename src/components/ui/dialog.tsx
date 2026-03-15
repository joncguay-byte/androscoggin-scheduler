import React from "react"

export function Dialog({open,children}:any){
  if(!open) return null
  return <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.3)"}}>{children}</div>
}

export function DialogContent({children}:any){
  return <div style={{background:"#fff",padding:20,margin:"10% auto",width:400}}>{children}</div>
}

export function DialogHeader({children}:any){ return <div>{children}</div> }
export function DialogTitle({children}:any){ return <h3>{children}</h3> }
export function DialogFooter({children}:any){ return <div style={{marginTop:10}}>{children}</div> }
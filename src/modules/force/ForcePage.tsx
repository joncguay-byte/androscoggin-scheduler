import React, { useState } from "react"
import { calculateForceList, recordForce } from "./force-engine"

export function ForcePage({ employees }: { employees: any[] }) {

  const [history,setHistory] = useState<any[]>([])
  const [forceList,setForceList] = useState(
    calculateForceList(employees,history)
  )

  const forceDeputy = (employeeId:string) => {

    const today = new Date().toISOString().slice(0,10)

    const updated = recordForce(forceList,employeeId,today)

    setForceList(updated)
    setHistory(updated)

  }

  return (

  <div style={{padding:"20px"}}>

  <h2 style={{fontSize:"20px",fontWeight:"700",marginBottom:"15px"}}>
  Force List
  </h2>

  <table style={{width:"100%",borderCollapse:"collapse"}}>

  <thead>
  <tr style={{background:"#f1f5f9"}}>
  <th style={{padding:"8px",textAlign:"left"}}>Deputy</th>
  <th style={{padding:"8px"}}>Last Forced</th>
  <th style={{padding:"8px"}}>Previous Forced</th>
  <th style={{padding:"8px"}}>Total</th>
  <th style={{padding:"8px"}}></th>
  </tr>
  </thead>

  <tbody>

  {forceList.map(p=>(
  <tr key={p.employeeId} style={{borderTop:"1px solid #e2e8f0"}}>

  <td style={{padding:"8px"}}>{p.name}</td>

  <td style={{padding:"8px",textAlign:"center"}}>
  {p.lastForced || "-"}
  </td>

  <td style={{padding:"8px",textAlign:"center"}}>
  {p.previousForced || "-"}
  </td>

  <td style={{padding:"8px",textAlign:"center"}}>
  {p.totalForced}
  </td>

  <td style={{padding:"8px",textAlign:"center"}}>

  <button
  onClick={()=>forceDeputy(p.employeeId)}
  style={{
  background:"#2563eb",
  color:"white",
  border:"none",
  padding:"6px 10px",
  borderRadius:"4px",
  cursor:"pointer"
  }}
  >
  Force
  </button>

  </td>

  </tr>
  ))}

  </tbody>

  </table>

  </div>

  )

}
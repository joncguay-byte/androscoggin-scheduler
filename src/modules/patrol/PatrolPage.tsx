import React from "react"
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent
} from "../../components/ui/simple-ui"

import { patrolPositions } from "../../App"

import {
  buildPatrolCellsForDate,
  buildVisibleDates,
  formatShortDate,
  formatLongDate,
  getActiveTeam
} from "../../lib/schedule-utils"

export function PatrolPage({ employees }) {

const today = new Date()

const baseDate = new Date(today.getFullYear(),today.getMonth(),1)
const dates = buildVisibleDates(baseDate,"month")

const weeks=[]
for(let i=0;i<dates.length;i+=7){
weeks.push(dates.slice(i,i+7))
}

const visibleDayCount = weeks[0]?.length || 7

function renderShiftCell(cell){

const employee = employees.find(e=>e.id===cell?.employeeId)
const replacement = employees.find(e=>e.id===cell?.replacementEmployeeId)

const isLeave = cell?.status && cell.status!=="Scheduled"

return(

<div
style={{
padding:"8px",
minHeight:"70px",
border:"1px solid #e2e8f0",
borderRadius:"6px",
background:isLeave?"#fde68a":"white",
display:"flex",
flexDirection:"column",
gap:"4px",
cursor:"pointer"
}}
>

{/* MAIN LINE */}

<div style={{display:"flex",alignItems:"center",gap:"6px"}}>

<div
style={{
background:"#1e293b",
color:"white",
fontSize:"11px",
padding:"2px 6px",
borderRadius:"4px"
}}
>
V{cell?.vehicle||""}
</div>

<div style={{fontWeight:"700"}}>
{employee?.lastName||"OPEN"}
</div>

<div style={{marginLeft:"auto"}}>
{isLeave?cell.status:cell?.shiftHours}
</div>

</div>

{/* REPLACEMENT */}

{replacement &&(

<div style={{display:"flex",gap:"6px",fontSize:"12px"}}>

<div
style={{
background:"#475569",
color:"white",
fontSize:"11px",
padding:"2px 6px",
borderRadius:"4px"
}}
>
V{cell?.replacementVehicle||""}
</div>

<div>{replacement.lastName}</div>

<div style={{marginLeft:"auto"}}>
{cell?.replacementHours}
</div>

</div>

)}

</div>

)

}

return(

<Card>

<CardHeader>
<CardTitle>Androscoggin Patrol Schedule</CardTitle>
</CardHeader>

<CardContent>

<div style={{overflowX:"auto"}}>

{weeks.map((week,i)=>{

const start=week[0]
const end=week[week.length-1]

return(

<div key={i} style={{marginBottom:"40px"}}>

<div style={{
background:"#e2e8f0",
padding:"10px",
fontWeight:"700",
textAlign:"center",
borderRadius:"6px"
}}>
{formatLongDate(start)} - {formatLongDate(end)}
</div>

{/* DATE HEADER */}

<div
style={{
display:"grid",
gridTemplateColumns:`260px repeat(${visibleDayCount},170px)`,
background:"#f8fafc",
borderBottom:"1px solid #cbd5e1",
fontWeight:"600"
}}
>

<div></div>

{week.map(d=>(

<div key={d.toISOString()} style={{textAlign:"center",padding:"6px"}}>
{formatShortDate(d)}
</div>

))}

</div>

{/* DAYS */}

<div style={{
background:"#cbd5e1",
padding:"8px",
fontWeight:"700",
marginTop:"8px"
}}>
DAY SHIFT
</div>

{patrolPositions.map(pos=>(

<div
key={pos.code}
style={{
display:"grid",
gridTemplateColumns:`260px repeat(${visibleDayCount},170px)`,
borderTop:"1px solid #e2e8f0"
}}
>

<div style={{
background:"#f1f5f9",
padding:"8px",
fontWeight:"700"
}}>
{pos.label}
</div>

{week.map(d=>{

const cells = buildPatrolCellsForDate(d,employees)
const cell = cells.find(
c=>c.positionCode===pos.code && c.shiftType==="Days"
)

return(
<div key={d.toISOString()}>
{renderShiftCell(cell)}
</div>
)

})}

</div>

))}

{/* NIGHTS */}

<div style={{
background:"#cbd5e1",
padding:"8px",
fontWeight:"700",
marginTop:"16px"
}}>
NIGHT SHIFT
</div>

{patrolPositions.map(pos=>(

<div
key={`night-${pos.code}`}
style={{
display:"grid",
gridTemplateColumns:`260px repeat(${visibleDayCount},170px)`,
borderTop:"1px solid #e2e8f0"
}}
>

<div style={{
background:"#f1f5f9",
padding:"8px",
fontWeight:"700"
}}>
{pos.label}
</div>

{week.map(d=>{

const cells = buildPatrolCellsForDate(d,employees)
const cell = cells.find(
c=>c.positionCode===pos.code && c.shiftType==="Nights"
)

return(
<div key={d.toISOString()}>
{renderShiftCell(cell)}
</div>
)

})}

</div>

))}

</div>

)

})}

</div>

</CardContent>

</Card>

)

}
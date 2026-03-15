import React, { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent
} from "../../components/ui/simple-ui";

import {
  patrolPositions
} from "../../App";

import {
  buildPatrolCellsForDate,
  buildVisibleDates,
  formatShortDate,
  formatLongDate,
  getActiveTeam,
  validateMinimumStaffing
} from "../../lib/schedule-utils";

export function PatrolPage({ employees }) {

  const today = new Date()

  const [view] = useState("month")
  const [month] = useState(today.getMonth())
  const [year] = useState(today.getFullYear())

  const baseDate = new Date(year,month,1)
  const dates = buildVisibleDates(baseDate,view)

  const weeks=[]
  for(let i=0;i<dates.length;i+=7){
    weeks.push(dates.slice(i,i+7))
  }

  const visibleDayCount = weeks[0]?.length || 7

  const renderShiftCell=(cell)=>{

    const employee = employees.find(e=>e.id===cell?.employeeId)
    const replacement = employees.find(e=>e.id===cell?.replacementEmployeeId)

    return(

<div
style={{
width:"100%",
minHeight:"70px",
padding:"8px",
fontSize:"13px",
border:"1px solid #e2e8f0",
borderRadius:"6px",
background: cell?.status && cell.status!=="Scheduled" ? "#fde68a":"white"
}}
>

<div style={{fontWeight:"700"}}>
V{cell?.vehicle||""} {employee?.lastName||"OPEN"}{" "}
{cell?.status && cell.status!=="Scheduled" ? cell.status : cell?.shiftHours}
</div>

{replacement && (
<div style={{fontSize:"12px"}}>
V{cell?.replacementVehicle||""} {replacement.lastName} {cell?.replacementHours}
</div>
)}

</div>

    )

  }

return(

<Card>

<CardHeader>
<CardTitle>Patrol Schedule</CardTitle>
</CardHeader>

<CardContent>

<div style={{overflowX:"auto"}}>

{weeks.map((week,weekIndex)=>{

const start=week[0]
const end=week[week.length-1]

return(

<div key={weekIndex} style={{marginBottom:"40px"}}>

{/* WEEK TITLE */}

<div style={{
textAlign:"center",
fontWeight:"700",
background:"#e2e8f0",
padding:"10px",
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
fontWeight:"600",
position:"sticky",
top:0,
zIndex:5
}}
>

<div></div>

{week.map(d=>{

const cells = buildPatrolCellsForDate(d,employees)
const staffing = validateMinimumStaffing(cells,{})

return(

<div key={d.toISOString()} style={{textAlign:"center",padding:"6px"}}>

{formatShortDate(d)}

{!staffing.ok && (
<div style={{color:"#dc2626",fontWeight:"700"}}>⚠</div>
)}

</div>

)

})}

</div>

{/* DAYS SECTION */}

<div style={{
background:"#cbd5e1",
fontWeight:"700",
padding:"8px",
marginTop:"8px"
}}>
DAY SHIFT
</div>

<div style={{
display:"grid",
gridTemplateColumns:`260px repeat(${visibleDayCount},170px)`
}}>

<div style={{
position:"sticky",
left:0,
background:"#e2e8f0",
padding:"8px",
fontWeight:"700",
borderRight:"2px solid #cbd5e1",
zIndex:4
}}>
Team
</div>

{week.map(d=>(
<div key={d.toISOString()} style={{textAlign:"center"}}>
{getActiveTeam(d,"Days")}
</div>
))}

</div>

{patrolPositions.map(pos=>{

return(

<div
key={`days-${pos.code}`}
style={{
display:"grid",
gridTemplateColumns:`260px repeat(${visibleDayCount},170px)`,
borderTop:"1px solid #e2e8f0"
}}
>

<div
style={{
position:"sticky",
left:0,
background:"#f1f5f9",
padding:"8px",
fontWeight:"700",
borderRight:"2px solid #cbd5e1",
zIndex:4
}}
>
{pos.label}
</div>

{week.map(d=>{

const cells = buildPatrolCellsForDate(d,employees)
const cell = cells.find(c=>c.positionCode===pos.code && c.shiftType==="Days")

return(
<div key={`${pos.code}-${d.toISOString()}`}>
{renderShiftCell(cell)}
</div>
)

})}

</div>

)

})}

{/* NIGHT SECTION */}

<div style={{
background:"#cbd5e1",
fontWeight:"700",
padding:"8px",
marginTop:"16px"
}}>
NIGHT SHIFT
</div>

<div style={{
display:"grid",
gridTemplateColumns:`260px repeat(${visibleDayCount},170px)`
}}>

<div style={{
position:"sticky",
left:0,
background:"#e2e8f0",
padding:"8px",
fontWeight:"700",
borderRight:"2px solid #cbd5e1",
zIndex:4
}}>
Team
</div>

{week.map(d=>(
<div key={d.toISOString()} style={{textAlign:"center"}}>
{getActiveTeam(d,"Nights")}
</div>
))}

</div>

{patrolPositions.map(pos=>{

return(

<div
key={`nights-${pos.code}`}
style={{
display:"grid",
gridTemplateColumns:`260px repeat(${visibleDayCount},170px)`,
borderTop:"1px solid #e2e8f0"
}}
>

<div
style={{
position:"sticky",
left:0,
background:"#f1f5f9",
padding:"8px",
fontWeight:"700",
borderRight:"2px solid #cbd5e1",
zIndex:4
}}
>
{pos.label}
</div>

{week.map(d=>{

const cells = buildPatrolCellsForDate(d,employees)
const cell = cells.find(c=>c.positionCode===pos.code && c.shiftType==="Nights")

return(
<div key={`${pos.code}-${d.toISOString()}`}>
{renderShiftCell(cell)}
</div>
)

})}

</div>

)

})}

</div>

)

})}

</div>

</CardContent>

</Card>

)

}
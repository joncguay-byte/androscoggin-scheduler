import React from "react"

export default function SummaryCards() {

const cards = [
{
label:"Total Deputies",
value:"20",
color:"#2563eb"
},
{
label:"On Duty Today",
value:"10",
color:"#16a34a"
},
{
label:"Open Shifts",
value:"1",
color:"#ea580c"
},
{
label:"Staffing Alerts",
value:"⚠",
color:"#dc2626"
}
]

return(

<div
style={{
display:"grid",
gridTemplateColumns:"repeat(4,1fr)",
gap:"16px"
}}
>

{cards.map((card,i)=>(

<div
key={i}
style={{
background:"white",
borderRadius:"12px",
padding:"18px",
border:"1px solid #e2e8f0",
boxShadow:"0 2px 4px rgba(0,0,0,0.04)"
}}
>

<div
style={{
fontSize:"13px",
fontWeight:"600",
color:"#64748b",
marginBottom:"8px"
}}
>
{card.label}
</div>

<div
style={{
fontSize:"28px",
fontWeight:"800",
color:card.color
}}
>
{card.value}
</div>

</div>

))}

</div>

)

}
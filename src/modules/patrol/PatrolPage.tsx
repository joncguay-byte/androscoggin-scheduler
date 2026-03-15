import React, { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Input,
} from "../../components/ui/simple-ui";

import {
  patrolPositions,
  scheduleViews,
  statusOptions
} from "../../App";

import {
  buildPatrolCellsForDate,
  buildVisibleDates,
  validateShift,
  formatShortDate,
  formatLongDate,
  getActiveTeam,
  validateMinimumStaffing
} from "../../lib/schedule-utils";

export function PatrolPage({ employees, canEdit }: { employees: Employee[]; canEdit?: boolean }) {
  const today = new Date();
  const [view, setView] = useState<ScheduleView>("month");
  const [month, setMonth] = useState(today.getMonth());
  const [year, setYear] = useState(today.getFullYear());

  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);

  // persistent schedule state
  const [schedule, setSchedule] = useState<Record<string, PatrolCellRecord>>({});

  // drag / drop support
  const [dragCellId, setDragCellId] = useState<string | null>(null);

  const baseDate = new Date(year, month, 1);
  const dates = buildVisibleDates(baseDate, view);

  const weeks: Date[][] = [];
  for (let i = 0; i < dates.length; i += 7) {
    weeks.push(dates.slice(i, i + 7));
  }

  const visibleWeeks = view === "two_week" ? weeks.slice(0, 2) : view === "week" ? [dates.slice(0, 7)] : view === "day" ? [dates.slice(0, 1)] : weeks;
  const visibleDayCount = visibleWeeks[0]?.length || 7;

  const openEditor = (cell: PatrolCellRecord | undefined) => {
    if (!cell || !canEdit) return;

    setEditingCell({
      cell,
      employeeId: cell.employeeId || "",
      vehicle: cell.vehicle || "",
      shiftHours: cell.shiftHours || "",
      status: cell.status,
      offReason: cell.offReason || "",
      replacementEmployeeId: cell.replacementEmployeeId || "",
      replacementVehicle: cell.replacementVehicle || "",
      replacementHours: cell.replacementHours || "",
      splitShift: cell.splitShift || "",
      notes: cell.notes || "",
    });
  };

  const handleDropSwap = (targetCell: PatrolCellRecord | undefined) => {

  if (!dragCellId || !targetCell) return;

  const sourceCell = schedule[dragCellId] ?? targetCell;
  const targetExisting = schedule[targetCell.id] ?? targetCell;

  const updatedSource = {
    ...sourceCell,
    employeeId: targetExisting.employeeId,
    vehicle: targetExisting.vehicle
  };

  const updatedTarget = {
    ...targetExisting,
    employeeId: sourceCell.employeeId,
    vehicle: sourceCell.vehicle
  };

  setSchedule(prev => ({
    ...prev,
    [updatedSource.id]: updatedSource,
    [updatedTarget.id]: updatedTarget
  }));

  setDragCellId(null);
};

  const renderShiftCell = (cell: PatrolCellRecord | undefined) => {
    const realCell = cell ? (schedule[cell.id] ?? cell) : cell;
    const employee = employees.find((e) => e.id === realCell?.employeeId);
    const replacement = employees.find((e) => e.id === realCell?.replacementEmployeeId);

    const isOff = realCell?.status && realCell.status !== "Scheduled" && realCell.status !== "Open Shift";

    return (
     <button
  draggable
  onDragStart={() => setDragCellId(cell?.id || null)}
  onDragOver={(e) => e.preventDefault()}
  onDrop={() => handleDropSwap(cell)}
  onClick={() => openEditor(cell)}
  style={{
    width: "100%",
    minHeight: "52px",
    textAlign: "left",
    padding: "6px",
    fontSize: "12px",
    border: "1px solid #e2e8f0",
    background:
      realCell?.status && realCell.status !== "Scheduled"
        ? "#fde68a"
        : "white",
    cursor: "pointer"
  }}
>

{/* PRIMARY OFFICER */}
<div style={{fontWeight:"600"}}>

V{realCell?.vehicle || ""} {employee?.lastName || "OPEN"}{" "}

{realCell?.status && realCell.status !== "Scheduled"
  ? realCell.status
  : realCell?.shiftHours || ""}

</div>


{/* REPLACEMENT OFFICER */}

{replacement && (

<div style={{fontSize:"12px"}}>

V{realCell?.replacementVehicle || ""} {replacement.lastName} {realCell?.replacementHours || ""}

</div>

)}

</button>
    );
  };

  return (
    <>
      <Card className="rounded-2xl border-slate-200 shadow-sm">
       <CardHeader>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"12px"}}>

    <CardTitle>Patrol Schedule</CardTitle>

    <div style={{display:"flex",gap:"10px"}}>

      <Select value={view} onValueChange={(v)=>setView(v as ScheduleView)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {scheduleViews.map(v=>(
            <SelectItem key={v.value} value={v.value}>
              {v.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={String(month)} onValueChange={(v)=>setMonth(Number(v))}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {Array.from({length:12}).map((_,i)=>(
            <SelectItem key={i} value={String(i)}>
              {new Date(2000,i).toLocaleString(undefined,{month:"long"})}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={String(year)} onValueChange={(v)=>setYear(Number(v))}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {Array.from({length:10}).map((_,i)=>{
            const y=new Date().getFullYear()-5+i
            return <SelectItem key={y} value={String(y)}>{y}</SelectItem>
          })}
        </SelectContent>
      </Select>

    </div>

  </div>
</CardHeader>

        <CardContent>
          <div style={{width:"100%",overflowX:"auto",background:"#fff",borderRadius:"10px"}}>

{visibleWeeks.map((week, weekIndex) => {

  const start = week[0]
  const end = week[week.length - 1]

  return (

  <div key={weekIndex} style={{marginBottom:"30px"}}>

  <div style={{
    background:"#f1f5f9",
    textAlign:"center",
    fontWeight:"600",
    padding:"6px",
    borderRadius:"6px"
  }}>
    {formatLongDate(start)} - {formatLongDate(end)}
  </div>


  {/* DATE HEADER */}
  <div
  style={{
    display:"grid",
    gridTemplateColumns:`220px repeat(${visibleDayCount}, 150px)`,
    borderBottom:"1px solid #cbd5e1",
    background:"#f8fafc",
    fontSize:"12px",
    fontWeight:"600"
  }}
  >

  <div></div>

  {week.map((d)=>{

  const cells = buildPatrolCellsForDate(d, employees)
  const staffing = validateMinimumStaffing(cells, schedule)

  return (
    <div
      key={d.toISOString()}
      style={{
        textAlign:"center",
        padding:"4px"
      }}
    >
      {formatShortDate(d)}

      {!staffing.ok && (
        <div style={{color:"#dc2626",fontSize:"14px",fontWeight:"700"}}>
          ⚠
        </div>
      )}
    </div>
  )

})}

  </div>


  {/* DAYS TEAM LABEL */}
  <div
  style={{
    display:"grid",
    gridTemplateColumns:`220px repeat(${visibleDayCount}, 150px)`
  }}
  >

  <div style={{
  padding:"6px",
  fontWeight:"700",
  background:"#e2e8f0",
  borderRight:"2px solid #cbd5e1"
}}>
  Days
</div>

  {week.map((d)=>(
    <div key={d.toISOString()} style={{textAlign:"center"}}>
      {getActiveTeam(d,"Days")}
    </div>
  ))}

  </div>


  {/* DAY POSITIONS */}
  {patrolPositions.map((pos)=>{

    return (

    <div
    key={`days-${pos.code}`}
    style={{
      display:"grid",
      gridTemplateColumns:`220px repeat(${visibleDayCount},150px)`,
      borderTop:"1px solid #e2e8f0"
    }}
    >
<div style={{
  padding:"6px",
  fontWeight:"600",
  background:"#f1f5f9",
  borderRight:"2px solid #cbd5e1"
}}>
  {pos.label}
</div>
    
    {week.map((d)=>{

      const cells = buildPatrolCellsForDate(d,employees)

      const cell = cells.find(
        c=>c.positionCode===pos.code && c.shiftType==="Days"
      )

      return (
        <div key={`${pos.code}-${d.toISOString()}`} style={{borderLeft:"1px solid #e2e8f0"}}>
          {renderShiftCell(cell)}
        </div>
      )

    })}

    </div>

    )

  })}


  {/* NIGHT TEAM LABEL */}
  <div
  style={{
    display:"grid",
    gridTemplateColumns:`220px repeat(${visibleDayCount},150px)`,
    marginTop:"12px"
  }}
  >

 <div style={{
  padding:"6px",
  fontWeight:"700",
  background:"#e2e8f0",
  borderRight:"2px solid #cbd5e1"
}}>
  Nights
</div>

  {week.map((d)=>(
    <div key={d.toISOString()} style={{textAlign:"center"}}>
      {getActiveTeam(d,"Nights")}
    </div>
  ))}

  </div>


  {/* NIGHT POSITIONS */}
  {patrolPositions.map((pos)=>{

    return (

    <div
    key={`nights-${pos.code}`}
    style={{
      display:"grid",
      gridTemplateColumns:`220px repeat(${visibleDayCount},150px)`,
      borderTop:"1px solid #e2e8f0"
    }}
    >

    <div style={{padding:"4px",fontWeight:"600"}}>
      {pos.label}
    </div>

    {week.map((d)=>{

      const cells = buildPatrolCellsForDate(d,employees)

      const cell = cells.find(
        c=>c.positionCode===pos.code && c.shiftType==="Nights"
      )

      return (
        <div key={`${pos.code}-${d.toISOString()}n`} style={{borderLeft:"1px solid #e2e8f0"}}>
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
            {visibleWeeks.map((week, weekIndex) => {
  const start = week[0];
  const end = week[week.length - 1];

  return (
    <div key={weekIndex} style={{padding:"20px",borderBottom:"1px solid #e2e8f0"}}>
      <div style={{fontWeight:"bold"}}>
        {formatLongDate(start)} - {formatLongDate(end)}
      </div>
    </div>
  );
})}

</CardContent>
</Card>

      {/* EDIT DIALOG */}
<Dialog open={!!editingCell}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Edit Shift</DialogTitle>
    </DialogHeader>

    {editingCell && (
      <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>

        <div>
          <Label>Status</Label>
          <Select
            value={editingCell.status}
            onValueChange={(v)=>setEditingCell({...editingCell,status:v})}
          >
            <SelectTrigger><SelectValue/></SelectTrigger>
            <SelectContent>
              {statusOptions.map(s=>(
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Replacement</Label>
          <Select
            value={editingCell.replacementEmployeeId || ""}
            onValueChange={(v)=>setEditingCell({...editingCell,replacementEmployeeId:v})}
          >
            <SelectTrigger><SelectValue/></SelectTrigger>
            <SelectContent>
              {employees.map(e=>(
                <SelectItem key={e.id} value={e.id}>
                  {e.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

      </div>
    )}

    <DialogFooter>
      <Button onClick={()=>setEditingCell(null)}>Cancel</Button>
      <Button
        onClick={()=>{
          if(!editingCell) return

          setSchedule(prev=>({
            ...prev,
            [editingCell.cell.id]:{
              ...editingCell.cell,
              status:editingCell.status,
              replacementEmployeeId:editingCell.replacementEmployeeId
            }
          }))

          setEditingCell(null)
        }}
      >
        Save
      </Button>
    </DialogFooter>

  </DialogContent>
</Dialog>
</>
);
}


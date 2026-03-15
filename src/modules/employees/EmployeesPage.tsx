import React, { useState } from "react";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Input,
  Label,
  Select,
  SelectItem,
  SelectContent,
  SelectTrigger,
  SelectValue
} from "../../components/ui/simple-ui";

export default function EmployeesPage({ employees, setEmployees }: any) {

  const [newEmployee, setNewEmployee] = useState({
    firstName: "",
    lastName: "",
    rank: "Deputy",
    team: "Days A",
    vehicle: "",
    hours: "5a-5p",
    hireDate: "",
    status: "Active"
  });

  function addEmployee() {
    const id = crypto.randomUUID();

    setEmployees([
      ...employees,
      { id, ...newEmployee }
    ]);

    setNewEmployee({
      firstName: "",
      lastName: "",
      rank: "Deputy",
      team: "Days A",
      vehicle: "",
      hours: "5a-5p",
      hireDate: "",
      status: "Active"
    });
  }

  function deleteEmployee(id: string) {
    setEmployees(employees.filter((e: any) => e.id !== id));
  }

  return (
    <Card className="rounded-2xl border-slate-200 shadow-sm">

      <CardHeader>
        <CardTitle>Employees</CardTitle>
      </CardHeader>

      <CardContent>

        {/* ADD EMPLOYEE FORM */}

        <div style={{display:"grid",gridTemplateColumns:"repeat(8,1fr)",gap:"10px"}}>

          <Input
            placeholder="First Name"
            value={newEmployee.firstName}
            onChange={(e)=>setNewEmployee({...newEmployee,firstName:e.target.value})}
          />

          <Input
            placeholder="Last Name"
            value={newEmployee.lastName}
            onChange={(e)=>setNewEmployee({...newEmployee,lastName:e.target.value})}
          />

          <Input
            placeholder="Vehicle"
            value={newEmployee.vehicle}
            onChange={(e)=>setNewEmployee({...newEmployee,vehicle:e.target.value})}
          />

          <Input
            type="date"
            value={newEmployee.hireDate}
            onChange={(e)=>setNewEmployee({...newEmployee,hireDate:e.target.value})}
          />

          <Button onClick={addEmployee}>
            Add
          </Button>

        </div>

        {/* EMPLOYEE TABLE */}

        <div style={{marginTop:"20px"}}>

          {employees.map((emp:any,index:number)=>(
  <div
    key={emp.id}
    style={{
      display:"grid",
      gridTemplateColumns:"repeat(9,1fr)",
      padding:"8px",
      borderBottom:"1px solid #eee",
      gap:"6px"
    }}
  >

    <Input
      value={emp.firstName}
      onChange={(e)=>{
        const updated=[...employees]
        updated[index].firstName=e.target.value
        setEmployees(updated)
      }}
    />

    <Input
      value={emp.lastName}
      onChange={(e)=>{
        const updated=[...employees]
        updated[index].lastName=e.target.value
        setEmployees(updated)
      }}
    />

    <Input
      value={emp.rank}
      onChange={(e)=>{
        const updated=[...employees]
        updated[index].rank=e.target.value
        setEmployees(updated)
      }}
    />

    <Input
      value={emp.team}
      onChange={(e)=>{
        const updated=[...employees]
        updated[index].team=e.target.value
        setEmployees(updated)
      }}
    />

    <Input
      value={emp.defaultVehicle}
      onChange={(e)=>{
        const updated=[...employees]
        updated[index].defaultVehicle=e.target.value
        setEmployees(updated)
      }}
    />

    <Input
      value={emp.defaultShiftHours}
      onChange={(e)=>{
        const updated=[...employees]
        updated[index].defaultShiftHours=e.target.value
        setEmployees(updated)
      }}
    />

    <Input
      type="date"
      value={emp.hireDate}
      onChange={(e)=>{
        const updated=[...employees]
        updated[index].hireDate=e.target.value
        setEmployees(updated)
      }}
    />

    <Input
      value={emp.status}
      onChange={(e)=>{
        const updated=[...employees]
        updated[index].status=e.target.value
        setEmployees(updated)
      }}
    />

    <Button onClick={()=>deleteEmployee(emp.id)}>
      Delete
    </Button>

  </div>
))}

        </div>

      </CardContent>

    </Card>
  );
}
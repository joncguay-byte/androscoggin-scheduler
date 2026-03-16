import React, { useState } from "react"

import Header from "./components/Header"
import SummaryCards from "./components/SummaryCards"
import ModuleTabs from "./components/ModuleTabs"

import { PatrolPage } from "./modules/patrol/PatrolPage"
import EmployeesPage from "./modules/employees/EmployeesPage"
import { CIDPage } from "./modules/cid/CIDPage"
import { ForcePage } from "./modules/force/ForcePage"

import {
  Shield,
  Users,
  CalendarDays,
  FileText,
  Settings,
  Briefcase,
  Clock3,
  AlertTriangle
} from "lucide-react"

type AppRole = "Admin" | "Sergeant" | "Detective" | "Deputy"
type ModuleKey = "patrol" | "cid" | "force" | "detail" | "reports" | "employees" | "settings"

type Employee = {
  id: string
  firstName: string
  lastName: string
  rank: string
  team: string
  defaultVehicle: string
  defaultShiftHours: string
  hireDate: string
  status: string
}

type UserProfile = {
  id: string
  username: string
  role: AppRole
}

const moduleOrder = [
  { key: "patrol", label: "Patrol", icon: Shield },
  { key: "cid", label: "CID", icon: Clock3 },
  { key: "force", label: "Force", icon: AlertTriangle },
  { key: "detail", label: "Detail", icon: Briefcase },
  { key: "reports", label: "Reports", icon: FileText },
  { key: "employees", label: "Employees", icon: Users },
  { key: "settings", label: "Settings", icon: Settings }
]

const initialEmployees: Employee[] = [
  { id:"1", firstName:"Jon", lastName:"Guay", rank:"Sgt", team:"Days A", defaultVehicle:"V7", defaultShiftHours:"5a-5p", hireDate:"2011-05-01", status:"Active" },
  { id:"2", firstName:"Dylan", lastName:"Rider", rank:"Cpl", team:"Days A", defaultVehicle:"V17", defaultShiftHours:"5a-5p", hireDate:"2013-06-01", status:"Active" },
  { id:"3", firstName:"Jimmy", lastName:"Phillips", rank:"Deputy", team:"Days A", defaultVehicle:"V13", defaultShiftHours:"5a-5p", hireDate:"2015-02-15", status:"Active" },
  { id:"4", firstName:"Chris", lastName:"Miller", rank:"Deputy", team:"Days A", defaultVehicle:"V25", defaultShiftHours:"5a-5p", hireDate:"2018-08-20", status:"Active" },
  { id:"5", firstName:"Joe", lastName:"Tripp", rank:"Poland Deputy", team:"Days A", defaultVehicle:"V28", defaultShiftHours:"5a-5p", hireDate:"2020-01-10", status:"Active" }
]

function EmptyModule({ title }: { title: string }) {
  return (
    <div style={{padding:"40px",textAlign:"center"}}>
      <h2>{title} module coming next</h2>
    </div>
  )
}

export default function App() {

  const [user] = useState<UserProfile>({
    id: "u1",
    username: "Admin",
    role: "Admin"
  })

  const [employees, setEmployees] = useState<Employee[]>(initialEmployees)

  const [activeModule, setActiveModule] = useState<ModuleKey>("patrol")

  return (

    <div style={{
      width:"100%",
      minHeight:"100vh",
      padding:"20px",
      boxSizing:"border-box"
    }}>

      <Header user={user} />

      <div style={{marginTop:"20px",marginBottom:"20px"}}>
        <SummaryCards />
      </div>

      <ModuleTabs
        active={activeModule}
        onChange={setActiveModule}
        moduleOrder={moduleOrder}
      />

      {activeModule === "patrol" && (
        <PatrolPage employees={employees} canEdit={true} />
      )}

      {activeModule === "cid" && (
        <CIDPage employees={employees} />
      )}

      {activeModule === "force" && (
        <ForcePage employees={employees} />
      )}

      {activeModule === "detail" && (
        <EmptyModule title="Detail" />
      )}

      {activeModule === "reports" && (
        <EmptyModule title="Reports" />
      )}

      {activeModule === "employees" && (
        <EmployeesPage employees={employees} setEmployees={setEmployees} />
      )}

      {activeModule === "settings" && (
        <EmptyModule title="Settings" />
      )}

    </div>

  )
}
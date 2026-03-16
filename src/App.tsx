import React, { useState } from "react"

import Header from "./components/Header"
import SummaryCards from "./components/SummaryCards"
import ModuleTabs from "./components/ModuleTabs"

import { PatrolPage } from "./modules/patrol/PatrolPage"
import EmployeesPage from "./modules/employees/EmployeesPage"

import { initialEmployees } from "./data/employees"

import { Shield, Users, AlertTriangle } from "lucide-react"


type ModuleKey =
  | "patrol"
  | "cid"
  | "force"
  | "detail"
  | "reports"
  | "employees"
  | "settings"


const moduleOrder = [
  { key: "patrol", label: "Patrol", icon: Shield },
  { key: "force", label: "Force", icon: AlertTriangle },
  { key: "employees", label: "Employees", icon: Users }
]


export default function App() {

  const [employees, setEmployees] = useState(initialEmployees)

  const [activeModule, setActiveModule] =
    useState<ModuleKey>("patrol")


  return (

    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        padding: "20px",
        boxSizing: "border-box"
      }}
    >

      <Header />

      <div style={{ marginTop: "20px", marginBottom: "20px" }}>
        <SummaryCards />
      </div>

      <ModuleTabs
        active={activeModule}
        onChange={setActiveModule}
        moduleOrder={moduleOrder}
        visibleModules={moduleOrder.map(m => m.key)}
      />

      {activeModule === "patrol" && (
        <PatrolPage
          employees={employees}
          canEdit={true}
        />
      )}

      {activeModule === "employees" && (
        <EmployeesPage
          employees={employees}
          setEmployees={setEmployees}
        />
      )}

    </div>

  )
}
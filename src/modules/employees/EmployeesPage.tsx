import { useState } from "react"
import type { ChangeEvent, Dispatch, SetStateAction } from "react"

import {
  Card,
  CardContent,
  Button,
  Input
} from "../../components/ui/simple-ui"
import { pushAppToast } from "../../stores/ui-store"
import type { Employee, Rank, Team } from "../../types"

type NewEmployeeForm = {
  firstName: string
  lastName: string
  rank: Rank
  team: Team
  vehicle: string
  hours: string
  hireDate: string
  status: Employee["status"]
}

type EmployeesPageProps = {
  employees: Employee[]
  setEmployees: Dispatch<SetStateAction<Employee[]>>
  onEmployeeAdded?: (employee: Employee) => void
  onEmployeeUpdated?: (previous: Employee, next: Employee) => void
  onEmployeeDeleted?: (employee: Employee) => void
}

export default function EmployeesPage({
  employees,
  setEmployees,
  onEmployeeAdded,
  onEmployeeUpdated,
  onEmployeeDeleted
}: EmployeesPageProps) {
  const [lastAddedEmployeeId, setLastAddedEmployeeId] = useState("")
  const [newEmployee, setNewEmployee] = useState<NewEmployeeForm>({
    firstName: "",
    lastName: "",
    rank: "Deputy",
    team: "Days A",
    vehicle: "",
    hours: "5a-5p",
    hireDate: "",
    status: "Active"
  })

  function addEmployee() {
    if (!newEmployee.firstName.trim() || !newEmployee.lastName.trim()) {
      pushAppToast({
        tone: "warning",
        title: "Employee name missing",
        message: "Enter a first and last name before adding a new employee."
      })
      return
    }

    if (!newEmployee.hireDate) {
      pushAppToast({
        tone: "warning",
        title: "Hire date missing",
        message: "Enter a hire date before adding a new employee."
      })
      return
    }

    const id = crypto.randomUUID()
    const createdEmployee: Employee = {
      id,
      firstName: newEmployee.firstName.trim(),
      lastName: newEmployee.lastName.trim(),
      rank: newEmployee.rank,
      team: newEmployee.team,
      defaultVehicle: newEmployee.vehicle.trim(),
      defaultShiftHours: newEmployee.hours,
      hireDate: newEmployee.hireDate,
      status: newEmployee.status
    }

    setEmployees((currentEmployees) => [
      createdEmployee,
      ...currentEmployees
    ])
    setLastAddedEmployeeId(createdEmployee.id)
    pushAppToast({
      tone: "success",
      title: "Employee added",
      message: `${createdEmployee.firstName} ${createdEmployee.lastName} was added to the staff list.`
    })
    onEmployeeAdded?.(createdEmployee)

    setNewEmployee({
      firstName: "",
      lastName: "",
      rank: "Deputy",
      team: "Days A",
      vehicle: "",
      hours: "5a-5p",
      hireDate: "",
      status: "Active"
    })
  }

  function deleteEmployee(id: string) {
    const employee = employees.find((currentEmployee) => currentEmployee.id === id)
    setEmployees(employees.filter((currentEmployee) => currentEmployee.id !== id))
    if (employee) {
      onEmployeeDeleted?.(employee)
    }
  }

  function updateEmployee(index: number, updater: (employee: Employee) => Employee) {
    setEmployees((currentEmployees) =>
      currentEmployees.map((employee, employeeIndex) => {
        if (employeeIndex !== index) return employee

        const nextEmployee = updater(employee)
        onEmployeeUpdated?.(employee, nextEmployee)
        return nextEmployee
      })
    )
  }

  return (
    <Card className="rounded-2xl border-slate-200 shadow-sm">
      <CardContent>
        <div
          style={{
            display: "grid",
            gap: "14px",
            padding: "18px",
            marginBottom: "18px",
            background: "linear-gradient(180deg, #f8fbff 0%, #eef4ff 100%)",
            borderRadius: "16px",
            border: "1px solid #dbeafe"
          }}
        >
          <div style={{ display: "grid", gap: "4px" }}>
            <div style={{ fontSize: "11px", fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#1d4ed8" }}>
              Staff Directory
            </div>
            <div style={{ fontSize: "28px", fontWeight: 800, lineHeight: 1.05, color: "#0f172a" }}>
              Employees
            </div>
            <div style={{ fontSize: "13px", color: "#475569" }}>
              Manage staffing, vehicles, teams, and base shift settings from one roster.
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px" }}>
            {[
              { label: "Total Staff", value: String(employees.length), tone: "#1d4ed8", bg: "#eff6ff" },
              { label: "Active", value: String(employees.filter((employee) => employee.status === "Active").length), tone: "#166534", bg: "#ecfdf5" },
              { label: "CID", value: String(employees.filter((employee) => employee.team === "CID").length), tone: "#7c3aed", bg: "#f5f3ff" },
              { label: "SRO", value: String(employees.filter((employee) => employee.team === "SRO").length), tone: "#92400e", bg: "#fffbeb" }
            ].map((card) => (
              <div key={card.label} style={{ border: "1px solid rgba(148, 163, 184, 0.22)", borderRadius: "12px", padding: "12px 14px", background: card.bg, display: "grid", gap: "3px" }}>
                <div style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>{card.label}</div>
                <div style={{ fontSize: "26px", lineHeight: 1, fontWeight: 800, color: card.tone }}>{card.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(8,1fr)", gap: "10px" }}>
          <Input
            placeholder="First Name"
            value={newEmployee.firstName}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNewEmployee({ ...newEmployee, firstName: e.target.value })}
          />

          <Input
            placeholder="Last Name"
            value={newEmployee.lastName}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNewEmployee({ ...newEmployee, lastName: e.target.value })}
          />

          <Input
            placeholder="Vehicle"
            value={newEmployee.vehicle}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNewEmployee({ ...newEmployee, vehicle: e.target.value })}
          />

          <Input
            placeholder="Rank"
            value={newEmployee.rank}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNewEmployee({ ...newEmployee, rank: e.target.value as Rank })}
          />

          <Input
            placeholder="Team"
            value={newEmployee.team}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNewEmployee({ ...newEmployee, team: e.target.value as Team })}
          />

          <Input
            placeholder="Hours"
            value={newEmployee.hours}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNewEmployee({ ...newEmployee, hours: e.target.value })}
          />

          <Input
            type="date"
            value={newEmployee.hireDate}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNewEmployee({ ...newEmployee, hireDate: e.target.value })}
          />

          <Input
            placeholder="Status"
            value={newEmployee.status}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNewEmployee({ ...newEmployee, status: e.target.value as Employee["status"] })}
          />

          <Button onClick={addEmployee}>
            Add
          </Button>
        </div>

        <div style={{ marginTop: "20px" }}>
          {employees.map((employee, index) => (
            <div
              key={employee.id}
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(9,1fr)",
                padding: "8px",
                borderBottom: "1px solid #eee",
                gap: "6px",
                background: employee.id === lastAddedEmployeeId ? "#fff7cc" : "#ffffff"
              }}
              aria-label={employee.id === lastAddedEmployeeId ? "new-employee-row" : undefined}
            >
              <Input
                value={employee.firstName}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  updateEmployee(index, (currentEmployee) => ({ ...currentEmployee, firstName: e.target.value }))
                }}
              />

              <Input
                value={employee.lastName}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  updateEmployee(index, (currentEmployee) => ({ ...currentEmployee, lastName: e.target.value }))
                }}
              />

              <Input
                value={employee.rank}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  updateEmployee(index, (currentEmployee) => ({ ...currentEmployee, rank: e.target.value as Rank }))
                }}
              />

              <Input
                value={employee.team}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  updateEmployee(index, (currentEmployee) => ({ ...currentEmployee, team: e.target.value as Team }))
                }}
              />

              <Input
                value={employee.defaultVehicle}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  updateEmployee(index, (currentEmployee) => ({ ...currentEmployee, defaultVehicle: e.target.value }))
                }}
              />

              <Input
                value={employee.defaultShiftHours}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  updateEmployee(index, (currentEmployee) => ({ ...currentEmployee, defaultShiftHours: e.target.value }))
                }}
              />

              <Input
                type="date"
                value={employee.hireDate}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  updateEmployee(index, (currentEmployee) => ({ ...currentEmployee, hireDate: e.target.value }))
                }}
              />

              <Input
                value={employee.status}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  updateEmployee(index, (currentEmployee) => ({
                    ...currentEmployee,
                    status: e.target.value as Employee["status"]
                  }))
                }}
              />

              <Button onClick={() => deleteEmployee(employee.id)}>
                Delete
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

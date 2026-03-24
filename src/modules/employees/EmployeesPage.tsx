import { useState } from "react"
import type { ChangeEvent, Dispatch, SetStateAction } from "react"

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Input
} from "../../components/ui/simple-ui"
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
    const id = crypto.randomUUID()
    const createdEmployee: Employee = {
      id,
      firstName: newEmployee.firstName,
      lastName: newEmployee.lastName,
      rank: newEmployee.rank,
      team: newEmployee.team,
      defaultVehicle: newEmployee.vehicle,
      defaultShiftHours: newEmployee.hours,
      hireDate: newEmployee.hireDate,
      status: newEmployee.status
    }

    setEmployees([
      ...employees,
      createdEmployee
    ])
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
      <CardHeader>
        <CardTitle>Employees</CardTitle>
      </CardHeader>

      <CardContent>
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
            type="date"
            value={newEmployee.hireDate}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNewEmployee({ ...newEmployee, hireDate: e.target.value })}
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
                gap: "6px"
              }}
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

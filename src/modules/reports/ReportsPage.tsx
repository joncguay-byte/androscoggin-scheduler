import React from "react"
import { Card, CardHeader, CardTitle, CardContent } from "../../components/ui/simple-ui"

export function ReportsPage({ employees }) {

  return (

    <Card>

      <CardHeader>
        <CardTitle>Administrative Reports</CardTitle>
      </CardHeader>

      <CardContent>

        <h3 style={{marginBottom:"10px"}}>Employee List</h3>

        <table style={{width:"100%",borderCollapse:"collapse"}}>

          <thead>

            <tr>
              <th style={{textAlign:"left",padding:"8px"}}>Name</th>
              <th style={{textAlign:"left",padding:"8px"}}>Rank</th>
              <th style={{textAlign:"left",padding:"8px"}}>Team</th>
              <th style={{textAlign:"left",padding:"8px"}}>Vehicle</th>
            </tr>

          </thead>

          <tbody>

            {employees.map(emp => (

              <tr key={emp.id}>

                <td style={{padding:"8px"}}>
                  {emp.lastName}, {emp.firstName}
                </td>

                <td style={{padding:"8px"}}>
                  {emp.rank}
                </td>

                <td style={{padding:"8px"}}>
                  {emp.team}
                </td>

                <td style={{padding:"8px"}}>
                  {emp.defaultVehicle}
                </td>

              </tr>

            ))}

          </tbody>

        </table>

      </CardContent>

    </Card>

  )
}
import React, { useState } from "react"
import { Card, CardHeader, CardTitle, CardContent } from "../../components/ui/simple-ui"

export function CIDPage({ employees }) {

  const detectives = employees.filter(e => e.rank === "Detective")

  const [rotation, setRotation] = useState(
    detectives.map(d => ({
      id: d.id,
      name: d.lastName,
      lastRotation: "N/A",
      nextRotation: "TBD"
    }))
  )

  return (

    <Card>

      <CardHeader>
        <CardTitle>CID Rotation</CardTitle>
      </CardHeader>

      <CardContent>

        <table style={{width:"100%",borderCollapse:"collapse"}}>

          <thead>
            <tr>
              <th style={{textAlign:"left",padding:"8px"}}>Detective</th>
              <th style={{textAlign:"left",padding:"8px"}}>Last Rotation</th>
              <th style={{textAlign:"left",padding:"8px"}}>Next Rotation</th>
            </tr>
          </thead>

          <tbody>

            {rotation.map(r => (

              <tr key={r.id}>

                <td style={{padding:"8px"}}>{r.name}</td>
                <td style={{padding:"8px"}}>{r.lastRotation}</td>
                <td style={{padding:"8px"}}>{r.nextRotation}</td>

              </tr>

            ))}

          </tbody>

        </table>

      </CardContent>

    </Card>

  )
}
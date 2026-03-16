import React, { useState } from "react"
import { Card, CardHeader, CardTitle, CardContent, Button } from "../../components/ui/simple-ui"

export function DetailPage({ employees }) {

  const [details, setDetails] = useState(
    employees.map(e => ({
      id: e.id,
      name: e.lastName,
      count: 0
    }))
  )

  function addDetail(id) {

    setDetails(prev =>
      prev.map(d =>
        d.id === id
          ? { ...d, count: d.count + 1 }
          : d
      )
    )

  }

  function removeDetail(id) {

    setDetails(prev =>
      prev.map(d =>
        d.id === id
          ? { ...d, count: Math.max(0, d.count - 1) }
          : d
      )
    )

  }

  return (

    <Card>

      <CardHeader>
        <CardTitle>Special Duty Details</CardTitle>
      </CardHeader>

      <CardContent>

        <table style={{width:"100%",borderCollapse:"collapse"}}>

          <thead>

            <tr>
              <th style={{textAlign:"left",padding:"8px"}}>Deputy</th>
              <th style={{textAlign:"left",padding:"8px"}}>Details Worked</th>
              <th style={{padding:"8px"}}></th>
            </tr>

          </thead>

          <tbody>

            {details.map(d => (

              <tr key={d.id}>

                <td style={{padding:"8px"}}>{d.name}</td>

                <td style={{padding:"8px",fontWeight:"600"}}>
                  {d.count}
                </td>

                <td style={{padding:"8px"}}>

                  <Button onClick={() => addDetail(d.id)}>
                    +1
                  </Button>

                  <Button onClick={() => removeDetail(d.id)} style={{marginLeft:"6px"}}>
                    -1
                  </Button>

                </td>

              </tr>

            ))}

          </tbody>

        </table>

      </CardContent>

    </Card>

  )
}
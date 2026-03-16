import React, { useState, useEffect } from "react"
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent
} from "../../components/ui/simple-ui"

import {
  patrolPositions,
  scheduleViews,
  statusOptions
} from "../../data/constants";

import {
  buildVisibleDates,
  formatShortDate,
  formatLongDate,
  getActiveTeam,
  validateMinimumStaffing,
  fetchSchedule,
  subscribeToSchedule
} from "../../lib/schedule-utils"

export function PatrolPage({ employees }) {

  const today = new Date()

  const [view] = useState("month")
  const [month] = useState(today.getMonth())
  const [year] = useState(today.getFullYear())

  const [schedule, setSchedule] = useState([])

  const baseDate = new Date(year, month, 1)
  const dates = buildVisibleDates(baseDate, view)

  const weeks = []
  for (let i = 0; i < dates.length; i += 7) {
    weeks.push(dates.slice(i, i + 7))
  }

  const visibleDayCount = weeks[0]?.length || 7


  /* =============================
     LOAD SCHEDULE FROM SUPABASE
  ============================== */

  useEffect(() => {

    async function loadSchedule() {
      const data = await fetchSchedule()
      setSchedule(data)
    }

    loadSchedule()

    const channel = subscribeToSchedule(() => {
      loadSchedule()
    })

    return () => {
      channel.unsubscribe()
    }

  }, [])


  return (

    <Card>

      <CardHeader>
        <CardTitle>Androscoggin Patrol Schedule</CardTitle>
      </CardHeader>

      <CardContent>

        <div style={{width:"100%",overflowX:"auto"}}>

          {weeks.map((week, weekIndex) => {

            const start = week[0]
            const end = week[week.length - 1]

            return (

              <div key={weekIndex} style={{marginBottom:"30px"}}>

                <div style={{
                  background:"#f1f5f9",
                  textAlign:"center",
                  fontWeight:"600",
                  padding:"6px"
                }}>
                  {formatLongDate(start)} - {formatLongDate(end)}
                </div>


                {/* DATE HEADER */}

                <div style={{
                  display:"grid",
                  gridTemplateColumns:`220px repeat(${visibleDayCount},150px)`,
                  background:"#f8fafc",
                  borderBottom:"1px solid #cbd5e1",
                  fontWeight:"600"
                }}>

                  <div></div>

                  {week.map((d)=>{

                    const staffing = validateMinimumStaffing([])

                    return (

                      <div key={d.toISOString()} style={{textAlign:"center"}}>

                        {formatShortDate(d)}

                        {!staffing.ok && (
                          <div style={{color:"red"}}>⚠</div>
                        )}

                      </div>

                    )

                  })}

                </div>


                {/* DAYS TEAM */}

                <div style={{
                  display:"grid",
                  gridTemplateColumns:`220px repeat(${visibleDayCount},150px)`
                }}>

                  <div style={{
                    padding:"6px",
                    fontWeight:"700",
                    background:"#e2e8f0"
                  }}>
                    Days
                  </div>

                  {week.map((d)=>(
                    <div key={d.toISOString()} style={{textAlign:"center"}}>
                      {getActiveTeam(d,"Days")}
                    </div>
                  ))}

                </div>


                {/* POSITIONS */}

                {patrolPositions.map((pos)=>{

                  return (

                    <div
                      key={pos.code}
                      style={{
                        display:"grid",
                        gridTemplateColumns:`220px repeat(${visibleDayCount},150px)`,
                        borderTop:"1px solid #e2e8f0"
                      }}
                    >

                      <div style={{
                        padding:"6px",
                        fontWeight:"600",
                        background:"#f1f5f9"
                      }}>
                        {pos.label}
                      </div>

                      {week.map((d)=>(
                        <div key={d.toISOString()} style={{borderLeft:"1px solid #e2e8f0"}}>
                        </div>
                      ))}

                    </div>

                  )

                })}

              </div>

            )

          })}

        </div>

      </CardContent>

    </Card>

  )

}
export type ForceRecord = {
  employeeId: string
  name: string
  lastForced?: string
  previousForced?: string
  totalForced: number
}

export function calculateForceList(
  employees:any[],
  history:ForceRecord[]
){

  const map = new Map()

  history.forEach(r=>{
    map.set(r.employeeId,r)
  })

  const result:ForceRecord[] = employees.map(e=>{

    const existing = map.get(e.id)

    if(existing) return existing

    return {
      employeeId:e.id,
      name:e.lastName,
      totalForced:0
    }

  })

  return result.sort(sortForceList)

}

function sortForceList(a:ForceRecord,b:ForceRecord){

  if((a.totalForced||0)!==(b.totalForced||0)){
    return (a.totalForced||0)-(b.totalForced||0)
  }

  if(!a.lastForced && !b.lastForced) return 0
  if(!a.lastForced) return -1
  if(!b.lastForced) return 1

  return new Date(a.lastForced).getTime() - new Date(b.lastForced).getTime()

}

export function recordForce(
  list:ForceRecord[],
  employeeId:string,
  date:string
){

  const updated = list.map(p=>{

    if(p.employeeId!==employeeId) return p

    return {
      ...p,
      previousForced:p.lastForced,
      lastForced:date,
      totalForced:(p.totalForced||0)+1
    }

  })

  return updated.sort(sortForceList)

}

export function recommendForce(list:ForceRecord[]){
  return list[0]
}

export function recommendEligibleForce(
  forceList:any[],
  employees:any[],
  schedule:any,
  date:string
){

  const workingIds = new Set()

  Object.values(schedule).forEach((cell:any)=>{
    if(cell.assignmentDate===date && cell.employeeId){
      workingIds.add(cell.employeeId)
    }
  })

  const eligible = forceList.filter((p:any)=>{

    const emp = employees.find((e:any)=>e.id===p.employeeId)

    if(!emp) return false

    if(emp.status!=="Active") return false

    if(workingIds.has(emp.id)) return false

    return true

  })

  if(!eligible.length) return null

  return eligible[0]

}
import React,{useState,useEffect} from "react"

import LoginPage from "./modules/auth/LoginPage"

import Header from "./components/Header"
import SummaryCards from "./components/SummaryCards"
import ModuleTabs from "./components/ModuleTabs"

import { PatrolPage } from "./modules/patrol/PatrolPage"
import EmployeesPage from "./modules/employees/EmployeesPage"

import { getCurrentUser } from "./lib/auth"


export default function App(){

  const [user,setUser]=useState(null)

  const [activeModule,setActiveModule]=useState("patrol")

  const [employees,setEmployees]=useState([])


  useEffect(()=>{

    async function checkLogin(){

      const u = await getCurrentUser()

      if(u){
        setUser(u)
      }

    }

    checkLogin()

  },[])


  if(!user){

    return(
      <LoginPage onLogin={(u)=>setUser(u)}/>
    )

  }


  return(

    <div style={{padding:"20px"}}>

      <Header user={user}/>

      <SummaryCards/>

      <ModuleTabs
        active={activeModule}
        onChange={setActiveModule}
      />

      {activeModule==="patrol" && (
        <PatrolPage employees={employees}/>
      )}

      {activeModule==="employees" && (
        <EmployeesPage
          employees={employees}
          setEmployees={setEmployees}
        />
      )}

    </div>

  )

}
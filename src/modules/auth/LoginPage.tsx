import React,{useState} from "react"
import { signIn } from "../../lib/auth"

export default function LoginPage({onLogin}){

  const [email,setEmail]=useState("")
  const [password,setPassword]=useState("")

  async function handleLogin(){

    const res = await signIn(email,password)

    if(res?.user){
      onLogin(res.user)
    }

  }

  return(

    <div style={{
      width:"100%",
      height:"100vh",
      display:"flex",
      alignItems:"center",
      justifyContent:"center"
    }}>

      <div style={{width:"320px"}}>

        <h2>Scheduler Login</h2>

        <input
          placeholder="email"
          value={email}
          onChange={e=>setEmail(e.target.value)}
          style={{width:"100%",marginBottom:"10px"}}
        />

        <input
          type="password"
          placeholder="password"
          value={password}
          onChange={e=>setPassword(e.target.value)}
          style={{width:"100%",marginBottom:"10px"}}
        />

        <button onClick={handleLogin}>
          Login
        </button>

      </div>

    </div>

  )

}
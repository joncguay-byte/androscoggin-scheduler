import { supabase } from "./supabase"


export async function signIn(email:string,password:string){

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  })

  if(error){
    console.error(error)
  }

  return data

}


export async function signOut(){

  await supabase.auth.signOut()

}


export async function getCurrentUser(){

  const { data } = await supabase.auth.getUser()

  return data.user

}
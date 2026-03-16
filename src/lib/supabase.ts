import { createClient } from "@supabase/supabase-js"

const supabaseUrl = https://rtzysjfoekdgtqnqlili.supabase.co
const supabaseAnonKey = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ0enlzamZvZWtkZ3RxbnFsaWxpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2NzA4MjUsImV4cCI6MjA4OTI0NjgyNX0.8jjoZ98HO_oAoENbZmb5A2GMLH4BO1_yvUe5BPG3aw4

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
)
import { useState } from "react"
import type { ChangeEvent } from "react"
import { createLocalAccessSession, signIn } from "../../lib/auth"
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Select, SelectItem } from "../../components/ui/simple-ui"
import type { AppRole } from "../../types"

type LoginPageProps = {
  onLogin: (user: unknown) => void
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const [localRole, setLocalRole] = useState<AppRole>("admin")

  async function handleLogin() {
    setLoading(true)
    setMessage("")
    const result = await signIn(email.trim(), password)

    if (result.data?.user) {
      onLogin(result.data.user)
      setLoading(false)
      return
    }

    setMessage(result.error?.message || "Login failed. Check your email, password, and Supabase auth setup.")
    setLoading(false)
  }

  function handleLocalAccess() {
    const resolvedEmail = email.trim() || "local-access@androscoggin.local"
    const localUser = createLocalAccessSession(resolvedEmail, localRole)

    if (localUser) {
      onLogin(localUser)
      setMessage("")
    }
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>Androscoggin Patrol Schedule</CardTitle>
        </CardHeader>

        <CardContent>
          <div style={{ width: "340px", display: "grid", gap: "12px" }}>
            <div style={{ fontSize: "13px", color: "#475569" }}>
              Sign in with your Supabase account. Your role is pulled from auth metadata or your email naming pattern.
            </div>

            <Input
              placeholder="Email"
          value={email}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            />

            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            />

            <Button onClick={handleLogin} disabled={loading}>
              {loading ? "Signing In..." : "Sign In"}
            </Button>

            <div
              style={{
                border: "1px solid #fcd34d",
                borderRadius: "10px",
                padding: "10px",
                background: "#fffbeb",
                display: "grid",
                gap: "10px"
              }}
            >
              <div style={{ color: "#92400e", fontSize: "13px", fontWeight: 600 }}>
                If Supabase sign-in is giving you trouble, you can still get into the scheduler with local access.
              </div>

              <label>
                <div style={{ fontSize: "12px", fontWeight: 700, marginBottom: "4px", color: "#78350f" }}>
                  Local Role
                </div>
                <Select value={localRole} onValueChange={(value) => setLocalRole(value as AppRole)}>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="sergeant">Sergeant</SelectItem>
                  <SelectItem value="detective">Detective</SelectItem>
                  <SelectItem value="deputy">Deputy</SelectItem>
                </Select>
              </label>

              <Button onClick={handleLocalAccess}>
                Continue With Local Access
              </Button>
            </div>

            {message && (
              <div
                style={{
                  border: "1px solid #fecaca",
                  borderRadius: "10px",
                  padding: "10px",
                  background: "#fff7f7",
                  color: "#991b1b",
                  fontSize: "13px"
                }}
              >
                {message}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

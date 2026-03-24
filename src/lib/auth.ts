import { supabase } from "./supabase"
import type { AppRole } from "../types"

const LOCAL_ACCESS_SESSION_KEY = "androscoggin-local-access-user"
const ADMIN_EMAIL_OVERRIDES = new Set([
  "jon.c.guay@gmail.com"
])

type LocalAccessUser = {
  email: string
  user_metadata: Record<string, unknown>
  app_metadata: Record<string, unknown>
}

function buildLocalAccessUser(email: string, role: AppRole): LocalAccessUser {
  return {
    email,
    user_metadata: {
      full_name: "Local Access",
      role
    },
    app_metadata: {
      role,
      provider: "local-access"
    }
  }
}

export function getLocalAccessUser() {
  if (typeof window === "undefined") return null

  try {
    const raw = window.localStorage.getItem(LOCAL_ACCESS_SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as LocalAccessUser
  } catch {
    return null
  }
}

export function createLocalAccessSession(email: string, role: AppRole) {
  if (typeof window === "undefined") return null

  const user = buildLocalAccessUser(email, role)
  window.localStorage.setItem(LOCAL_ACCESS_SESSION_KEY, JSON.stringify(user))
  return user
}

export function clearLocalAccessSession() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(LOCAL_ACCESS_SESSION_KEY)
}

export async function signIn(email: string, password: string) {
  try {
    const result = await Promise.race([
      supabase.auth.signInWithPassword({
        email,
        password
      }),
      new Promise<{ data: null, error: { message: string } }>((resolve) =>
        window.setTimeout(
          () => resolve({ data: null, error: { message: "Sign-in timed out. Please try again." } }),
          8000
        )
      )
    ])

    if (result.error) {
      console.error(result.error)
    } else if (result.data?.user) {
      clearLocalAccessSession()
    }

    return result
  } catch (error) {
    console.error(error)
    return {
      data: null,
      error: {
        message: error instanceof Error ? error.message : "Sign-in failed."
      }
    }
  }
}


export async function signOut(){
  clearLocalAccessSession()
  await supabase.auth.signOut()

}


export async function getCurrentUser(){

  const { data } = await supabase.auth.getUser()

  return data.user

}

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => resolve(fallback), timeoutMs)

    Promise.resolve(promise)
      .then((value) => {
        window.clearTimeout(timeoutId)
        resolve(value)
      })
      .catch(() => {
        window.clearTimeout(timeoutId)
        resolve(fallback)
      })
  })
}

export async function getCurrentProfileRole(userId?: string | null, email?: string | null) {
  const resolvedUserId =
    userId ||
    (await withTimeout(
      supabase.auth.getUser().then(({ data }) => data.user?.id || null),
      6000,
      null
    ))

  try {
    const queries = []

    if (resolvedUserId) {
      queries.push(
        Promise.race([
          supabase
            .from("profiles")
            .select("role")
            .eq("id", resolvedUserId)
            .maybeSingle(),
          new Promise<{ data: null, error: null }>((resolve) =>
            window.setTimeout(() => resolve({ data: null, error: null }), 10000)
          )
        ])
      )
    }

    if (email) {
      queries.push(
        Promise.race([
          supabase
            .from("profiles")
            .select("role")
            .eq("email", email)
            .maybeSingle(),
          new Promise<{ data: null, error: null }>((resolve) =>
            window.setTimeout(() => resolve({ data: null, error: null }), 10000)
          )
        ])
      )
    }

    for (const query of queries) {
      const result = await query
      const { data, error } = result

      if (error) {
        continue
      }

      const role = data?.role
      if (
        role === "admin" ||
        role === "sergeant" ||
        role === "detective" ||
        role === "deputy"
      ) {
        return role as AppRole
      }
    }
  } catch {
    return null
  }

  return null
}

export function resolveAppRole(user: {
  email?: string | null
  user_metadata?: Record<string, unknown> | null
  app_metadata?: Record<string, unknown> | null
} | null | undefined): AppRole {
  const email = user?.email?.toLowerCase() || ""

  if (ADMIN_EMAIL_OVERRIDES.has(email)) return "admin"

  const metadataRole = user?.app_metadata?.role || user?.user_metadata?.role

  if (typeof metadataRole === "string") {
    const normalizedRole = metadataRole.toLowerCase()

    if (
      normalizedRole === "admin" ||
      normalizedRole === "sergeant" ||
      normalizedRole === "detective" ||
      normalizedRole === "deputy"
    ) {
      return normalizedRole
    }

    if (normalizedRole === "sgt") return "sergeant"
  }

  if (email.includes("admin")) return "admin"
  if (email.includes("sgt") || email.includes("sergeant")) return "sergeant"
  if (email.includes("detective") || email.includes("cid")) return "detective"

  return "deputy"
}

export function resolveDisplayName(user: {
  email?: string | null
  user_metadata?: Record<string, unknown> | null
} | null | undefined) {
  const fullName = user?.user_metadata?.full_name
  const firstName = user?.user_metadata?.first_name
  const lastName = user?.user_metadata?.last_name

  if (typeof fullName === "string" && fullName.trim()) {
    return fullName.trim()
  }

  if (typeof firstName === "string" && typeof lastName === "string") {
    return `${firstName} ${lastName}`.trim()
  }

  if (typeof firstName === "string" && firstName.trim()) {
    return firstName.trim()
  }

  return user?.email || "Signed In User"
}

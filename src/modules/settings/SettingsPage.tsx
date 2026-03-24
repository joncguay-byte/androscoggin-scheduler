import { useEffect, useState } from "react"
import type { Dispatch, SetStateAction } from "react"
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectItem
} from "../../components/ui/simple-ui"
import { supabase } from "../../lib/supabase"
import type { AppLayoutVariant, AppRole, ReportType, ScheduleView } from "../../types"

type ModuleOption = {
  key: string
  label: string
}

export type AppSettings = {
  departmentTitle: string
  defaultLayoutVariant: AppLayoutVariant
  defaultPatrolView: ScheduleView
  defaultReportType: ReportType
  printHeaderTitle: string
  visibleModules: string[]
  useCustomColors: boolean
  colors: {
    accent: string
    border: string
    cardBackground: string
    cardBorder: string
    cellBackground: string
    cellHighlight: string
  }
}

export type ReferenceSettings = {
  vehicles: string[]
  shiftTemplates: string[]
  teams: string[]
  ranks: string[]
  patrolStatuses: string[]
}

type SettingsPageProps = {
  currentUserRole: AppRole
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  referenceSettings: ReferenceSettings
  setReferenceSettings: Dispatch<SetStateAction<ReferenceSettings>>
  cidRotationStartDate: string
  setCidRotationStartDate: (date: string) => void
  moduleOptions: ModuleOption[]
  onRepairOvertimeFromPatrol?: () => void
  onRebuildQueuesBySeniority?: () => void
  onClearPatrolOverrideCache?: () => void
  onAuditEvent?: (action: string, summary: string, details?: string) => void
}

type UserProfile = {
  id: string
  email: string | null
  full_name: string | null
  role: AppRole
  created_at?: string
}

const layoutOptions: { value: AppLayoutVariant, label: string }[] = [
  { value: "command-brass", label: "Command Brass" },
  { value: "ops-strip", label: "Operations Strip" },
  { value: "clean-ledger", label: "Clean Ledger" }
]

const patrolViewOptions: { value: ScheduleView, label: string }[] = [
  { value: "month", label: "Month" },
  { value: "two_week", label: "2 Week" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" }
]

const reportOptions: { value: ReportType, label: string }[] = [
  { value: "overtime", label: "Overtime Totals" },
  { value: "team_overtime", label: "Team Overtime" },
  { value: "employee_overtime", label: "Individual Overtime" },
  { value: "detail_hours", label: "Detail Hours" },
  { value: "force_summary", label: "Force Summary" },
  { value: "force_history", label: "Force History" },
  { value: "force_individual", label: "Force By Employee" },
  { value: "cid_on_call", label: "CID On-Call" },
  { value: "patrol_staffing", label: "Patrol Staffing" }
]

const referenceLabels: Record<keyof ReferenceSettings, string> = {
  vehicles: "Vehicles",
  shiftTemplates: "Shift Templates",
  teams: "Teams",
  ranks: "Ranks",
  patrolStatuses: "Patrol Statuses"
}

export function SettingsPage({
  currentUserRole,
  settings,
  setSettings,
  referenceSettings,
  setReferenceSettings,
  cidRotationStartDate,
  setCidRotationStartDate,
  moduleOptions,
  onRepairOvertimeFromPatrol,
  onRebuildQueuesBySeniority,
  onClearPatrolOverrideCache,
  onAuditEvent
}: SettingsPageProps) {
  const canEdit = currentUserRole === "admin" || currentUserRole === "sergeant"
  const [drafts, setDrafts] = useState<Record<keyof ReferenceSettings, string>>({
    vehicles: "",
    shiftTemplates: "",
    teams: "",
    ranks: "",
    patrolStatuses: ""
  })
  const [profiles, setProfiles] = useState<UserProfile[]>([])
  const [profilesLoading, setProfilesLoading] = useState(true)
  const [profilesError, setProfilesError] = useState("")
  const [savingProfileId, setSavingProfileId] = useState("")

  useEffect(() => {
    let active = true

    async function loadProfiles() {
      setProfilesLoading(true)
      setProfilesError("")

      const { data, error } = await supabase
        .from("profiles")
        .select("id,email,full_name,role,created_at")
        .order("email", { ascending: true })

      if (!active) return

      if (error) {
        setProfilesError("Profiles table is not available yet. Run the Supabase auth/RLS SQL setup first.")
        setProfilesLoading(false)
        return
      }

      setProfiles((data || []) as UserProfile[])
      setProfilesLoading(false)
    }

    if (canEdit) {
      void loadProfiles()
    } else {
      setProfilesLoading(false)
    }

    return () => {
      active = false
    }
  }, [canEdit])

  function updateSettings<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    const previousValue = settings[key]
    setSettings((current) => ({
      ...current,
      [key]: value
    }))
    onAuditEvent?.(
      "Settings Updated",
      `Updated ${String(key)} in global settings.`,
      `Previous: ${JSON.stringify(previousValue)} | Next: ${JSON.stringify(value)}`
    )
  }

  function toggleModule(moduleKey: string) {
    if (moduleKey === "settings") return

    setSettings((current) => {
      const visibleModules = current.visibleModules.includes(moduleKey)
        ? current.visibleModules.filter((key) => key !== moduleKey)
        : [...current.visibleModules, moduleKey]

      return {
        ...current,
        visibleModules: [...new Set([...visibleModules, "settings"])]
      }
    })
    onAuditEvent?.(
      "Module Visibility Changed",
      `${settings.visibleModules.includes(moduleKey) ? "Hid" : "Showed"} ${moduleKey} in module tabs.`,
      `Visible modules now include: ${settings.visibleModules.includes(moduleKey)
        ? settings.visibleModules.filter((key) => key !== moduleKey).join(", ")
        : [...new Set([...settings.visibleModules, moduleKey, "settings"])].join(", ")}`
    )
  }

  function updateDraft<K extends keyof ReferenceSettings>(key: K, value: string) {
    setDrafts((current) => ({
      ...current,
      [key]: value
    }))
  }

  function addReferenceValue<K extends keyof ReferenceSettings>(key: K) {
    const nextValue = drafts[key].trim()
    if (!nextValue) return

    setReferenceSettings((current) => ({
      ...current,
      [key]: current[key].includes(nextValue)
        ? current[key]
        : [...current[key], nextValue]
    }))

    setDrafts((current) => ({
      ...current,
      [key]: ""
    }))
    onAuditEvent?.(
      "Reference Added",
      `Added ${nextValue} to ${referenceLabels[key]}.`
    )
  }

  function removeReferenceValue<K extends keyof ReferenceSettings>(key: K, value: string) {
    setReferenceSettings((current) => ({
      ...current,
      [key]: current[key].filter((item) => item !== value)
    }))
    onAuditEvent?.(
      "Reference Removed",
      `Removed ${value} from ${referenceLabels[key]}.`
    )
  }

  async function refreshProfiles() {
    setProfilesLoading(true)
    setProfilesError("")

    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,full_name,role,created_at")
      .order("email", { ascending: true })

    if (error) {
      setProfilesError("Profiles table is not available yet. Run the Supabase auth/RLS SQL setup first.")
      setProfilesLoading(false)
      return
    }

    setProfiles((data || []) as UserProfile[])
    setProfilesLoading(false)
  }

  async function updateProfileRole(profileId: string, nextRole: AppRole) {
    const profile = profiles.find((row) => row.id === profileId)
    if (!profile || profile.role === nextRole) return

    setSavingProfileId(profileId)
    const previousRole = profile.role

    const { error } = await supabase
      .from("profiles")
      .update({ role: nextRole })
      .eq("id", profileId)

    if (error) {
      setProfilesError("Could not update profile role. Confirm RLS policies and authenticated access are set up in Supabase.")
      setSavingProfileId("")
      return
    }

    setProfiles((current) =>
      current.map((row) =>
        row.id === profileId
          ? { ...row, role: nextRole }
          : row
      )
    )
    onAuditEvent?.(
      "User Role Updated",
      `Changed ${profile.full_name || profile.email || "user"} from ${previousRole} to ${nextRole}.`
    )
    setSavingProfileId("")
  }

  return (
    <div style={{ display: "grid", gap: "18px" }}>
      <Card>
        <CardHeader>
          <CardTitle>Global Settings</CardTitle>
        </CardHeader>

        <CardContent>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: "12px" }}>
            <label>
              <div style={{ fontWeight: 700, marginBottom: "4px" }}>Department Title</div>
              <Input
                value={settings.departmentTitle}
                onChange={(event) => updateSettings("departmentTitle", event.target.value)}
                disabled={!canEdit}
              />
            </label>

            <label>
              <div style={{ fontWeight: 700, marginBottom: "4px" }}>Default Command View</div>
              <Select
                value={settings.defaultLayoutVariant}
                onValueChange={(value) => updateSettings("defaultLayoutVariant", value as AppLayoutVariant)}
              >
                {layoutOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </Select>
            </label>

            <label>
              <div style={{ fontWeight: 700, marginBottom: "4px" }}>Print Header Title</div>
              <Input
                value={settings.printHeaderTitle}
                onChange={(event) => updateSettings("printHeaderTitle", event.target.value)}
                disabled={!canEdit}
              />
            </label>
          </div>

          <div style={{ marginTop: "14px", fontSize: "13px", color: "#475569" }}>
            These settings are global for the shared app and stay local for now. Once you are happy with them, we can move this whole section into Supabase.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Color Controls</CardTitle>
        </CardHeader>

        <CardContent>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              marginBottom: "14px",
              padding: "10px 12px",
              border: "1px solid #e2e8f0",
              borderRadius: "10px",
              background: settings.useCustomColors ? "#f8fbff" : "#ffffff"
            }}
          >
            <span style={{ fontWeight: 700 }}>Enable Custom Colors</span>
            <input
              type="checkbox"
              checked={settings.useCustomColors}
              disabled={!canEdit}
              onChange={(event) => updateSettings("useCustomColors", event.target.checked)}
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "12px" }}>
            {([
              { key: "accent", label: "Accent Color" },
              { key: "border", label: "Main Border" },
              { key: "cardBackground", label: "Card Background" },
              { key: "cardBorder", label: "Card Border" },
              { key: "cellBackground", label: "Cell Background" },
              { key: "cellHighlight", label: "Cell Highlight" }
            ] as const).map((colorField) => (
              <label key={colorField.key}>
                <div style={{ fontWeight: 700, marginBottom: "4px" }}>{colorField.label}</div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    type="color"
                    value={settings.colors[colorField.key]}
                    disabled={!canEdit || !settings.useCustomColors}
                    onChange={(event) =>
                      updateSettings("colors", {
                        ...settings.colors,
                        [colorField.key]: event.target.value
                      })
                    }
                    style={{ width: "52px", height: "40px", border: "1px solid #cbd5e1", borderRadius: "8px" }}
                  />
                  <Input
                    value={settings.colors[colorField.key]}
                    disabled={!canEdit || !settings.useCustomColors}
                    onChange={(event) =>
                      updateSettings("colors", {
                        ...settings.colors,
                        [colorField.key]: event.target.value
                      })
                    }
                  />
                </div>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: "18px" }}>
        <Card>
          <CardHeader>
            <CardTitle>Scheduling And Reports Defaults</CardTitle>
          </CardHeader>

          <CardContent>
            <div style={{ display: "grid", gap: "12px" }}>
              <label>
                <div style={{ fontWeight: 700, marginBottom: "4px" }}>CID Rotation Start</div>
                <Input
                  type="date"
                  value={cidRotationStartDate}
                  onChange={(event) => {
                    setCidRotationStartDate(event.target.value)
                    onAuditEvent?.(
                      "CID Rotation Start Changed",
                      `Changed CID rotation start date to ${event.target.value} from Settings.`,
                      `Previous start date: ${cidRotationStartDate}`
                    )
                  }}
                  disabled={!canEdit}
                />
              </label>

              <label>
                <div style={{ fontWeight: 700, marginBottom: "4px" }}>Default Patrol View</div>
                <Select
                  value={settings.defaultPatrolView}
                  onValueChange={(value) => updateSettings("defaultPatrolView", value as ScheduleView)}
                >
                  {patrolViewOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </Select>
              </label>

              <label>
                <div style={{ fontWeight: 700, marginBottom: "4px" }}>Default Reports View</div>
                <Select
                  value={settings.defaultReportType}
                  onValueChange={(value) => updateSettings("defaultReportType", value as ReportType)}
                >
                  {reportOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </Select>
              </label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Visible Modules</CardTitle>
          </CardHeader>

          <CardContent>
            <div style={{ display: "grid", gap: "10px" }}>
              {moduleOptions.map((module) => {
                const isVisible = settings.visibleModules.includes(module.key)
                const isLocked = module.key === "settings"

                return (
                  <label
                    key={module.key}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "12px",
                      padding: "10px 12px",
                      border: "1px solid #e2e8f0",
                      borderRadius: "10px",
                      background: isVisible ? "#f8fbff" : "#ffffff"
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>{module.label}</span>
                    <input
                      type="checkbox"
                      checked={isVisible}
                      disabled={!canEdit || isLocked}
                      onChange={() => toggleModule(module.key)}
                    />
                  </label>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reference Data Manager</CardTitle>
        </CardHeader>

        <CardContent>
          <div style={{ fontSize: "13px", color: "#475569", marginBottom: "14px" }}>
            This gives you one place to manage local reference lists for vehicles, shift templates, teams, ranks, and patrol statuses while we work out the final structure.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px" }}>
            {(Object.keys(referenceSettings) as Array<keyof ReferenceSettings>).map((key) => (
              <div
                key={key}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "12px",
                  padding: "14px",
                  background: "#ffffff"
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: "10px" }}>{referenceLabels[key]}</div>

                <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                  <Input
                    value={drafts[key]}
                    onChange={(event) => updateDraft(key, event.target.value)}
                    disabled={!canEdit}
                    placeholder={`Add ${referenceLabels[key].slice(0, -1)}`}
                  />
                  <Button disabled={!canEdit} onClick={() => addReferenceValue(key)}>
                    Add
                  </Button>
                </div>

                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {referenceSettings[key].map((value) => (
                    <div
                      key={value}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        border: "1px solid #dbeafe",
                        borderRadius: "999px",
                        padding: "6px 10px",
                        background: "#f8fbff"
                      }}
                    >
                      <span>{value}</span>
                      {canEdit && (
                        <button
                          onClick={() => removeReferenceValue(key, value)}
                          style={{
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            color: "#991b1b",
                            fontWeight: 700
                          }}
                        >
                          x
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Admin Repair Tools</CardTitle>
        </CardHeader>

        <CardContent>
          <div style={{ fontSize: "13px", color: "#475569", marginBottom: "14px" }}>
            Use these when Patrol, Overtime, or queue order gets out of sync. They are meant to repair stuck local state without rebuilding the whole app by hand.
          </div>

          {!canEdit && (
            <div style={{ fontSize: "13px", color: "#64748b" }}>
              Read-only. Only admins and sergeants can run repair tools.
            </div>
          )}

          {canEdit && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "12px" }}>
              <button
                onClick={() => onRepairOvertimeFromPatrol?.()}
                style={{
                  border: "1px solid #cbd5e1",
                  borderRadius: "12px",
                  background: "#ffffff",
                  padding: "14px",
                  textAlign: "left",
                  cursor: "pointer"
                }}
              >
                <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: "6px" }}>
                  Resync Overtime From Patrol
                </div>
                <div style={{ fontSize: "12px", color: "#475569", lineHeight: 1.35 }}>
                  Removes stale Patrol-generated overtime shifts and realigns saved replacements with the Patrol override rows.
                </div>
              </button>

              <button
                onClick={() => onRebuildQueuesBySeniority?.()}
                style={{
                  border: "1px solid #cbd5e1",
                  borderRadius: "12px",
                  background: "#ffffff",
                  padding: "14px",
                  textAlign: "left",
                  cursor: "pointer"
                }}
              >
                <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: "6px" }}>
                  Rebuild Queues By Seniority
                </div>
                <div style={{ fontSize: "12px", color: "#475569", lineHeight: 1.35 }}>
                  Reorders the Detail and Overtime lists so the longest-serving active employee is back at the top.
                </div>
              </button>

              <button
                onClick={() => onClearPatrolOverrideCache?.()}
                style={{
                  border: "1px solid #cbd5e1",
                  borderRadius: "12px",
                  background: "#ffffff",
                  padding: "14px",
                  textAlign: "left",
                  cursor: "pointer"
                }}
              >
                <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: "6px" }}>
                  Clear Local Patrol Overrides
                </div>
                <div style={{ fontSize: "12px", color: "#475569", lineHeight: 1.35 }}>
                  Clears locally saved Patrol override rows when a replacement, off-status, or yellow highlight gets stuck on screen.
                </div>
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <CardTitle>User Access</CardTitle>
            <Button onClick={() => void refreshProfiles()} disabled={!canEdit || profilesLoading}>
              {profilesLoading ? "Loading..." : "Refresh Users"}
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          <div style={{ fontSize: "13px", color: "#475569", marginBottom: "14px" }}>
            Use this to review authenticated users and assign their scheduler role from the `profiles` table in Supabase.
          </div>

          {profilesError && (
            <div
              style={{
                marginBottom: "14px",
                border: "1px solid #fcd34d",
                borderRadius: "10px",
                padding: "10px 12px",
                background: "#fffbeb",
                color: "#92400e",
                fontSize: "13px"
              }}
            >
              {profilesError}
            </div>
          )}

          {!canEdit && (
            <div style={{ fontSize: "13px", color: "#64748b" }}>
              Read-only. Only admins and sergeants can manage user access.
            </div>
          )}

          {canEdit && !profilesLoading && profiles.length === 0 && !profilesError && (
            <div style={{ fontSize: "13px", color: "#64748b" }}>
              No user profiles found yet. Create users in Supabase Auth first, then refresh this section.
            </div>
          )}

          {canEdit && profiles.length > 0 && (
            <div style={{ display: "grid", gap: "10px" }}>
              {profiles.map((profile) => (
                <div
                  key={profile.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.5fr 1fr 180px",
                    gap: "12px",
                    alignItems: "center",
                    border: "1px solid #e2e8f0",
                    borderRadius: "12px",
                    padding: "12px",
                    background: "#ffffff"
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      {profile.full_name || "Unnamed User"}
                    </div>
                    <div style={{ fontSize: "13px", color: "#475569", marginTop: "4px" }}>
                      {profile.email || "No email on file"}
                    </div>
                  </div>

                  <div style={{ fontSize: "13px", color: "#475569" }}>
                    Current role: <strong>{profile.role}</strong>
                  </div>

                  <Select
                    value={profile.role}
                    onValueChange={(value) => void updateProfileRole(profile.id, value as AppRole)}
                  >
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="sergeant">Sergeant</SelectItem>
                    <SelectItem value="detective">Detective</SelectItem>
                    <SelectItem value="deputy">Deputy</SelectItem>
                  </Select>

                  {savingProfileId === profile.id && (
                    <div style={{ gridColumn: "1 / -1", fontSize: "12px", color: "#1d4ed8", fontWeight: 700 }}>
                      Saving role update...
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

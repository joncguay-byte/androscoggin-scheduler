# Androscoggin Patrol Schedule

Operational scheduling app for Patrol, CID, Force, Detail, Reports, Command, Audit, Employees, and Settings.

## Local Development

```bash
npm install
npm run dev
```

Create a local env file before running against your own Supabase project:

```bash
cp .env.example .env
```

Set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Deploying To A Real Website

The easiest production path is `Vercel` or `Netlify`.

### Vercel

1. Push this `scheduler` folder to GitHub.
2. In Vercel, click `Add New Project`.
3. Import the GitHub repo.
4. Keep the default Vite build settings:
   - Build command: `npm run build`
   - Output directory: `dist`
5. Add these environment variables in the Vercel project settings:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
6. Deploy.

The included [vercel.json](./vercel.json) is already set up for this app.

### Netlify

1. Push this `scheduler` folder to GitHub.
2. In Netlify, choose `Add new site` -> `Import an existing project`.
3. Import the GitHub repo.
4. Use:
   - Build command: `npm run build`
   - Publish directory: `dist`
5. Add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
6. Deploy.

The included [netlify.toml](./netlify.toml) is already set up for this app.

### Important

- Use the Supabase `anon` key, not the service role key.
- Once deployed, you will sign in through the live site URL instead of `localhost`.
- If you want a custom web address later, connect your own domain in Vercel or Netlify after the first successful deploy.

## Supabase Setup

The app already uses Supabase for Patrol and Force, and it now supports:

- email/password sign-in
- role resolution from `profiles.role`
- shared app-state sync through `public.app_state`
- shared Patrol/Overtime override sync through `public.patrol_overrides`
- real-table sync for overtime queue, overtime shifts, overtime entries, and notifications
- split shared app-state sync domains for staff/settings, CID/detail, and audit
- backend row-level security scaffolding

Run these SQL files in your Supabase SQL editor:

1. [supabase/app_state_schema.sql](./supabase/app_state_schema.sql)
2. [supabase/auth_and_rls_setup.sql](./supabase/auth_and_rls_setup.sql)

## Auth Roles

Supported roles:

- `admin`
- `sergeant`
- `detective`
- `deputy`

The app now prefers `public.profiles.role` for permissions. If that profile row is missing, it falls back to auth metadata and then to email pattern matching.

## Creating Users

Create users in the Supabase dashboard under Authentication.

After creating a user, set either:

- `app_metadata.role`, or
- `user_metadata.role`

Recommended approach:

1. Create the user in Supabase Auth.
2. Let the trigger create the matching row in `public.profiles`.
3. Update `public.profiles.role` to the right value.

Example:

```sql
update public.profiles
set role = 'sergeant',
    full_name = 'Moe Drouin'
where email = 'moe.drouin@example.com';
```

## Security Notes

The SQL setup file enables RLS and adds backend policies for:

- `profiles`
- `app_state`
- `patrol_schedule`
- `patrol_overrides`
- `overtime_queue`
- `overtime_shift_requests`
- `overtime_entries`
- `notification_preferences`
- `notification_campaigns`
- `notification_deliveries`
- `notification_provider_config`
- `force_history`
- `audit_log`

Admins and sergeants get write access where operational edits are needed. Authenticated users get read access where the scheduler needs visibility.

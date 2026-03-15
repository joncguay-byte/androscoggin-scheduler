import React from "react";

export default function Header({ user, onRoleChange }) {
  return (
    <div className="rounded-3xl bg-slate-950 px-6 py-6 text-white shadow-xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-sm font-medium uppercase tracking-[0.2em] text-amber-300">
            Androscoggin Sheriff's Office
          </div>

          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Androscoggin Patrol Schedule
          </h1>

          <p className="mt-2 text-sm text-slate-300">
            Professional modular scheduling system
          </p>
        </div>

        <div className="flex items-center gap-3 self-start rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-400 font-semibold text-slate-950">
            {user.username.slice(0,2).toUpperCase()}
          </div>

          <div>
            <div className="text-sm font-medium">{user.username}</div>
            <div className="text-xs text-slate-400">
              Signed in as {user.role}
            </div>
          </div>

          <select
            value={user.role}
            onChange={(e)=>onRoleChange(e.target.value)}
            style={{marginLeft:10,padding:6}}
          >
            <option>Admin</option>
            <option>Sergeant</option>
            <option>Detective</option>
            <option>Deputy</option>
          </select>
        </div>
      </div>
    </div>
  );
}
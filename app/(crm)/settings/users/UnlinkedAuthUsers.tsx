"use client";

import { useActionState } from "react";
import { IDLE, linkAuthUserAction, type UserActionState } from "./actions";
import type { UnlinkedAuthUser } from "@/lib/data/users";

/**
 * Supabase Auth users without a CRM profile (spec §F/§37). Lets an admin grant
 * a role, which creates + links a `crm_users` row server-side. Until linked, an
 * Auth user has no CRM access — this surfaces them so nobody is silently locked
 * out or invisible.
 */
function LinkRow({ authUser }: { authUser: UnlinkedAuthUser }) {
  const [state, action, pending] = useActionState<UserActionState, FormData>(linkAuthUserAction, IDLE);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 border-b border-line-faint py-2.5 last:border-0">
      <input type="hidden" name="authUserId" value={authUser.authUserId} />
      <input type="hidden" name="email" value={authUser.email} />
      <div className="min-w-[220px] flex-1">
        <div className="text-[13px] font-semibold text-ink-900">{authUser.email}</div>
        <div className="font-mono text-[10.5px] text-ink-400">{authUser.authUserId}</div>
      </div>
      <select
        name="role"
        defaultValue="moderator"
        className="h-[32px] rounded-control border border-line bg-panel px-2 text-[12px] capitalize text-ink-700 outline-none focus:border-primary"
      >
        <option value="moderator">Moderator</option>
        <option value="auditor">Auditor</option>
        <option value="admin">Admin</option>
      </select>
      <button
        type="submit"
        disabled={pending}
        className="h-[32px] rounded-control bg-primary px-3 text-[12px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create profile"}
      </button>
      {state.error && <span className="text-[11px] font-semibold text-red-600">{state.error}</span>}
      {state.ok && <span className="text-[11px] font-semibold text-emerald-600">{state.ok}</span>}
    </form>
  );
}

export function UnlinkedAuthUsers({ users }: { users: UnlinkedAuthUser[] }) {
  if (users.length === 0) return null;
  return (
    <div className="mt-4">
      <div className="mb-1 text-[12px] font-bold uppercase tracking-wide text-ink-500">
        Supabase Auth users without a CRM profile ({users.length})
      </div>
      <p className="mb-2 text-[11.5px] text-ink-400">
        These accounts exist in Authentication but have no CRM access yet. Grant a role to create and link a profile.
      </p>
      <div className="rounded-card border border-line-soft bg-panel px-4 py-1">
        {users.map((u) => (
          <LinkRow key={u.authUserId} authUser={u} />
        ))}
      </div>
    </div>
  );
}

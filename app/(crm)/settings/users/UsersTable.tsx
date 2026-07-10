"use client";

import { useActionState, useState } from "react";
import type { Role } from "@/lib/types";
import { ASSIGNABLE_ROLES } from "@/lib/auth/roles";
import { changeRoleAction, setActiveAction, type UserActionState } from "./actions";

const IDLE: UserActionState = { error: null, ok: null };

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  dbRole: string | null;
  isActive: boolean;
  linkedToAuth: boolean;
}

const ROLE_STYLE: Record<string, string> = {
  admin: "bg-badge-indigo/10 text-badge-indigo",
  auditor: "bg-badge-blue/10 text-badge-blue",
  moderator: "bg-success/10 text-success",
  viewer: "bg-line-faint text-ink-600",
};

function RoleChip({ role, dbRole }: { role: Role; dbRole: string | null }) {
  // Surface `owner_admin` explicitly: it reads as "admin" everywhere else, and
  // an operator deserves to know which account is the owner.
  const label = dbRole === "owner_admin" ? "owner admin" : role;
  return (
    <span
      className={`rounded-pill px-2 py-0.5 text-[11px] font-semibold capitalize ${ROLE_STYLE[role] ?? ROLE_STYLE.viewer}`}
    >
      {label}
    </span>
  );
}

/** Inline confirm + reason capture. Every mutation is audited, so we ask why. */
function ReasonPrompt({
  title,
  confirmLabel,
  danger,
  onCancel,
  children,
}: {
  title: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="mt-2 rounded-control border border-line bg-canvas p-3">
      <div className="text-[12px] font-semibold text-ink-900">{title}</div>
      {children}
      <label className="mt-2 block">
        <span className="sr-only">Reason</span>
        <input
          name="reason"
          placeholder="Reason (recorded in the audit log)"
          className="w-full rounded-control border border-line bg-panel px-2.5 py-1.5 text-[12px] text-ink-900 outline-none focus:border-primary"
        />
      </label>
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          className={`rounded-control px-2.5 py-1.5 text-[11.5px] font-semibold text-white ${
            danger ? "bg-danger hover:opacity-90" : "bg-primary hover:bg-primary-hover"
          }`}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-control border border-line px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-700 hover:bg-panel"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Feedback({ error, ok }: { error: string | null; ok: string | null }) {
  if (!error && !ok) return null;
  return (
    <p
      role="alert"
      className={`mt-2 rounded-control px-2.5 py-1.5 text-[11.5px] font-medium ${
        error ? "bg-danger-bg text-danger" : "bg-success/10 text-success"
      }`}
    >
      {error ?? ok}
    </p>
  );
}

function UserCard({
  user,
  isSelf,
  canMutate,
}: {
  user: UserRow;
  isSelf: boolean;
  canMutate: boolean;
}) {
  const [roleState, roleAction] = useActionState(changeRoleAction, IDLE);
  const [activeState, activeAction] = useActionState(setActiveAction, IDLE);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [confirmingActive, setConfirmingActive] = useState(false);

  return (
    <li className="border-b border-line-soft px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-ink-900">{user.name}</span>
            {isSelf && (
              <span className="rounded-pill bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                you
              </span>
            )}
            {!user.linkedToAuth && (
              <span
                title="This profile has no Supabase Auth account linked, so nobody can sign in as them."
                className="rounded-pill bg-warn/10 px-1.5 py-0.5 text-[10px] font-semibold text-warn"
              >
                no sign-in
              </span>
            )}
          </div>
          <div className="truncate text-[11.5px] text-ink-500">{user.email}</div>
        </div>

        <RoleChip role={user.role} dbRole={user.dbRole} />

        <span
          className={`rounded-pill px-2 py-0.5 text-[11px] font-semibold ${
            user.isActive ? "bg-success/10 text-success" : "bg-line-faint text-ink-500"
          }`}
        >
          {user.isActive ? "Active" : "Inactive"}
        </span>

        <div className="flex items-center gap-2">
          {canMutate && (
            <>
              <label className="sr-only" htmlFor={`role-${user.id}`}>
                Change role for {user.name}
              </label>
              <select
                id={`role-${user.id}`}
                value={editingRole ?? user.role}
                onChange={(e) => {
                  const next = e.target.value as Role;
                  setEditingRole(next === user.role ? null : next);
                }}
                className="rounded-control border border-line bg-panel px-2 py-1.5 text-[11.5px] font-medium capitalize text-ink-700 outline-none focus:border-primary"
              >
                {/* The current role stays selectable even when it isn't assignable
                    (e.g. viewer / doctor), so the select never lies about state. */}
                {!ASSIGNABLE_ROLES.includes(user.role) && (
                  <option value={user.role}>{user.role}</option>
                )}
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setConfirmingActive((v) => !v)}
                className="rounded-control border border-line px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-700 hover:bg-canvas"
              >
                {user.isActive ? "Deactivate" : "Activate"}
              </button>
            </>
          )}

          <a
            href={`/settings/users/${user.id}`}
            className="rounded-control px-2 py-1.5 text-[11.5px] font-semibold text-primary hover:underline"
          >
            History
          </a>
        </div>
      </div>

      {editingRole && (
        <form action={roleAction}>
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="role" value={editingRole} />
          <ReasonPrompt
            title={`Change ${user.name}'s role from ${user.role} to ${editingRole}?`}
            confirmLabel="Change role"
            onCancel={() => setEditingRole(null)}
          />
        </form>
      )}
      <Feedback error={roleState.error} ok={roleState.ok} />

      {confirmingActive && (
        <form action={activeAction}>
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="active" value={String(!user.isActive)} />
          <ReasonPrompt
            title={
              user.isActive
                ? `Deactivate ${user.name}? They will be signed out on their next request.`
                : `Reactivate ${user.name}?`
            }
            confirmLabel={user.isActive ? "Deactivate" : "Activate"}
            danger={user.isActive}
            onCancel={() => setConfirmingActive(false)}
          />
        </form>
      )}
      <Feedback error={activeState.error} ok={activeState.ok} />
    </li>
  );
}

export function UsersTable({
  users,
  currentUserId,
  canMutate,
}: {
  users: UserRow[];
  currentUserId: string;
  canMutate: boolean;
}) {
  if (users.length === 0) {
    return <p className="px-4 py-6 text-[12.5px] text-ink-500">No users match these filters.</p>;
  }
  return (
    <ul>
      {users.map((u) => (
        <UserCard
          key={u.id}
          user={u}
          isSelf={u.id === currentUserId}
          canMutate={canMutate}
        />
      ))}
    </ul>
  );
}

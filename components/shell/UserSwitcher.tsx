"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { Role } from "@/lib/types";
import { USER_COOKIE } from "@/lib/data/userCookie";
import { signOut } from "@/app/login/actions";

/** The subset of a CRM account this footer needs. */
export interface SwitchableUser {
  id: string;
  name: string;
  role: Role;
  initials: string;
}

/**
 * Sidebar footer: who you are signed in as, and a way out.
 *
 * When `canImpersonate` is true (admin + `CRM_DEV_IMPERSONATION=1`) it also
 * offers a preview switcher that writes {@link USER_COOKIE} and refreshes, so
 * server components re-render as the chosen account — e.g. pick the auditor to
 * reveal the Auditor / Reports nav. The cookie is advisory only: the server
 * re-checks the real signed-in role before honouring it, so it can never
 * escalate privileges.
 */
export function UserSwitcher({
  current,
  accounts,
  canImpersonate,
  impersonating,
}: {
  current: SwitchableUser;
  accounts: SwitchableUser[];
  canImpersonate: boolean;
  impersonating: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function switchTo(id: string) {
    document.cookie = `${USER_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <div className="border-t border-line-soft px-2 pt-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-primary-avatar text-[11px] font-bold text-primary">
          {current.initials}
        </span>

        <div className="min-w-0 flex-1">
          {canImpersonate ? (
            <label>
              <span className="sr-only">Preview the app as another user</span>
              <select
                value={current.id}
                disabled={pending}
                onChange={(e) => switchTo(e.target.value)}
                className="w-full cursor-pointer truncate bg-transparent text-[11.5px] font-semibold text-ink-700 outline-none"
              >
                {accounts.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {u.role}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="truncate text-[11.5px] font-semibold text-ink-700">{current.name}</div>
          )}

          <span className="block text-[10.5px] font-normal capitalize text-ink-400">
            {impersonating ? `${current.role} · previewing` : current.role}
          </span>
        </div>

        <form action={signOut}>
          <button
            type="submit"
            title="Sign out"
            aria-label="Sign out"
            className="flex h-[26px] w-[26px] items-center justify-center rounded-control text-[13px] text-ink-400 transition hover:bg-canvas hover:text-ink-700"
          >
            ⏻
          </button>
        </form>
      </div>
    </div>
  );
}

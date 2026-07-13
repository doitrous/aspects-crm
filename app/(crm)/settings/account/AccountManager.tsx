"use client";

import { useActionState } from "react";
import type { SessionUser } from "@/lib/auth/account";
import { changePasswordAction, updateAvatarAction, type AccountActionState } from "./actions";

const IDLE: AccountActionState = {};
const input = "mt-1 h-10 w-full rounded-control border border-line bg-white px-3 text-[12.5px] outline-none focus:border-primary";

function Feedback({ state }: { state: AccountActionState }) {
  if (state.error) return <p role="alert" className="mt-2 text-[11.5px] font-bold text-danger">{state.error}</p>;
  if (state.ok) return <p className="mt-2 text-[11.5px] font-bold text-success">{state.ok}</p>;
  return null;
}

export function AccountManager({ user }: { user: SessionUser }) {
  const [avatarState, avatarAction, avatarPending] = useActionState(updateAvatarAction, IDLE);
  const [passwordState, passwordAction, passwordPending] = useActionState(changePasswordAction, IDLE);
  return <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
    <section className="rounded-xl border border-line bg-panel p-5 shadow-sm">
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Profile</div>
      <div className="mt-4 flex items-center gap-4">
        <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-primary-avatar text-[22px] font-black text-primary">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {user.avatarUrl ? <img src={user.avatarUrl} alt="Current profile" className="h-full w-full object-cover" /> : user.initials}
        </div>
        <div><div className="text-[17px] font-black text-ink-900">{user.name}</div><div className="mt-0.5 text-[11.5px] text-ink-500">{user.email}</div><span className="mt-2 inline-flex rounded-full bg-primary-soft px-2.5 py-1 text-[10px] font-black capitalize text-primary">{user.role}</span></div>
      </div>
      <form action={avatarAction} className="mt-5 border-t border-line pt-4">
        <label className="text-[11px] font-bold text-ink-600">New profile picture<input name="avatar" type="file" accept="image/jpeg,image/png,image/webp" required className="mt-2 block w-full text-[11.5px] text-ink-500 file:mr-3 file:rounded-control file:border-0 file:bg-line-faint file:px-3 file:py-2 file:font-bold file:text-ink-700" /></label>
        <p className="mt-2 text-[10.5px] text-ink-400">JPG, PNG or WebP · maximum 2 MB.</p>
        <button disabled={avatarPending} className="mt-3 h-9 rounded-control bg-primary px-4 text-[12px] font-bold text-white disabled:opacity-50">{avatarPending ? "Uploading…" : "Update picture"}</button>
        <Feedback state={avatarState} />
      </form>
    </section>
    <section className="rounded-xl border border-line bg-panel p-5 shadow-sm">
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Security</div><h2 className="mt-1 text-[20px] font-black text-ink-900">Change login password</h2><p className="mt-1 text-[11.5px] text-ink-500">Choose a password you do not use on another account. The change applies to your next login.</p>
      <form action={passwordAction} className="mt-5 max-w-lg space-y-3">
        <label className="block text-[11px] font-bold text-ink-600">New password<input name="password" type="password" minLength={8} autoComplete="new-password" required className={input} /></label>
        <label className="block text-[11px] font-bold text-ink-600">Confirm new password<input name="confirmation" type="password" minLength={8} autoComplete="new-password" required className={input} /></label>
        <button disabled={passwordPending} className="h-10 rounded-control bg-ink-900 px-5 text-[12px] font-black text-white hover:bg-primary disabled:opacity-50">{passwordPending ? "Changing…" : "Change password"}</button>
        <Feedback state={passwordState} />
      </form>
    </section>
  </div>;
}

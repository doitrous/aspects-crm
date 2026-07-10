"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "./actions";

const INITIAL: SignInState = { error: null };

export function LoginForm({ next, notice }: { next: string; notice: string | null }) {
  const [state, action, pending] = useActionState(signIn, INITIAL);
  const message = state.error ?? notice;

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-semibold text-ink-700">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          className="rounded-control border border-line bg-panel px-3 py-2 text-[13px] text-ink-900 outline-none focus:border-primary focus:shadow-focus"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-semibold text-ink-700">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded-control border border-line bg-panel px-3 py-2 text-[13px] text-ink-900 outline-none focus:border-primary focus:shadow-focus"
        />
      </label>

      {message ? (
        <p
          role="alert"
          className="rounded-control border border-danger/20 bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger"
        >
          {message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-control bg-primary px-3 py-2.5 text-[13px] font-semibold text-white transition hover:bg-primary-hover disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

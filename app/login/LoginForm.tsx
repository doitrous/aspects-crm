"use client";

import { useActionState, useState } from "react";
import { signIn, type SignInState } from "./actions";
import styles from "./login.module.css";

const INITIAL: SignInState = { error: null };

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5.5 20c.4-4.1 2.6-6.2 6.5-6.2s6.1 2.1 6.5 6.2" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
    </svg>
  );
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12s3.4-5.2 9.5-5.2S21.5 12 21.5 12s-3.4 5.2-9.5 5.2S2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.5" />
      {hidden ? <path d="m4 4 16 16" /> : null}
    </svg>
  );
}

export function LoginForm({ next, notice }: { next: string; notice: string | null }) {
  const [state, action, pending] = useActionState(signIn, INITIAL);
  const [showPassword, setShowPassword] = useState(false);
  const message = state.error ?? notice;

  return (
    <form action={action} className={styles.loginForm}>
      <input type="hidden" name="next" value={next} />

      <label className={styles.field}>
        <span>Email address</span>
        <span className={styles.inputWrap}>
          <span className={styles.inputIcon}><UserIcon /></span>
          <input
            name="email"
            type="email"
            autoComplete="username"
            placeholder="name@aspectsclinica.net"
            required
            autoFocus
          />
        </span>
      </label>

      <label className={styles.field}>
        <span>Password</span>
        <span className={styles.inputWrap}>
          <span className={styles.inputIcon}><LockIcon /></span>
          <input
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Enter your password"
            required
          />
          <button
            type="button"
            className={styles.passwordToggle}
            onClick={() => setShowPassword((current) => !current)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
          >
            <EyeIcon hidden={!showPassword} />
          </button>
        </span>
      </label>

      <div className={styles.formHelp}>
        <span>Forgot your password?</span>
        <span>Ask an administrator or auditor to reset it.</span>
      </div>

      {message ? <p role="alert" className={styles.alert}>{message}</p> : null}

      <button type="submit" disabled={pending} className={styles.submitButton}>
        <span>{pending ? "Signing in…" : "Sign in"}</span>
        {!pending ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14M14 7l5 5-5 5" />
          </svg>
        ) : <span className={styles.spinner} aria-hidden="true" />}
      </button>
    </form>
  );
}

import Image from "next/image";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/session";
import { getSessionUser } from "@/lib/data/session";
import { LoginForm } from "./LoginForm";
import { signOut } from "./actions";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";

/** Human text for the `?error=` codes `requireUser()` and friends redirect with. */
function noticeFor(code: string | undefined, signedIn: boolean): string | null {
  if (code !== "no_access") return null;
  return signedIn
    ? "Your account is signed in but does not have an active CRM profile. Ask an administrator or auditor to restore access."
    : "Please sign in to continue.";
}

function BrandPanel() {
  return (
    <section className={styles.brandPanel} aria-label="Aspects Clinica CRM">
      <div className={styles.brandGlow} aria-hidden="true" />
      <div className={styles.brandHeader}>
        <span className={styles.brandEyebrow}>Aspects Clinica</span>
        <span className={styles.securityLabel}>Staff workspace</span>
      </div>

      <div className={styles.markStage} aria-hidden="true">
        <span className={styles.markHalo} />
        <Image
          src="/aspects-logo-mark.png"
          alt=""
          width={870}
          height={658}
          className={styles.brandMark}
          priority
        />
      </div>

      <div className={styles.brandMessage}>
        <p className={styles.brandKicker}>One connected clinic workspace</p>
        <h2>Every lead, conversation and booking—clearly managed.</h2>
        <p>
          Keep patient enquiries, follow-ups, appointments, payments and reporting together in one secure CRM.
        </p>
        <ul className={styles.workflowList} aria-label="CRM workspace areas">
          <li>Leads</li>
          <li>Bookings</li>
          <li>Follow-ups</li>
          <li>Reports</li>
        </ul>
      </div>

      <a className={styles.domainLink} href="https://aspectsclinica.net">
        aspectsclinica.net
      </a>
    </section>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  // A valid Supabase session AND an active `crm_users` profile means they're in.
  const user = await getSessionUser();
  if (user) redirect(next?.startsWith("/") && !next.startsWith("//") ? next : "/calendar");

  // Authenticated with Supabase, but no active CRM profile: explain the access
  // issue instead of presenting a form that cannot restore their permissions.
  const authUser = await getAuthUser();

  return (
    <main className={styles.page}>
      <BrandPanel />

      <section className={styles.formPanel} aria-labelledby="login-heading">
        <div className={styles.formShell}>
          <Image
            src="/aspects-logo-full.png"
            alt="Aspects Clinica"
            width={2838}
            height={1483}
            className={styles.fullLogo}
            priority
          />

          <p className={styles.formEyebrow}>Staff CRM</p>
          <h1 id="login-heading" className={styles.title}>Welcome back</h1>
          <p className={styles.subtitle}>Sign in to continue to the Aspects Clinica workspace.</p>

          <div className={styles.formArea}>
            {authUser ? (
              <div className={styles.accessState}>
                <p role="alert" className={styles.alert}>
                  {noticeFor("no_access", true)}
                </p>
                <p className={styles.signedInAs}>
                  Signed in as <strong>{authUser.email}</strong>
                </p>
                <form action={signOut}>
                  <button type="submit" className={styles.secondaryButton}>
                    Sign out
                  </button>
                </form>
              </div>
            ) : (
              <LoginForm next={next ?? "/calendar"} notice={noticeFor(error, false)} />
            )}
          </div>

          <div className={styles.trustNote}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3 5.5 5.8v5.3c0 4.4 2.7 8.1 6.5 9.9 3.8-1.8 6.5-5.5 6.5-9.9V5.8L12 3Z" />
              <path d="m9.2 12 1.8 1.8 3.9-4" />
            </svg>
            <span>Secure access for authorised Aspects Clinica staff.</span>
          </div>
        </div>
      </section>
    </main>
  );
}

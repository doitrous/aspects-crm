import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/session";
import { getSessionUser } from "@/lib/data/session";
import { LoginForm } from "./LoginForm";
import { signOut } from "./actions";

export const dynamic = "force-dynamic";

/** Human text for the `?error=` codes `requireUser()` and friends redirect with. */
function noticeFor(code: string | undefined, signedIn: boolean): string | null {
  if (code !== "no_access") return null;
  return signedIn
    ? "Your account is not active in the CRM, or has no CRM profile. Ask an administrator for access."
    : "Please sign in to continue.";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  // A valid Supabase session AND an active `crm_users` profile means they're in.
  const user = await getSessionUser();
  if (user) redirect(next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");

  // Authenticated with Supabase, but no active CRM profile: don't show a login
  // form they'd fill in pointlessly — show why, and let them sign out.
  const authUser = await getAuthUser();

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-5">
      <div className="w-full max-w-[380px] rounded-card border border-line bg-panel p-7 shadow-card">
        <h1 className="font-display text-[24px] font-semibold text-ink-900">Aspects Clinica</h1>
        <p className="mt-1 text-[12.5px] text-ink-500">Sign in to the CRM</p>

        <div className="mt-6">
          {authUser ? (
            <div className="flex flex-col gap-4">
              <p
                role="alert"
                className="rounded-control border border-danger/20 bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger"
              >
                {noticeFor("no_access", true)}
              </p>
              <p className="text-[12px] text-ink-500">
                Signed in as <span className="font-semibold text-ink-700">{authUser.email}</span>
              </p>
              <form action={signOut}>
                <button
                  type="submit"
                  className="w-full rounded-control border border-line px-3 py-2.5 text-[13px] font-semibold text-ink-700 transition hover:bg-canvas"
                >
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            <LoginForm next={next ?? "/dashboard"} notice={noticeFor(error, false)} />
          )}
        </div>
      </div>
    </main>
  );
}

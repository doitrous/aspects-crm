import "server-only";
import type { SessionUser } from "@/lib/auth/account";
import { requireSession } from "@/lib/data/session";

/** Thrown when the signed-in session may not author a write. */
export class ActorError extends Error {}

/**
 * The actor for any audited write: the **real** signed-in account, never the
 * impersonated one.
 *
 * Mutating while previewing as another user is refused outright rather than
 * silently attributed — an audit trail that names the previewed user would be a
 * lie, and one that names the previewer would hide which account the change was
 * made through. Stop previewing, then write.
 */
export async function writeActor(): Promise<SessionUser> {
  const { real, effective } = await requireSession();
  if (effective.impersonating) {
    throw new ActorError("Stop previewing as another user before making changes.");
  }
  return real;
}

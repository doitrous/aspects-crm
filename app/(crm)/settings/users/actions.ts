"use server";

import { revalidatePath } from "next/cache";
import { PermissionError } from "@/lib/auth/permissions";
import { isAssignableRole } from "@/lib/auth/roles";
import { ActorError } from "@/lib/data/actor";
import { changeUserRole, setUserActive, UserAdminError } from "@/lib/data/users";

export interface UserActionState {
  error: string | null;
  ok: string | null;
}

export const IDLE: UserActionState = { error: null, ok: null };

/**
 * Turn the expected failure modes into form errors, and let anything else
 * (a genuine bug, a dropped connection) surface as a 500 rather than be
 * swallowed into a misleading message.
 */
function toState(err: unknown): UserActionState {
  if (err instanceof UserAdminError || err instanceof ActorError) {
    return { error: err.message, ok: null };
  }
  if (err instanceof PermissionError) {
    return { error: "You do not have permission to change user access.", ok: null };
  }
  throw err;
}

/** Change a user's role. Authorization happens server-side in `changeUserRole`. */
export async function changeRoleAction(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  const reason = String(formData.get("reason") ?? "");

  if (!userId) return { error: "Missing user.", ok: null };
  if (!isAssignableRole(role)) return { error: `"${role}" is not an assignable role.`, ok: null };

  try {
    await changeUserRole(userId, role, reason);
  } catch (err) {
    return toState(err);
  }

  revalidatePath("/settings/users");
  return { error: null, ok: `Role updated to ${role}.` };
}

/** Activate or deactivate a user. */
export async function setActiveAction(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const userId = String(formData.get("userId") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  const reason = String(formData.get("reason") ?? "");

  if (!userId) return { error: "Missing user.", ok: null };

  try {
    await setUserActive(userId, active, reason);
  } catch (err) {
    return toState(err);
  }

  revalidatePath("/settings/users");
  return { error: null, ok: active ? "User activated." : "User deactivated." };
}

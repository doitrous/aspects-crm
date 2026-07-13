"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/data/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { supabaseSession } from "@/lib/supabase/session";

export interface AccountActionState {
  ok?: string;
  error?: string;
}

export async function updateAvatarAction(
  _previous: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const { real: user } = await requireSession();
  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image." };
  if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type)) return { error: "Use a JPG, PNG, or WebP image." };
  if (file.size > 2 * 1024 * 1024) return { error: "Profile pictures must be 2 MB or smaller." };

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${user.id}/avatar.${extension}`;
  const admin = supabaseAdmin();
  const upload = await admin.storage.from("crm-avatars").upload(path, new Uint8Array(await file.arrayBuffer()), {
    contentType: file.type,
    upsert: true,
    cacheControl: "3600",
  });
  if (upload.error) return { error: `Picture could not be uploaded: ${upload.error.message}` };
  const { data } = admin.storage.from("crm-avatars").getPublicUrl(path);
  const avatarUrl = `${data.publicUrl}?v=${Date.now()}`;
  const { error } = await admin.from("crm_users").update({ avatar_url: avatarUrl }).eq("id", user.id);
  if (error) return { error: `Picture could not be saved: ${error.message}` };
  revalidatePath("/", "layout");
  revalidatePath("/settings/account");
  return { ok: "Profile picture updated." };
}

export async function changePasswordAction(
  _previous: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  await requireSession();
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (password.length < 8) return { error: "Use at least 8 characters." };
  if (password !== confirmation) return { error: "The passwords do not match." };
  const client = await supabaseSession();
  const { error } = await client.auth.updateUser({ password });
  if (error) return { error: `Password could not be changed: ${error.message}` };
  return { ok: "Password changed successfully." };
}

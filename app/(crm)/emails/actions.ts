"use server";

import { revalidatePath } from "next/cache";
import { ManualEmailError, sendManualEmail } from "@/lib/data/emailData";

export type ManualEmailState = { ok?: string; error?: string };

export async function sendManualEmailAction(_previous: ManualEmailState, formData: FormData): Promise<ManualEmailState> {
  try {
    const ok = await sendManualEmail({
      recipients: String(formData.get("recipients") ?? "").split(/[;,\n]/),
      subject: String(formData.get("subject") ?? ""),
      body: String(formData.get("body") ?? ""),
    });
    revalidatePath("/emails");
    return { ok };
  } catch (error) {
    console.error("manual email failed", error);
    return { error: error instanceof ManualEmailError ? error.message : "Email could not be sent." };
  }
}

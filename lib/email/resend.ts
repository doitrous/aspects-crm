import "server-only";

/**
 * Minimal Resend transport. Kept tiny and dependency-free (plain fetch) so it
 * can be swapped without touching the rule engine.
 *
 * When `RESEND_API_KEY` is absent the send is a no-op that reports `skipped`
 * rather than throwing — so a non-configured environment logs "skipped" in
 * `crm_email_log` instead of erroring. We only ever report the provider's real
 * outcome; nothing fabricates a delivered/opened status.
 */

export interface SendResult {
  status: "sent" | "failed" | "skipped";
  providerMessageId?: string;
  error?: string;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

function fromAddress(): string {
  return process.env.EMAIL_FROM || "Aspects Clinica CRM <onboarding@resend.dev>";
}

export async function sendEmail(input: {
  to: string[];
  subject: string;
  text: string;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { status: "skipped", error: "RESEND_API_KEY not configured" };
  if (input.to.length === 0) return { status: "skipped", error: "no recipients resolved" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: input.to,
        subject: input.subject,
        text: input.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { status: "failed", error: `Resend ${res.status}: ${body.slice(0, 300)}` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { status: "sent", providerMessageId: data.id };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : "send failed" };
  }
}

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

/** One row of the Emails log page (§D). */
export interface EmailLogRow {
  id: string;
  createdAt: string;
  sentAt: string | null;
  ruleKey: string | null;
  trigger: string | null;
  recipients: string[];
  subject: string | null;
  status: string;
  provider: string | null;
  providerMessageId: string | null;
  error: string | null;
  leadHumanId: string | null;
}

export async function listEmailLog(limit = 200): Promise<EmailLogRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("crm_email_log")
    .select(
      "id,created_at,sent_at,rule_key,trigger,recipients,subject,status,provider,provider_message_id,error,lead_id,leads(lead_id)",
    )
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 500));
  if (error) throw new Error(`listEmailLog: ${error.message}`);
  return (data ?? []).map((r) => {
    const leadJoin = r.leads as { lead_id?: string } | { lead_id?: string }[] | null;
    const leadHumanId = Array.isArray(leadJoin) ? leadJoin[0]?.lead_id : leadJoin?.lead_id;
    return {
      id: r.id as string,
      createdAt: r.created_at as string,
      sentAt: (r.sent_at as string) ?? null,
      ruleKey: (r.rule_key as string) ?? null,
      trigger: (r.trigger as string) ?? null,
      recipients: (r.recipients as string[]) ?? [],
      subject: (r.subject as string) ?? null,
      status: (r.status as string) ?? "queued",
      provider: (r.provider as string) ?? null,
      providerMessageId: (r.provider_message_id as string) ?? null,
      error: (r.error as string) ?? null,
      leadHumanId: leadHumanId ?? null,
    };
  });
}

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

/** Materialize time-based SLA state before reads. The deadline remains the
 * source of truth; this keeps legacy count queries and badges in sync. */
export async function refreshReplyOverdueFlags(now = new Date()): Promise<void> {
  const db = supabaseAdmin();
  const iso = now.toISOString();
  const [mark, clear] = await Promise.all([
    db.from("leads").update({ is_reply_overdue: true })
      .is("deleted_at", null)
      .eq("has_unread", true)
      .not("reply_overdue_at", "is", null)
      .lte("reply_overdue_at", iso)
      .eq("is_reply_overdue", false),
    db.from("leads").update({ is_reply_overdue: false })
      .is("deleted_at", null)
      .eq("is_reply_overdue", true)
      .or(`has_unread.eq.false,reply_overdue_at.gt.${iso}`),
  ]);
  if (mark.error) throw new Error(`refreshReplyOverdueFlags(mark): ${mark.error.message}`);
  if (clear.error) throw new Error(`refreshReplyOverdueFlags(clear): ${clear.error.message}`);
}

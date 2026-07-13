import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
export {
  isRevisitingMetadata,
  normalizePatientMrn,
  withRevisitingMetadata,
  type RevisitingMatch,
} from "@/lib/booking/revisitingRules";

/** Metadata makes the tag immediately visible during rolling deployments;
 * this assignment also persists it in the normal editable lead-tag system. */
export async function assignRevisitingPatientTag(leadUid: string): Promise<void> {
  const db = supabaseAdmin();
  const { data: tag, error: tagError } = await db
    .from("lead_tags")
    .select("id")
    .eq("name", "Revisiting Patient")
    .maybeSingle();
  if (tagError || !tag?.id) {
    console.error("Revisiting Patient tag lookup failed", { code: tagError?.code });
    return;
  }
  const { error } = await db.from("lead_tag_assignments").upsert({
    lead_id: leadUid,
    tag_id: tag.id,
    assigned_by: null,
  }, { onConflict: "lead_id,tag_id" });
  if (error) console.error("Revisiting Patient tag assignment failed", { leadUid, code: error.code });
}

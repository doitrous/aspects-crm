import type { Comment } from "@/lib/types";

/**
 * Turn a flat, chronological comment list into threads.
 *
 * A reply whose parent we never ingested (the parent was deleted before the CRM
 * saw it, or it predates ingestion) is promoted to the top level rather than
 * dropped — losing a patient's question because its parent is missing would be
 * worse than showing it slightly out of place.
 */
export function nestComments(flat: Comment[]): Comment[] {
  const byCommentId = new Map<string, Comment>();
  for (const c of flat) {
    c.replies = [];
    byCommentId.set(c.commentId, c);
  }

  const roots: Comment[] = [];
  for (const c of flat) {
    const parent = c.parentCommentId ? byCommentId.get(c.parentCommentId) : undefined;
    if (parent && parent !== c) parent.replies!.push(c);
    else roots.push(c);
  }
  return roots;
}

import type { Comment, MessageAttachment } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { EmptyState } from "@/components/ui/EmptyState";

const PLATFORM_STYLE: Record<Comment["platform"], { label: string; style: React.CSSProperties }> = {
  instagram: { label: "Instagram", style: { background: "#fdf2fa", color: "#c11574" } },
  facebook: { label: "Facebook", style: { background: "#eff4ff", color: "#175cd3" } },
};

/** Instagram Live comments arrive with a distinct media product type. */
function isLive(c: Comment): boolean {
  const t = c.mediaProductType?.toLowerCase();
  return t === "ig_live" || t === "live";
}

function CommentAttachments({ attachments }: { attachments: MessageAttachment[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((a) =>
        a.type === "image" && a.url ? (
          <a key={a.id} href={a.url} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.url} alt={a.name ?? "attachment"} className="h-20 w-20 rounded-lg object-cover" />
          </a>
        ) : (
          <a
            key={a.id}
            href={a.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-line-faint px-2 py-1.5 text-[11.5px] text-ink-700"
          >
            📎 {a.name ?? a.title ?? a.type}
          </a>
        ),
      )}
    </div>
  );
}

function CommentCard({ comment, depth }: { comment: Comment; depth: number }) {
  const platform = PLATFORM_STYLE[comment.platform];
  const business = comment.isPageOrBusinessReply;

  return (
    <div style={depth > 0 ? { marginLeft: Math.min(depth, 4) * 20 } : undefined}>
      <div
        className={
          "rounded-card border p-3 " + (business ? "border-primary/30 bg-primary-soft/40" : "border-line bg-panel")
        }
      >
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded-pill px-2 py-0.5 font-semibold" style={platform.style}>
            {platform.label}
          </span>

          {isLive(comment) && (
            <span className="rounded-pill bg-danger-bg px-2 py-0.5 font-semibold text-danger">● Live</span>
          )}

          <span
            className={
              "rounded-pill px-2 py-0.5 font-medium " +
              (business ? "bg-[#ecfdf3] text-success" : "bg-line-faint text-ink-600")
            }
          >
            {business ? "Page reply" : comment.isReply ? "Reply" : "Comment"}
          </span>

          <span className="font-medium text-ink-600">
            {comment.authorName ?? comment.authorUsername ?? "Unknown"}
          </span>

          {comment.identityConfidence && comment.identityConfidence !== "strong" && (
            <span
              title="This commenter could not be matched to a platform-scoped ID; they are never auto-merged with another lead."
              className="rounded-pill bg-[#fffaeb] px-2 py-0.5 font-medium text-warn"
            >
              {comment.identityConfidence} identity
            </span>
          )}
        </div>

        {/* Deleted comments keep their row: the moderator sees that something was
            removed, and the original text stays in the audit history. */}
        {comment.isDeleted ? (
          <div className="text-[12.5px] italic text-ink-400">Comment deleted</div>
        ) : (
          <div className="whitespace-pre-wrap text-[12.5px] text-ink-800">{comment.body}</div>
        )}

        {!comment.isDeleted && comment.attachments && comment.attachments.length > 0 && (
          <CommentAttachments attachments={comment.attachments} />
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-ink-400">
          <span>{formatDateTime(comment.createdAt)}</span>
          {comment.isEdited && <span>· Edited</span>}
          {comment.commentLink && (
            <>
              <span>·</span>
              <a href={comment.commentLink} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                View comment
              </a>
            </>
          )}
          {comment.mediaPermalink && (
            <>
              <span>·</span>
              <a href={comment.mediaPermalink} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                View post
              </a>
            </>
          )}
        </div>
      </div>

      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-2 flex flex-col gap-2 border-l border-line-soft pl-2">
          {comment.replies.map((r) => (
            <CommentCard key={r.id} comment={r} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Facebook + Instagram comments, nested under their parent. Threading comes
 * from the platform's own `parent_comment_id`, so a reply never floats away
 * from the comment it answers.
 */
export function CommentsPanel({ comments }: { comments: Comment[] }) {
  if (comments.length === 0) {
    return (
      <EmptyState
        icon="💬"
        title="No social comments"
        hint="Facebook & Instagram comments are captured here, separate from DMs."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2.5 p-4">
      {comments.map((c) => (
        <CommentCard key={c.id} comment={c} depth={0} />
      ))}
    </div>
  );
}

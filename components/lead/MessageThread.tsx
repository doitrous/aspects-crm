import type { Message, MessageAttachment } from "@/lib/types";
import { formatDateTime, formatTime } from "@/lib/format";
import { EmptyState } from "@/components/ui/EmptyState";

const CHANNEL_LABEL: Record<Message["channel"], string> = {
  facebook: "Messenger",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  comment: "Comment",
};

/** sent → delivered → seen. Incoming messages have no status at all. */
const STATUS_LABEL: Record<NonNullable<Message["deliveryStatus"]>, string> = {
  sent: "Sent",
  delivered: "Delivered",
  seen: "Seen",
};

const ATTACHMENT_ICON: Record<string, string> = {
  image: "🖼",
  video: "🎬",
  audio: "🎙",
  file: "📎",
  sticker: "🌟",
  share: "🔗",
  location: "📍",
  fallback: "🔗",
};

function attachmentLabel(a: MessageAttachment): string {
  return a.name ?? a.title ?? a.rawType ?? a.type;
}

/**
 * Renders every attachment, in the order the platform sent them. Images get a
 * real thumbnail; anything else — including types Meta has not invented yet —
 * degrades to a labelled link rather than disappearing.
 */
function Attachments({ attachments, outgoing }: { attachments: MessageAttachment[]; outgoing: boolean }) {
  const images = attachments.filter((a) => a.type === "image" && a.url);
  const rest = attachments.filter((a) => !(a.type === "image" && a.url));

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {images.length > 0 && (
        <div className={"grid gap-1 " + (images.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
          {images.map((a) => (
            <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.url}
                alt={attachmentLabel(a)}
                className="h-full max-h-48 w-full object-cover transition-opacity hover:opacity-90"
              />
            </a>
          ))}
        </div>
      )}

      {rest.map((a) => {
        const icon = ATTACHMENT_ICON[a.type] ?? "📄";
        const label = attachmentLabel(a);
        const chip = (
          <span
            className={
              "inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11.5px] " +
              (outgoing ? "bg-white/15 text-white" : "bg-panel text-ink-700")
            }
          >
            <span aria-hidden>{icon}</span>
            <span className="truncate">{label}</span>
          </span>
        );
        if (a.type === "audio" && a.url) {
          return <audio key={a.id} controls src={a.url} className="max-w-full" />;
        }
        if (a.type === "video" && a.url) {
          return <video key={a.id} controls src={a.url} className="max-h-48 rounded-lg" />;
        }
        return a.url ? (
          <a key={a.id} href={a.url} target="_blank" rel="noreferrer">
            {chip}
          </a>
        ) : (
          <span key={a.id}>{chip}</span>
        );
      })}
    </div>
  );
}

function ReplyContextPreview({ message, outgoing }: { message: Message; outgoing: boolean }) {
  const r = message.replyTo!;
  const preview = r.body?.trim() || "Attachment";
  return (
    <a
      // Scrolls to the original when we ingested it; inert when we did not.
      href={r.localId ? `#msg-${r.localId}` : undefined}
      className={
        "mb-1.5 block border-l-2 pl-2 text-[11px] leading-snug " +
        (outgoing ? "border-white/50 text-white/80" : "border-primary/40 text-ink-500") +
        (r.localId ? " cursor-pointer hover:opacity-80" : "")
      }
    >
      <span className="font-semibold">{r.authorName ?? "Replying to"}</span>
      <span className="line-clamp-2 block">{preview}</span>
    </a>
  );
}

function Reactions({ message }: { message: Message }) {
  const rx = message.reactions ?? [];
  if (rx.length === 0) return null;
  return (
    <div className="-mt-1.5 flex gap-1">
      {rx.map((r) => (
        <span
          key={r.id}
          title={`${r.type ?? "reaction"} · ${formatDateTime(r.reactedAt)}`}
          className="rounded-pill border border-line bg-panel px-1.5 py-0.5 text-[11px] shadow-sm"
        >
          {r.emoji ?? "👍"}
        </span>
      ))}
    </div>
  );
}

export function MessageThread({
  messages,
  emptyHint,
}: {
  messages: Message[];
  emptyHint?: string;
}) {
  if (messages.length === 0) {
    return <EmptyState icon="✉" title="No messages yet" hint={emptyHint} />;
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {messages.map((m) => {
        const out = m.direction === "outgoing";
        const attachments = m.attachments ?? [];
        const hasBody = m.body.trim().length > 0;

        return (
          <div key={m.id} id={`msg-${m.id}`} className={"flex flex-col " + (out ? "items-end" : "items-start")}>
            <div
              className={
                "max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed " +
                (out ? "bg-primary text-white rounded-br-sm" : "bg-line-faint text-ink-900 rounded-bl-sm")
              }
            >
              {m.replyTo && <ReplyContextPreview message={m} outgoing={out} />}

              {m.isDeleted ? (
                <span className={"italic " + (out ? "text-white/70" : "text-ink-400")}>
                  This message was deleted
                </span>
              ) : (
                <>
                  {/* A postback has no free text; its button title IS the content. */}
                  {hasBody && <span className="whitespace-pre-wrap">{m.body}</span>}
                  {!hasBody && attachments.length === 0 && m.isUnsupported && (
                    <span className={"italic " + (out ? "text-white/70" : "text-ink-400")}>
                      Unsupported message type
                    </span>
                  )}
                  {attachments.length > 0 && <Attachments attachments={attachments} outgoing={out} />}
                </>
              )}
            </div>

            <Reactions message={m} />

            <div className="mt-1 flex flex-wrap items-center gap-1.5 px-1 text-[10.5px] text-ink-400">
              <span className="font-medium">{out ? (m.authorName ?? "Clinic") : (m.authorName ?? "Patient")}</span>
              <span>·</span>
              <span>{CHANNEL_LABEL[m.channel]}</span>
              <span>·</span>
              <span title={formatDateTime(m.createdAt)}>{formatTime(m.createdAt)}</span>

              {/* A quick reply and a postback are ONE message, marked, not two. */}
              {m.quickReplyText && (
                <span className="rounded-pill bg-primary-soft px-1.5 py-px text-[9.5px] font-medium text-primary">
                  Quick reply
                </span>
              )}
              {m.postbackTitle && (
                <span className="rounded-pill bg-primary-soft px-1.5 py-px text-[9.5px] font-medium text-primary">
                  Button
                </span>
              )}
              {(m.editCount ?? 0) > 0 && (
                <span title={m.editedAt ? `Edited ${formatDateTime(m.editedAt)}` : undefined}>· Edited</span>
              )}
              {out && m.deliveryStatus && (
                <span
                  className={m.deliveryStatus === "seen" ? "text-primary" : undefined}
                  title={
                    m.seenAt
                      ? `Seen ${formatDateTime(m.seenAt)}`
                      : m.deliveredAt
                        ? `Delivered ${formatDateTime(m.deliveredAt)}`
                        : undefined
                  }
                >
                  · {STATUS_LABEL[m.deliveryStatus]}
                  {m.deliveryStatus === "seen" && m.seenAt ? ` ${formatTime(m.seenAt)}` : ""}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import type { Message } from "@/lib/types";
import { formatDateTime } from "@/lib/format";

export function AiReplyAssistant({ leadId, messages }: { leadId: string; messages: Message[] }) {
  const lastCustomerMessage = useMemo(
    () => [...messages].reverse().find((message) => message.direction === "incoming" && message.body.trim()),
    [messages],
  );
  const [instruction, setInstruction] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function askAi() {
    if (!lastCustomerMessage || !instruction.trim()) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/crm/ai-reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId, instruction: instruction.trim(), channel: lastCustomerMessage.channel }),
      });
      const result = await response.json() as { suggestedReply?: string; nextAction?: string; error?: string };
      if (!response.ok || !result.suggestedReply) throw new Error(result.error || "No recommendation was returned.");
      setSuggestion(result.suggestedReply);
      setNextAction(result.nextAction ?? "");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The AI recommendation could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  async function copySuggestion() {
    try {
      await navigator.clipboard.writeText(suggestion);
      setStatus("Recommendation copied");
    } catch {
      setError("Your browser blocked clipboard access. Select and copy the text manually.");
    }
  }

  return (
    <section className="border-t border-line bg-panel px-4 py-4">
      <div className="mx-auto max-w-3xl rounded-xl border border-primary/20 bg-primary-soft/20 p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary">AI reply assistant</div>
            <h4 className="mt-1 text-[15px] font-black text-ink-900">Prepare the next reply</h4>
            <p className="mt-0.5 text-[10.5px] text-ink-500">Recommendations are drafts only. Nothing is sent automatically.</p>
          </div>
          <span className="rounded-full border border-primary/20 bg-white px-2.5 py-1 text-[9.5px] font-black text-primary">Moderator review only</span>
        </div>

        <div className="mt-3 rounded-lg border border-line bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-black uppercase tracking-wide text-ink-400">Last customer message</span>
            {lastCustomerMessage && <span className="text-[9.5px] text-ink-400">{formatDateTime(lastCustomerMessage.createdAt)}</span>}
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-800">
            {lastCustomerMessage?.body || "No customer message is available yet."}
          </p>
        </div>

        <label className="mt-3 block text-[10.5px] font-bold text-ink-600">
          Ask AI for recommendation of next reply
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            maxLength={1500}
            rows={3}
            placeholder="For example: Answer the price question, keep it warm, and ask for a preferred appointment day."
            className="mt-1.5 w-full resize-y rounded-md border border-line bg-[#fbfaf7] px-3 py-2.5 text-[12px] text-ink-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        </label>
        <button
          type="button"
          disabled={busy || !lastCustomerMessage || !instruction.trim()}
          onClick={() => void askAi()}
          className="mt-2.5 h-9 rounded-md bg-primary px-4 text-[11.5px] font-black text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Asking AI…" : "Ask AI"}
        </button>

        {suggestion && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] font-black uppercase tracking-wide text-emerald-700">Recommended reply</span>
              <button type="button" onClick={() => void copySuggestion()} className="rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-[10px] font-black text-emerald-700">Copy reply</button>
            </div>
            <textarea readOnly value={suggestion} rows={4} className="mt-2 w-full resize-y rounded-md border border-emerald-200 bg-white px-3 py-2.5 text-[12px] leading-relaxed text-ink-900 outline-none" />
            {nextAction && <p className="mt-2 text-[10.5px] font-semibold text-emerald-800">Suggested next action: {nextAction}</p>}
          </div>
        )}
        {error && <p role="alert" className="mt-2 text-[10.5px] font-bold text-danger">{error}</p>}
        {status && <p role="status" className="mt-2 text-[10.5px] font-bold text-success">{status}</p>}
      </div>
    </section>
  );
}

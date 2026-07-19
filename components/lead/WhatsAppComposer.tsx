"use client";

import { useEffect, useMemo, useState } from "react";
import type { Message } from "@/lib/types";
import {
  isInsideWhatsAppServiceWindow,
  WHATSAPP_TEXT_LIMIT,
  type WhatsAppTemplateSummary,
} from "@/lib/whatsapp/cloud";

type Mode = "text" | "template";

type OptionsResponse = {
  canSendFreeform?: boolean;
  lastIncomingAt?: string | null;
  templates?: WhatsAppTemplateSummary[];
  templatesConfigured?: boolean;
  error?: string;
};

function templateKey(template: WhatsAppTemplateSummary): string {
  return `${template.name}::${template.language}`;
}

export function WhatsAppComposer({
  leadId,
  lastIncomingAt,
  onSent,
}: {
  leadId: string;
  lastIncomingAt?: string;
  onSent: (message: Message) => void;
}) {
  const initialFreeform = isInsideWhatsAppServiceWindow(lastIncomingAt);
  const [mode, setMode] = useState<Mode>(initialFreeform ? "text" : "template");
  const [canSendFreeform, setCanSendFreeform] = useState(initialFreeform);
  const [text, setText] = useState("");
  const [templates, setTemplates] = useState<WhatsAppTemplateSummary[]>([]);
  const [templatesConfigured, setTemplatesConfigured] = useState(true);
  const [selectedKey, setSelectedKey] = useState("");
  const [headerParameters, setHeaderParameters] = useState<string[]>([]);
  const [bodyParameters, setBodyParameters] = useState<string[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const selectedTemplate = useMemo(
    () => templates.find((template) => templateKey(template) === selectedKey),
    [selectedKey, templates],
  );

  async function loadOptions() {
    setLoadingTemplates(true);
    setError("");
    try {
      const response = await fetch(`/api/crm/whatsapp/send?leadId=${encodeURIComponent(leadId)}`, { cache: "no-store" });
      const result = await response.json() as OptionsResponse;
      if (!response.ok) throw new Error(result.error || "WhatsApp templates could not be loaded.");
      const nextTemplates = result.templates ?? [];
      setTemplates(nextTemplates);
      setTemplatesConfigured(result.templatesConfigured !== false);
      setCanSendFreeform(result.canSendFreeform === true);
      if (!result.canSendFreeform) setMode("template");
      if (!selectedKey && nextTemplates.length) {
        const firstSupported = nextTemplates.find((template) => template.supported) ?? nextTemplates[0];
        setSelectedKey(templateKey(firstSupported));
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "WhatsApp templates could not be loaded.");
    } finally {
      setLoadingTemplates(false);
    }
  }

  useEffect(() => {
    if (mode === "template" && templates.length === 0 && !loadingTemplates) void loadOptions();
    // loadOptions is intentionally triggered by mode, not by each state change it performs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    const headerCount = selectedTemplate?.parameterGroups.find((group) => group.type === "header")?.count ?? 0;
    const bodyCount = selectedTemplate?.parameterGroups.find((group) => group.type === "body")?.count ?? 0;
    setHeaderParameters(Array.from({ length: headerCount }, () => ""));
    setBodyParameters(Array.from({ length: bodyCount }, () => ""));
  }, [selectedTemplate]);

  function updateParameter(group: "header" | "body", index: number, value: string) {
    const setter = group === "header" ? setHeaderParameters : setBodyParameters;
    setter((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
  }

  async function send() {
    if (sending) return;
    setSending(true);
    setError("");
    setStatus("");
    try {
      const payload = mode === "text"
        ? { leadId, mode, text: text.trim() }
        : {
            leadId,
            mode,
            templateName: selectedTemplate?.name,
            templateLanguage: selectedTemplate?.language,
            headerParameters,
            bodyParameters,
          };
      const response = await fetch("/api/crm/whatsapp/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { message?: Message; warning?: string; error?: string; code?: string };
      if (!response.ok || !result.message) {
        if (result.code === "template_required") {
          setCanSendFreeform(false);
          setMode("template");
        }
        throw new Error(result.error || "WhatsApp could not send the message.");
      }
      onSent(result.message);
      setText("");
      setStatus(result.warning || "Accepted by Meta; awaiting WhatsApp delivery confirmation");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "WhatsApp could not send the message.");
    } finally {
      setSending(false);
    }
  }

  const parametersComplete = [...headerParameters, ...bodyParameters].every((value) => value.trim());
  const textReady = mode === "text" && canSendFreeform && text.trim() && text.trim().length <= WHATSAPP_TEXT_LIMIT;
  const templateReady = mode === "template" && selectedTemplate?.supported && parametersComplete;

  return (
    <section className="sticky bottom-0 border-t border-line bg-panel px-4 py-3">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[11.5px] font-black text-ink-800">Send through WhatsApp</div>
            <div className="text-[10px] text-ink-400">The clinic’s Meta access token stays on the CRM server.</div>
          </div>
          <div className="flex rounded-md border border-line bg-slate-50 p-0.5 text-[10px] font-black">
            <button
              type="button"
              disabled={!canSendFreeform}
              onClick={() => setMode("text")}
              className={`rounded px-2.5 py-1.5 ${mode === "text" ? "bg-white text-primary shadow-sm" : "text-ink-500"} disabled:cursor-not-allowed disabled:opacity-40`}
            >
              Reply
            </button>
            <button
              type="button"
              onClick={() => setMode("template")}
              className={`rounded px-2.5 py-1.5 ${mode === "template" ? "bg-white text-primary shadow-sm" : "text-ink-500"}`}
            >
              Template
            </button>
          </div>
        </div>

        {!canSendFreeform && (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[10.5px] font-semibold text-amber-800">
            The customer-service window is closed. Send an approved template; a normal reply becomes available after the patient messages the clinic.
          </p>
        )}

        {mode === "text" ? (
          <div className="mt-2.5">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={WHATSAPP_TEXT_LIMIT}
              rows={3}
              placeholder="Write a WhatsApp reply…"
              className="w-full resize-y rounded-md border border-line bg-[#fbfaf7] px-3 py-2.5 text-[12px] text-ink-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
            <div className="mt-1 text-right text-[9.5px] text-ink-400">{text.length}/{WHATSAPP_TEXT_LIMIT}</div>
          </div>
        ) : (
          <div className="mt-2.5 space-y-2.5">
            <label className="block text-[10.5px] font-bold text-ink-600">
              Approved template
              <select
                value={selectedKey}
                disabled={loadingTemplates || templates.length === 0}
                onChange={(event) => setSelectedKey(event.target.value)}
                className="mt-1.5 w-full rounded-md border border-line bg-white px-3 py-2.5 text-[12px] text-ink-900 outline-none focus:border-primary"
              >
                {templates.length === 0 && <option value="">{loadingTemplates ? "Loading templates…" : "No approved templates found"}</option>}
                {templates.map((template) => (
                  <option key={templateKey(template)} value={templateKey(template)} disabled={!template.supported}>
                    {template.name} · {template.language}{template.supported ? "" : " · not supported in CRM"}
                  </option>
                ))}
              </select>
            </label>
            {!templatesConfigured && (
              <p className="text-[10.5px] font-semibold text-danger">Add WHATSAPP_BUSINESS_ACCOUNT_ID to load approved templates.</p>
            )}
            {selectedTemplate && (
              <div className="rounded-md border border-line bg-slate-50 px-3 py-2.5 text-[11px] text-ink-700">
                <div className="whitespace-pre-wrap">{selectedTemplate.preview || `[Template: ${selectedTemplate.name}]`}</div>
                {selectedTemplate.unsupportedReason && <p className="mt-2 font-semibold text-danger">{selectedTemplate.unsupportedReason}</p>}
              </div>
            )}
            {selectedTemplate?.parameterGroups.flatMap((group) => Array.from({ length: group.count }, (_, index) => (
              <label key={`${group.type}-${index}`} className="block text-[10.5px] font-bold text-ink-600">
                {group.type === "header" ? "Header" : "Message"} value {index + 1}
                <input
                  value={(group.type === "header" ? headerParameters : bodyParameters)[index] ?? ""}
                  onChange={(event) => updateParameter(group.type, index, event.target.value)}
                  className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-[12px] text-ink-900 outline-none focus:border-primary"
                />
              </label>
            )))}
          </div>
        )}

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          <div>
            {error && <p role="alert" className="text-[10.5px] font-bold text-danger">{error}</p>}
            {status && <p role="status" className="text-[10.5px] font-bold text-success">{status}</p>}
          </div>
          <button
            type="button"
            disabled={sending || !(textReady || templateReady)}
            onClick={() => void send()}
            className="h-9 rounded-md bg-[#25D366] px-4 text-[11.5px] font-black text-white hover:bg-[#1fb85a] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? "Sending…" : mode === "template" ? "Send template" : "Send WhatsApp"}
          </button>
        </div>
      </div>
    </section>
  );
}

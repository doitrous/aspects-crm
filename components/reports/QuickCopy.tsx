"use client";

import { useState, type RefObject } from "react";
import { reportImageDimensions } from "@/lib/reports/imageDimensions";

function copyComputedStyles(source: Element, clone: Element) {
  const computed = window.getComputedStyle(source);
  const cloneElement = clone as HTMLElement;
  for (const property of Array.from(computed)) {
    cloneElement.style.setProperty(property, computed.getPropertyValue(property), computed.getPropertyPriority(property));
  }
  const sourceChildren = Array.from(source.children);
  const cloneChildren = Array.from(clone.children);
  sourceChildren.forEach((child, index) => {
    if (cloneChildren[index]) copyComputedStyles(child, cloneChildren[index]);
  });
}

async function renderElement(node: HTMLElement): Promise<Blob> {
  const width = Math.max(1000, node.scrollWidth);
  const height = Math.max(700, node.scrollHeight);
  const clone = node.cloneNode(true) as HTMLElement;
  copyComputedStyles(node, clone);
  clone.querySelectorAll("[data-copy-exclude]").forEach((element) => element.remove());
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.maxHeight = "none";
  clone.style.overflow = "visible";
  clone.style.background = "#f8fafc";

  const serialized = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${serialized}</div></foreignObject></svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.src = url;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Unable to render the report"));
    });
    const dimensions = reportImageDimensions(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    context.scale(dimensions.scale, dimensions.scale);
    context.fillStyle = "#f8fafc";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Unable to create the image")), "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function downloadPng(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `aspects-clinica-report-${new Date().toISOString().slice(0, 10)}.png`;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * Start the clipboard write while the click still owns browser activation.
 * Rendering can take long enough for Chromium/Safari to revoke that activation,
 * so ClipboardItem receives the pending PNG instead of an already-awaited blob.
 */
export async function copyElementImage(node: HTMLElement): Promise<"copied" | "downloaded"> {
  const png = renderElement(node);
  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      // Promise-backed items preserve the original click activation while a
      // large dashboard is still rendering (Chromium and modern Safari).
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      return "copied";
    } catch (pendingItemError) {
      // Some WebKit/embedded Chromium builds reject promise-backed items but
      // accept a resolved Blob. Try that form before falling back to a PNG.
      const blob = await png;
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        return "copied";
      } catch (resolvedItemError) {
        console.warn("Image clipboard unavailable; downloaded the generated PNG instead.", { pendingItemError, resolvedItemError });
        downloadPng(blob);
        return "downloaded";
      }
    }
  }
  downloadPng(await png);
  return "downloaded";
}

export async function downloadElementImage(node: HTMLElement): Promise<void> {
  downloadPng(await renderElement(node));
}

export function QuickCopy({ text, target }: { text: string; target: RefObject<HTMLElement | null> }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<void | string>, success: string, failure: string) {
    setBusy(true);
    setMessage("");
    try {
      const outcome = await work();
      setMessage(outcome ?? success);
    } catch (error) {
      console.error("Report export failed", error);
      setMessage(failure);
    } finally {
      setBusy(false);
    }
  }

  return <div data-copy-exclude className="flex flex-wrap items-center gap-2">
    <button disabled={busy} onClick={() => void run(() => navigator.clipboard.writeText(text), "Text copied", "Text copy failed — select the report text and copy manually")} className="h-8 rounded-control border border-line-soft bg-white px-3 text-[11.5px] font-bold text-ink-700 disabled:opacity-60">Copy text</button>
    <button disabled={busy || !target.current} onClick={() => void run(async () => {
      if (!target.current) throw new Error("Report unavailable");
      const result = await copyElementImage(target.current);
      return result === "downloaded" ? "Clipboard blocked — PNG downloaded instead" : undefined;
    }, "Full report image copied", "Image generation failed — reload the report and try again")} className="h-8 rounded-control bg-primary px-3 text-[11.5px] font-bold text-white disabled:opacity-60">{busy ? "Preparing…" : "Copy image"}</button>
    <button disabled={busy || !target.current} onClick={() => void run(async () => {
      if (!target.current) throw new Error("Report unavailable");
      await downloadElementImage(target.current);
    }, "Report PNG downloaded", "Image generation failed — reload the report and try again")} className="h-8 rounded-control border border-line-soft bg-white px-3 text-[11.5px] font-bold text-ink-700 disabled:opacity-60">Download PNG</button>
    {message && <span className="text-[10.5px] font-bold text-ink-500">{message}</span>}
  </div>;
}

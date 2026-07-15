"use client";

import { useState, type RefObject } from "react";

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
    const maxWidth = 1800;
    const scale = Math.min(2, maxWidth / width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    context.scale(scale, scale);
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

/**
 * Start the clipboard write while the click still owns browser activation.
 * Rendering can take long enough for Chromium/Safari to revoke that activation,
 * so ClipboardItem receives the pending PNG instead of an already-awaited blob.
 */
export async function copyElementImage(node: HTMLElement): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("Image clipboard is not supported by this browser");
  }
  const png = renderElement(node);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

export function QuickCopy({ text, target }: { text: string; target: RefObject<HTMLElement | null> }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<void>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await work();
      setMessage(success);
    } catch {
      setMessage("Copy failed — allow clipboard access and try again");
    } finally {
      setBusy(false);
    }
  }

  return <div data-copy-exclude className="flex flex-wrap items-center gap-2">
    <button disabled={busy} onClick={() => void run(() => navigator.clipboard.writeText(text), "Text copied")} className="h-8 rounded-control border border-line-soft bg-white px-3 text-[11.5px] font-bold text-ink-700 disabled:opacity-60">Copy text</button>
    <button disabled={busy || !target.current} onClick={() => void run(async () => {
      if (!target.current) throw new Error("Report unavailable");
      await copyElementImage(target.current);
    }, "Full report image copied")} className="h-8 rounded-control bg-primary px-3 text-[11.5px] font-bold text-white disabled:opacity-60">{busy ? "Copying…" : "Copy image"}</button>
    {message && <span className="text-[10.5px] font-bold text-ink-500">{message}</span>}
  </div>;
}

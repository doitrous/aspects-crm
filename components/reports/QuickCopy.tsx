"use client";

import { useState } from "react";

export function QuickCopy({ text }: { text: string }) {
  const [message, setMessage] = useState("");
  async function image() {
    const canvas = document.createElement("canvas"); canvas.width = 1000; canvas.height = 700;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#ffffff"; ctx.fillRect(0,0,1000,700); ctx.fillStyle="#4338ca"; ctx.fillRect(0,0,1000,14); ctx.fillStyle="#101828"; ctx.font="bold 28px sans-serif"; ctx.fillText("Aspects Clinica · Auditor Report",40,65); ctx.font="18px sans-serif";
    let y=110; for(const original of text.split("\n")){ let line=original; while(line.length>85){ctx.fillText(line.slice(0,85),40,y); line=line.slice(85); y+=28;} ctx.fillText(line,40,y); y+=28; if(y>670) break; }
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob((b)=>b?resolve(b):reject(new Error("Unable to render")),"image/png")); await navigator.clipboard.write([new ClipboardItem({"image/png":blob})]); setMessage("Image copied");
  }
  return <div className="flex items-center gap-2"><button onClick={async()=>{await navigator.clipboard.writeText(text);setMessage("Text copied");}} className="h-8 rounded-control border border-line-soft bg-white px-3 text-[11.5px] font-bold text-ink-700">Copy text</button><button onClick={image} className="h-8 rounded-control bg-primary px-3 text-[11.5px] font-bold text-white">Copy image</button>{message&&<span className="text-[10.5px] font-bold text-emerald-700">{message}</span>}</div>;
}

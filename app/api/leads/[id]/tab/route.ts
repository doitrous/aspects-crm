import { NextResponse } from "next/server";
import { requireSession } from "@/lib/data/session";
import { loadLeadTab } from "@/lib/loadLeadDetail";

const TABS = new Set(["Overview", "Messenger", "WhatsApp", "Comments", "Follow-Up", "Booking", "Payments / Financials", "Payments", "Log"]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireSession();
  const { id } = await params;
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") ?? "";

  if (!TABS.has(tab)) {
    return NextResponse.json({ error: "Unknown lead tab." }, { status: 400 });
  }

  try {
    const data = await loadLeadTab(
      id,
      tab as "Overview" | "Messenger" | "WhatsApp" | "Comments" | "Follow-Up" | "Booking" | "Payments / Financials" | "Payments" | "Log",
    );
    if (!data) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
    return NextResponse.json(data);
  } catch (error) {
    console.error("lead tab load failed", { id, tab, error });
    return NextResponse.json({ error: "Could not load this lead tab. Please try again." }, { status: 500 });
  }
}

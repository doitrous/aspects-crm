import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { getLeadsPage } from "@/lib/data";
import { requireSession } from "@/lib/data/session";

export async function GET(request: Request) {
  const { effective: user } = await requireSession();
  if (!can(user.role, "leads.edit")) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const exclude = url.searchParams.get("exclude") ?? "";
  if (q.length < 2) return NextResponse.json({ leads: [] });
  const result = await getLeadsPage({ q, page: 1, pageSize: 12 });
  return NextResponse.json({
    leads: result.leads.filter((lead) => lead.id !== exclude).slice(0, 10).map((lead) => ({
      id: lead.id,
      mrn: lead.mrn ?? null,
      name: lead.patientName,
      phone: lead.phone,
    })),
  });
}

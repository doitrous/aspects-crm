import Link from "next/link";
import { Topbar } from "@/components/shell/Topbar";
import { requireSession } from "@/lib/data/session";
import { AccountManager } from "./AccountManager";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const { real: user } = await requireSession();
  return <><Topbar title="Manage Account" /><main className="min-h-0 flex-1 overflow-auto bg-canvas p-4 sm:p-5"><div className="mx-auto max-w-5xl"><Link href="/settings" className="mb-4 inline-flex text-[11.5px] font-bold text-primary hover:underline">← CRM settings</Link><div className="mb-5 rounded-xl bg-ink-900 p-5 text-white"><div className="text-[10px] font-black uppercase tracking-[0.16em] text-white/50">Your account</div><h1 className="mt-1 text-[24px] font-black">Profile & security</h1><p className="mt-1 text-[12px] text-white/60">Manage the identity shown inside the CRM and your own login password.</p></div><AccountManager user={user} /></div></main></>;
}

import { notFound } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { EmailSettingsWorkspace } from "@/components/email/EmailSettingsWorkspace";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/data/session";
import { listEmailLog } from "@/lib/data/emailData";
import { listEmailRules } from "@/lib/data/settingsData";
import { emailConfigured } from "@/lib/email/resend";

export const dynamic = "force-dynamic";
export default async function EmailSettingsPage() { const { effective:user }=await requireSession(); if(!can(user.role,"email.view")) notFound(); const [rules,rows]=await Promise.all([listEmailRules(),listEmailLog()]); return <><Topbar title="Settings / Email"/><div className="flex-1 overflow-auto px-[18px] py-4"><EmailSettingsWorkspace rules={rules} rows={rows} canManage={can(user.role,"email.manage")} configured={emailConfigured()}/></div></>; }

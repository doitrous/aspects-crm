import { notFound } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { FinancialSettingsManager } from "@/components/financial/FinancialSettingsManager";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/data/session";
import { financialSettingsData } from "@/lib/data/financialSettings";

export const dynamic = "force-dynamic";

export default async function FinancialSettingsPage() {
  const { effective: user } = await requireSession();
  if (!can(user.role, "financial.editRules")) notFound();
  const data = await financialSettingsData();
  return (
    <>
      <Topbar title="Financial Settings" />
      <div className="flex-1 overflow-auto px-[18px] py-4">
        <FinancialSettingsManager data={data} />
      </div>
    </>
  );
}

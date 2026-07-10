import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { BulkImport } from "@/components/financial/BulkImport";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/data/session";

export const dynamic = "force-dynamic";

export default async function BulkImportPage() {
  const { effective: user } = await requireSession();
  if (!can(user.role, "financial.bulkImport")) notFound();

  return (
    <>
      <Topbar title="Bulk Import" />
      <div className="flex-1 overflow-auto px-[18px] py-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Link href="/financial" className="text-[12px] font-semibold text-primary hover:underline">
            Back to Financial Dashboard
          </Link>
        </div>
        <p className="mb-3 max-w-3xl text-[12px] text-ink-500">
          Imports write into the same lead, quote, payment, and audit tables used by manual CRM entry. Existing leads are matched first by
          Lead ID, MRN, then phone; rows with a patient name and phone can create a canonical manual lead after preview confirmation.
        </p>
        <BulkImport />
      </div>
    </>
  );
}

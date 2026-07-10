import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { BulkImport } from "@/components/financial/BulkImport";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/data/session";

export const dynamic = "force-dynamic";

/**
 * Financial bulk import (§36). Admin/Auditor only (`financial.bulkImport`).
 * Compatibility entry point for the dedicated `/bulk-import` page. Imports into
 * canonical lead + financial tables via the same paths used by manual entry.
 */
export default async function FinancialImportPage() {
  const { effective: user } = await requireSession();
  if (!can(user.role, "financial.bulkImport")) notFound();

  return (
    <>
      <Topbar title="Financial bulk import" />
      <div className="flex-1 overflow-auto px-[18px] py-4">
        <div className="mb-3">
          <Link href="/financial" className="text-[12px] font-semibold text-primary hover:underline">← Back to Financial Dashboard</Link>
        </div>
        <p className="mb-3 max-w-3xl text-[12px] text-ink-500">
          Rows are matched first by Lead ID, MRN, then phone. If no existing lead is found, a row with patient name and phone can create a
          canonical manual lead after preview confirmation. Unsupported complex finance columns are flagged for review rather than silently
          discarded.
        </p>
        <BulkImport />
      </div>
    </>
  );
}

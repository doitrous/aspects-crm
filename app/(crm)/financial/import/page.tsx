import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { BulkImport } from "@/components/financial/BulkImport";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/data/session";

export const dynamic = "force-dynamic";

/**
 * Financial bulk import (§36). Admin/Auditor only (`financial.bulkImport`).
 * Imports into the canonical financial tables via the same `saveQuote` /
 * `addTransaction` path used by manual entry — never an isolated dataset.
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
          Rows are matched to <span className="font-semibold">existing</span> leads by Lead ID → MRN → phone and never auto-create leads,
          so an import cannot spawn duplicates. Unmatched rows are reported for review. A quoted price below a moderator&apos;s discount
          ceiling is flagged <span className="font-semibold">needs approval</span> rather than force-applied. Multiple payment methods,
          installments, external costs and multi-doctor compensation per row are not represented by this simple importer and are flagged,
          not silently dropped.
        </p>
        <BulkImport />
      </div>
    </>
  );
}

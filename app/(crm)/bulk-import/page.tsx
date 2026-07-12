import { notFound } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { PatientBulkImport } from "@/components/leads/PatientBulkImport";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/data/session";

export const dynamic = "force-dynamic";

export default async function BulkImportPage() {
  const { effective: user } = await requireSession();
  if (!can(user.role, "leads.bulkImport")) notFound();

  return (
    <>
      <Topbar title="Bulk Import" />
      <div className="flex-1 overflow-auto px-[18px] py-4">
        <p className="mb-4 max-w-3xl text-[12px] text-ink-500">
          Upload patient spreadsheets as ordinary CRM leads. The file is read directly, its columns remain editable in Preview Mapping,
          and nothing is written until you review and confirm the mapped patient rows.
        </p>
        <PatientBulkImport />
      </div>
    </>
  );
}

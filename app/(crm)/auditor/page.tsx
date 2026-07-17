import { notFound } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { IngestionFailureAlert } from "@/components/ingestion/IngestionFailureAlert";
import { AuditorReport } from "@/components/auditor/AuditorReport";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/data/session";
import {
  getAuditReportDetail,
  droppedLeadsForDate,
  previousDayIso,
  auditorFilterOptions,
  resolveAuditorScope,
  scopedSnapshotPreview,
  auditorTrend,
} from "@/lib/data/auditor";
import { listIngestionFailures } from "@/lib/data/settingsData";

export const dynamic = "force-dynamic";

/** YYYY-MM-DD guard so a bad query param cannot reach the DB layer. */
function parseDate(v: string | undefined): string {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : previousDayIso();
}

/**
 * Auditor Dashboard (§A). Reviews a single day's activity — defaulting to the
 * previous day, the original workflow — with real generate / override /
 * finalize actions. The saved daily report is clinic-wide; the doctor/specialty
 * filters produce a live scoped breakdown from the same source data.
 */
export default async function AuditorPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; doctorId?: string; specialtyId?: string }>;
}) {
  const { effective: user } = await requireSession();
  if (!can(user.role, "reports.view")) notFound();

  const sp = await searchParams;
  const date = parseDate(sp.date);
  const scope = await resolveAuditorScope({ doctorId: sp.doctorId, specialtyId: sp.specialtyId });

  const [detail, options, ingestionFailures] = await Promise.all([
    getAuditReportDetail(date),
    auditorFilterOptions(),
    listIngestionFailures(),
  ]);
  const [dropped, scopedPreview, trend] = await Promise.all([
    droppedLeadsForDate(date, scope ?? undefined),
    scope ? scopedSnapshotPreview(date, scope) : Promise.resolve(null),
    auditorTrend(date, scope ?? undefined),
  ]);

  return (
    <>
      <Topbar title="Auditor Dashboard" />
      <div className="flex-1 overflow-auto px-[18px] py-4">
        <IngestionFailureAlert failures={ingestionFailures} detailsHref="/settings?section=ingestion"/>
        <AuditorReport
          date={date}
          detail={detail}
          droppedLeads={dropped}
          canGenerate={can(user.role, "reports.generate")}
          options={options}
          selectedDoctorId={sp.doctorId ?? ""}
          selectedSpecialtyId={sp.specialtyId ?? ""}
          scopedPreview={scopedPreview}
          trend={trend}
        />
      </div>
    </>
  );
}

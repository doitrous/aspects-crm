import { StageLeadsPage } from "@/components/leads/StageLeadsPage";

export const dynamic = "force-dynamic";

export default function BookedLeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <StageLeadsPage searchParams={searchParams} stage="booked" title="Booked" basePath="/booked" />;
}

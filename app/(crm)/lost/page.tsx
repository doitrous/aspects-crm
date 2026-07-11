import { StageLeadsPage } from "@/components/leads/StageLeadsPage";

export const dynamic = "force-dynamic";

export default function LostLeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <StageLeadsPage searchParams={searchParams} stage="lost" title="Lost" basePath="/lost" />;
}

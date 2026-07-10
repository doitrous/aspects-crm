export type CrmDataSource = "supabase" | "mock";

export function resolveCrmDataSource(
  requested = process.env.CRM_DATA_SOURCE,
  nodeEnv = process.env.NODE_ENV,
): CrmDataSource {
  if (requested === "mock") {
    if (nodeEnv === "production") {
      throw new Error("CRM_DATA_SOURCE=mock is not allowed in production.");
    }
    return "mock";
  }
  return "supabase";
}

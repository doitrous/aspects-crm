import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/data/session";
import { listUsers, userRoleHistory, type RoleHistoryEntry } from "@/lib/data/users";

export const dynamic = "force-dynamic";

function describe(e: RoleHistoryEntry): string {
  switch (e.changeType) {
    case "role":
      return `Role changed from ${e.oldRole ?? "—"} to ${e.newRole ?? "—"}`;
    case "activate":
      return "Account activated";
    case "deactivate":
      return "Account deactivated";
    case "invite":
      return "User invited";
    case "create":
      return "Account created";
    default:
      return e.changeType;
  }
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Role + activation history for one CRM account (spec §21). */
export default async function UserHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { effective: viewer } = await requireSession();
  if (!can(viewer.role, "users.view")) notFound();

  const { id } = await params;
  const user = (await listUsers()).find((u) => u.id === id);
  if (!user) notFound();

  const history = await userRoleHistory(id);

  return (
    <>
      <Topbar title={user.name} />
      <div className="min-h-0 flex-1 overflow-auto bg-canvas p-5">
        <Link
          href="/settings/users"
          className="mb-3 inline-block text-[12px] font-semibold text-primary hover:underline"
        >
          ← All users
        </Link>

        <Card>
          <CardHeader title="Account" />
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 px-4 py-3 text-[12.5px]">
            <dt className="font-semibold text-ink-700">Email</dt>
            <dd className="text-ink-600">{user.email || "—"}</dd>
            <dt className="font-semibold text-ink-700">Role</dt>
            <dd className="capitalize text-ink-600">
              {user.role}
              {user.dbRole === "owner_admin" && (
                <span className="ml-2 rounded-pill bg-badge-indigo/10 px-1.5 py-0.5 text-[10px] font-semibold text-badge-indigo">
                  owner
                </span>
              )}
            </dd>
            <dt className="font-semibold text-ink-700">Status</dt>
            <dd className="text-ink-600">{user.isActive ? "Active" : "Inactive"}</dd>
            <dt className="font-semibold text-ink-700">Sign-in</dt>
            <dd className="text-ink-600">
              {user.authUserId ? "Linked to a Supabase Auth account" : "No auth account linked"}
            </dd>
          </dl>
        </Card>

        <Card className="mt-4">
          <CardHeader title={`Role & status history (${history.length})`} />
          {history.length === 0 ? (
            <EmptyState
              title="No changes recorded"
              hint="Role changes and activations made in the CRM appear here."
            />
          ) : (
            <ul>
              {history.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line-soft px-4 py-2.5 last:border-b-0"
                >
                  <span className="text-[12.5px] font-semibold text-ink-900">{describe(e)}</span>
                  <span className="text-[11.5px] text-ink-500">by {e.changedByName}</span>
                  <span className="ml-auto text-[11.5px] tabular-nums text-ink-400">
                    {when(e.createdAt)}
                  </span>
                  {e.reason && (
                    <span className="w-full text-[11.5px] italic text-ink-600">“{e.reason}”</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

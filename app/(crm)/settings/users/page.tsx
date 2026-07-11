import { notFound } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { Card, CardHeader } from "@/components/ui/Card";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/data/session";
import { listUnlinkedAuthUsers, listUsersPage, type UserFilters } from "@/lib/data/users";
import type { Role } from "@/lib/types";
import { UsersTable, type UserRow } from "./UsersTable";
import { UnlinkedAuthUsers } from "./UnlinkedAuthUsers";
import { PaginationNav } from "@/components/ui/PaginationNav";

export const dynamic = "force-dynamic";

const ROLE_OPTIONS = ["all", "admin", "auditor", "moderator", "viewer"] as const;
const STATUS_OPTIONS = ["all", "active", "inactive"] as const;

function parseRole(v: string | undefined): Role | "all" {
  return (ROLE_OPTIONS as readonly string[]).includes(v ?? "") ? (v as Role | "all") : "all";
}
function parseStatus(v: string | undefined): "all" | "active" | "inactive" {
  return (STATUS_OPTIONS as readonly string[]).includes(v ?? "")
    ? (v as "all" | "active" | "inactive")
    : "all";
}

/**
 * Admin Settings → Users (spec §21).
 *
 * Read access is gated on `users.view`; the mutations the table offers are
 * *independently* re-authorized server-side in `lib/data/users.ts`, so an
 * auditor (who may view but not mutate) cannot escalate by posting the form.
 */
export default async function UsersPage({
  searchParams,
}: {
    searchParams: Promise<{ q?: string; role?: string; status?: string; page?: string }>;
}) {
  const { effective: user } = await requireSession();
  if (!can(user.role, "users.view")) notFound();

  const sp = await searchParams;
  const filters: UserFilters = {
    q: sp.q,
    role: parseRole(sp.role),
    status: parseStatus(sp.status),
  };

  const requestedPage = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const [usersPage, adminsPage] = await Promise.all([
    listUsersPage(filters, requestedPage, 30),
    listUsersPage({ role: "admin", status: "active" }, 1, 1),
  ]);
  const users = usersPage.users;
  const rows: UserRow[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    dbRole: u.dbRole,
    isActive: u.isActive,
    linkedToAuth: u.authUserId !== null,
  }));

  const canMutate = can(user.role, "users.changeRole");
  const canInvite = can(user.role, "users.invite");
  const activeAdmins = adminsPage.total;
  const pageCount = Math.max(1, Math.ceil(usersPage.total / usersPage.pageSize));
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    if (sp.q) params.set("q", sp.q);
    if (filters.role && filters.role !== "all") params.set("role", filters.role);
    if (filters.status && filters.status !== "all") params.set("status", filters.status);
    params.set("page", String(page));
    return `/settings/users?${params.toString()}`;
  };

  // Only admins (who may invite) see + resolve unlinked Auth users. The Admin
  // API read is server-only; a failure here must not break the roster.
  let unlinkedAuthUsers: Awaited<ReturnType<typeof listUnlinkedAuthUsers>> = [];
  if (canInvite) {
    try {
      unlinkedAuthUsers = await listUnlinkedAuthUsers();
    } catch {
      unlinkedAuthUsers = [];
    }
  }

  return (
    <>
      <Topbar title="Users & Roles" />
      <div className="min-h-0 flex-1 overflow-auto bg-canvas p-5">
        <Card>
          <CardHeader
            title={`Users (${rows.length})`}
            action={
              <span className="text-[11.5px] text-ink-500">
                {activeAdmins} active admin{activeAdmins === 1 ? "" : "s"}
              </span>
            }
          />

          <form method="get" className="flex flex-wrap gap-2 border-b border-line-soft px-4 py-3">
            <input
              name="q"
              defaultValue={sp.q ?? ""}
              placeholder="Search name or email"
              className="h-[32px] min-w-[200px] flex-1 rounded-control border border-line px-2.5 text-[12px] text-ink-900 outline-none focus:border-primary"
            />
            <select
              name="role"
              defaultValue={filters.role}
              className="h-[32px] rounded-control border border-line px-2 text-[12px] capitalize text-ink-700 outline-none focus:border-primary"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r === "all" ? "All roles" : r}
                </option>
              ))}
            </select>
            <select
              name="status"
              defaultValue={filters.status}
              className="h-[32px] rounded-control border border-line px-2 text-[12px] capitalize text-ink-700 outline-none focus:border-primary"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "All statuses" : s}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="h-[32px] rounded-control bg-primary px-3 text-[12px] font-semibold text-white hover:bg-primary-hover"
            >
              Filter
            </button>
          </form>

          {!canMutate && (
            <p className="border-b border-line-soft bg-canvas px-4 py-2 text-[11.5px] text-ink-500">
              You can view users and their history, but only an admin may change access.
            </p>
          )}
          <PaginationNav page={requestedPage} pageCount={pageCount} hrefForPage={pageHref} summary={`Page ${requestedPage} of ${pageCount} · ${usersPage.total} users`} />
          <UsersTable users={rows} currentUserId={user.id} canMutate={canMutate} />
          <PaginationNav page={requestedPage} pageCount={pageCount} hrefForPage={pageHref} summary={`Page ${requestedPage} of ${pageCount} · ${usersPage.total} users`} />
        </Card>

        {canInvite && <UnlinkedAuthUsers users={unlinkedAuthUsers} />}

        <p className="mt-3 text-[11.5px] text-ink-500">
          Accounts are created in Supabase Auth and linked to a CRM profile by{" "}
          <code className="rounded bg-line-faint px-1">crm_users.auth_user_id</code>. A profile with
          no linked auth account cannot sign in; a deactivated profile is locked out on its next
          request.
        </p>
      </div>
    </>
  );
}

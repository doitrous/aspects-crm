export function Topbar({
  title,
  overdue,
  unread,
  action,
}: {
  title: string;
  overdue?: number;
  unread?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-[58px] flex-none items-center gap-3 border-b border-line-soft px-[18px]">
      <div className="text-[16px] font-bold text-ink-900">{title}</div>

      <div className="flex-1" />

      {overdue ? (
        <div className="flex items-center gap-1.5 rounded-pill bg-danger-bg px-2.5 py-1.5 text-[11px] font-semibold text-danger">
          <span className="h-[7px] w-[7px] rounded-full bg-danger-dot" />
          {overdue} overdue
        </div>
      ) : null}

      {unread ? (
        <div className="flex items-center gap-1.5 rounded-pill bg-primary-soft px-2.5 py-1.5 text-[11px] font-semibold text-primary">
          {unread} unread
        </div>
      ) : null}

      {action}
    </div>
  );
}

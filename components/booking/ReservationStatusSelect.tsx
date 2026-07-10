"use client";

import { useState, useTransition } from "react";
import { updateReservationStatusAction } from "@/app/(crm)/booking/actions";
import type { ReservationStatus } from "@/lib/types";

const STATUSES: { value: ReservationStatus; label: string }[] = [
  { value: "reserved", label: "Reserved" },
  { value: "confirmed", label: "Confirmed" },
  { value: "attended", label: "Attended" },
  { value: "no_show", label: "No-show" },
  { value: "rescheduled", label: "Rescheduled" },
  { value: "cancelled", label: "Cancelled" },
];

export function ReservationStatusSelect({
  appointmentId,
  leadId,
  status,
}: {
  appointmentId: string;
  leadId?: string;
  status: ReservationStatus;
}) {
  const [value, setValue] = useState(status);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as ReservationStatus;
          setValue(next);
          startTransition(async () => {
            setError(null);
            const result = await updateReservationStatusAction(appointmentId, next, leadId);
            if (result.error) {
              setError(result.error);
              setValue(status);
            }
          });
        }}
        className="h-8 rounded-control border border-line bg-panel px-2 text-[11.5px] text-ink-700 disabled:opacity-60"
      >
        {STATUSES.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
      {error && <span className="max-w-[180px] text-[10px] text-danger">{error}</span>}
    </div>
  );
}

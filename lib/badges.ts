import type { BookingStatus, EscalationSeverity, PipelineStage } from "@/lib/types";

export interface BadgeStyle {
  label: string;
  bg: string;
  fg: string;
  dot?: string;
}

export const STAGE_META: Record<PipelineStage, BadgeStyle> = {
  new: { label: "New Lead", bg: "#eff4ff", fg: "#175cd3" },
  qualified: { label: "Qualified", bg: "#eef4ff", fg: "#3538cd" },
  booked: { label: "Booked", bg: "#ecfdf3", fg: "#067647" },
  follow_up: { label: "Follow-Up", bg: "#fffaeb", fg: "#b54708" },
  post_op: { label: "Post-Op F/U", bg: "#fdf2fa", fg: "#c11574" },
  lost: { label: "Lost", bg: "#f2f4f7", fg: "#667085" },
};

export const STAGE_ORDER: PipelineStage[] = [
  "new",
  "qualified",
  "booked",
  "follow_up",
  "post_op",
  "lost",
];

export const BOOKING_META: Record<BookingStatus, BadgeStyle> = {
  none: { label: "No booking", bg: "#f2f4f7", fg: "#667085" },
  unconfirmed: { label: "Unconfirmed", bg: "#fffaeb", fg: "#b54708" },
  confirmed: { label: "Confirmed", bg: "#ecfdf3", fg: "#067647" },
  completed: { label: "Completed", bg: "#eff4ff", fg: "#175cd3" },
  cancelled: { label: "Cancelled", bg: "#fef3f2", fg: "#b42318" },
  no_show: { label: "No-show", bg: "#fef3f2", fg: "#b42318" },
};

export const SEVERITY_META: Record<EscalationSeverity, BadgeStyle> = {
  low: { label: "Low", bg: "#f2f4f7", fg: "#667085" },
  medium: { label: "Medium", bg: "#fffaeb", fg: "#b54708" },
  high: { label: "High", bg: "#fef3f2", fg: "#b42318" },
  critical: { label: "Critical", bg: "#fef3f2", fg: "#b42318", dot: "#f04438" },
};

export const PLATFORM_META: Record<string, { label: string; icon: string; fg: string; bg: string }> = {
  facebook: { label: "Facebook", icon: "f", fg: "#175cd3", bg: "#eff4ff" },
  instagram: { label: "Instagram", icon: "◎", fg: "#c11574", bg: "#fdf2fa" },
  whatsapp: { label: "WhatsApp", icon: "✆", fg: "#067647", bg: "#ecfdf3" },
  web: { label: "Website", icon: "⌘", fg: "#3538cd", bg: "#eef4ff" },
  referral: { label: "Referral", icon: "↗", fg: "#667085", bg: "#f2f4f7" },
  walk_in: { label: "Walk-in", icon: "🚶", fg: "#667085", bg: "#f2f4f7" },
  phone: { label: "Phone", icon: "☎", fg: "#667085", bg: "#f2f4f7" },
};

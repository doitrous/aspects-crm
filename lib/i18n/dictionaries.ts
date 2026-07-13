import type { Locale } from "@/lib/i18n/config";

/**
 * Translation dictionaries. Coverage is the app shell (navigation, top bars,
 * common actions) plus operational section headings — the surfaces a bilingual
 * operator navigates by. Patient-generated content is never machine-translated.
 * Add keys here; `t()` falls back to English, then to the key itself, so a
 * missing translation degrades gracefully rather than throwing.
 */
export type Dict = Record<string, string>;

const en: Dict = {
  // Nav
  "nav.dashboard": "Dashboard",
  "nav.newLeads": "New Leads",
  "nav.qualified": "Qualified",
  "nav.booked": "Booked",
  "nav.database": "Database",
  "nav.followUp": "Follow-Up",
  "nav.postOp": "Post-Op F/U",
  "nav.lost": "Lost",
  "nav.duplicates": "Duplicates",
  "nav.escalations": "Escalations",
  "nav.reservations": "Website Reservations",
  "nav.calendar": "Calendar",
  "nav.financial": "Financial",
  "nav.financialSettings": "Financial Settings",
  "nav.bulkImport": "Bulk Import",
  "nav.auditor": "Auditor",
  "nav.reports": "Reports",
  "nav.emails": "Emails",
  "nav.auditLogs": "Audit Logs",
  "nav.users": "Users & Roles",
  "nav.settings": "Settings",
  "nav.section.workspace": "Workspace",
  "nav.section.intake": "Intake",
  "nav.section.pipeline": "Pipeline",
  "nav.section.care": "Care",
  "nav.section.data": "Data",
  "nav.section.operations": "Operations",
  "nav.section.finance": "Finance",
  "nav.section.quality": "Quality",
  "nav.section.administration": "Administration",
  // Shell
  "shell.crm": "CRM",
  "pref.language": "Language",
  "pref.theme": "Theme",
  "pref.light": "Light",
  "pref.dark": "Dark",
  "pref.english": "English",
  "pref.arabic": "العربية",
  // Common
  "common.save": "Save",
  "common.saving": "Saving…",
  "common.cancel": "Cancel",
  "common.filter": "Filter",
  "common.search": "Search",
  "common.all": "All",
  "common.active": "Active",
  "common.status": "Status",
  // Activity log
  "activity.title": "Activity Log",
  "activity.subtitle": "Every recorded change — who, when, old → new. System actions are marked.",
  "activity.when": "When",
  "activity.actor": "User",
  "activity.action": "Action",
  "activity.entity": "Entity",
  "activity.change": "Change",
  "activity.system": "System",
  "activity.none": "No activity recorded yet.",
};

const ar: Dict = {
  "nav.dashboard": "لوحة التحكم",
  "nav.newLeads": "عملاء جدد",
  "nav.qualified": "عملاء مؤهلون",
  "nav.booked": "المرضى المحجوزون",
  "nav.database": "قاعدة البيانات",
  "nav.followUp": "متابعة العملاء",
  "nav.postOp": "متابعة ما بعد العملية",
  "nav.lost": "العملاء المفقودون",
  "nav.duplicates": "التكرارات",
  "nav.escalations": "التصعيدات",
  "nav.reservations": "حجوزات الموقع",
  "nav.calendar": "التقويم",
  "nav.financial": "المالية",
  "nav.financialSettings": "إعدادات المالية",
  "nav.bulkImport": "استيراد جماعي",
  "nav.auditor": "المدقق",
  "nav.reports": "التقارير",
  "nav.emails": "الرسائل",
  "nav.auditLogs": "سجلات التدقيق",
  "nav.users": "المستخدمون والصلاحيات",
  "nav.settings": "الإعدادات",
  "nav.section.workspace": "مساحة العمل",
  "nav.section.intake": "استقبال العملاء",
  "nav.section.pipeline": "مسار العملاء",
  "nav.section.care": "الرعاية والمتابعة",
  "nav.section.data": "البيانات",
  "nav.section.operations": "التشغيل",
  "nav.section.finance": "المالية",
  "nav.section.quality": "الجودة والتدقيق",
  "nav.section.administration": "الإدارة",
  "shell.crm": "نظام إدارة العملاء",
  "pref.language": "اللغة",
  "pref.theme": "المظهر",
  "pref.light": "فاتح",
  "pref.dark": "داكن",
  "pref.english": "English",
  "pref.arabic": "العربية",
  "common.save": "حفظ",
  "common.saving": "جارٍ الحفظ…",
  "common.cancel": "إلغاء",
  "common.filter": "تصفية",
  "common.search": "بحث",
  "common.all": "الكل",
  "common.active": "نشط",
  "common.status": "الحالة",
  "activity.title": "سجل النشاط",
  "activity.subtitle": "كل تغيير مُسجَّل — من، ومتى، والقيمة القديمة ← الجديدة. تُميَّز إجراءات النظام.",
  "activity.when": "التوقيت",
  "activity.actor": "المستخدم",
  "activity.action": "الإجراء",
  "activity.entity": "العنصر",
  "activity.change": "التغيير",
  "activity.system": "النظام",
  "activity.none": "لا يوجد نشاط مُسجَّل بعد.",
};

const DICTS: Record<Locale, Dict> = { en, ar };

/** Resolve a translation: locale → English fallback → the key itself. */
export function translate(locale: Locale, key: string): string {
  return DICTS[locale]?.[key] ?? en[key] ?? key;
}

/** A bound translator for one locale. */
export function translatorFor(locale: Locale): (key: string) => string {
  return (key: string) => translate(locale, key);
}

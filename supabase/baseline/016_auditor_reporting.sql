-- Aspects Clinica CRM auditor/reporting module.
-- Apply to the separate CRM Supabase project after 002_crm_workflows_integrations.sql.

set search_path = public, extensions;


do $$
begin
  alter type crm_role add value if not exists 'auditor';
exception when duplicate_object then null;
end $$;

do $$ begin
  create type audit_report_status as enum ('draft', 'submitted', 'approved', 'reopened');
exception when duplicate_object then null;
end $$;

insert into crm_settings (key, value, description, is_editable)
values
  ('auditor_settings', '{"target_cpl":0,"sample_percentage":50,"reply_delay_threshold_minutes":30,"clinic_business_name":"Aspects Clinica","score_categories":["Language/Tone","Accuracy of information provided","Call To Action / Sales Skills","Data Collection from patient","Process compliance"],"weekly_period_start":"monday"}'::jsonb, 'Auditor and reporting settings.', true)
on conflict (key) do update set
  value = coalesce(crm_settings.value, '{}'::jsonb) || excluded.value,
  description = excluded.description,
  is_editable = true,
  updated_at = now();

create table if not exists audit_daily_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  created_by uuid references crm_users(id) on delete set null,
  submitted_by uuid references crm_users(id) on delete set null,
  approved_by uuid references crm_users(id) on delete set null,
  status audit_report_status not null default 'draft',
  auto_metric_snapshot jsonb not null default '{}'::jsonb,
  override_metric_snapshot jsonb not null default '{}'::jsonb,
  notes text,
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_report_sections (
  id uuid primary key default gen_random_uuid(),
  daily_report_id uuid not null references audit_daily_reports(id) on delete cascade,
  section_key text not null,
  title text not null,
  content jsonb not null default '{}'::jsonb,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (daily_report_id, section_key)
);

create table if not exists audit_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  daily_report_id uuid not null references audit_daily_reports(id) on delete cascade,
  metric_key text not null,
  auto_value numeric,
  related_lead_ids uuid[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (daily_report_id, metric_key)
);

create table if not exists audit_metric_overrides (
  id uuid primary key default gen_random_uuid(),
  daily_report_id uuid not null references audit_daily_reports(id) on delete cascade,
  metric_key text not null,
  override_value numeric not null,
  reason text not null,
  created_by uuid references crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (daily_report_id, metric_key)
);

create table if not exists audit_red_flag_conversations (
  id uuid primary key default gen_random_uuid(),
  daily_report_id uuid references audit_daily_reports(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  chat_link text not null,
  category text,
  auditor_comment text not null,
  created_by uuid references crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_ai_review_samples (
  id uuid primary key default gen_random_uuid(),
  daily_report_id uuid not null references audit_daily_reports(id) on delete cascade,
  sample_count integer not null,
  suggested_count integer not null,
  sampled_lead_ids uuid[] not null default '{}',
  random_seed text not null,
  status text not null default 'sampled',
  created_by uuid references crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (daily_report_id)
);

create table if not exists audit_ai_reviews (
  id uuid primary key default gen_random_uuid(),
  daily_report_id uuid not null references audit_daily_reports(id) on delete cascade,
  sample_id uuid references audit_ai_review_samples(id) on delete set null,
  lead_id uuid references leads(id) on delete cascade,
  assessable boolean not null default false,
  not_assessable_reason text,
  scores jsonb not null default '{}'::jsonb,
  total_score numeric,
  summary text,
  suggested_improvements text,
  red_flag_suggestion boolean not null default false,
  raw_ai_output jsonb not null default '{}'::jsonb,
  status text not null default 'suggested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_manual_scores (
  id uuid primary key default gen_random_uuid(),
  daily_report_id uuid not null references audit_daily_reports(id) on delete cascade,
  score_type text not null default 'moderator',
  language_tone numeric not null default 0 check (language_tone between 0 and 5),
  accuracy numeric not null default 0 check (accuracy between 0 and 5),
  call_to_action numeric not null default 0 check (call_to_action between 0 and 5),
  data_collection numeric not null default 0 check (data_collection between 0 and 5),
  process_compliance numeric not null default 0 check (process_compliance between 0 and 5),
  total_score numeric generated always as ((language_tone + accuracy + call_to_action + data_collection + process_compliance) / 5.0) stored,
  notes text,
  created_by uuid references crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (daily_report_id, score_type)
);

create table if not exists audit_report_notes (
  id uuid primary key default gen_random_uuid(),
  daily_report_id uuid not null references audit_daily_reports(id) on delete cascade,
  note_type text not null default 'auditor',
  body text not null,
  created_by uuid references crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_report_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  title text not null,
  language text not null default 'ar',
  body text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists operational_summary_reports (
  id uuid primary key default gen_random_uuid(),
  daily_report_id uuid references audit_daily_reports(id) on delete set null,
  report_type text not null,
  report_date date,
  date_from date,
  date_to date,
  generated_text text not null,
  generated_by uuid references crm_users(id) on delete set null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into audit_report_templates (template_key, title, language, body)
values
  ('moderator_daily_ar', 'تقرير المشرف اليومي', 'ar', 'تقرير المشرف اليومي — [اسم العيادة/العمل] — [التاريخ]\n\nملخص العملاء الجدد اليوم:\nإجمالي العملاء الجدد: [العدد]\nعملاء تم التواصل معهم: [العدد]\nعملاء لم يتم التواصل معهم بعد: [العدد]\nلا يوجد رد: [العدد]\nأرقام خاطئة / غير صالحة: [العدد]\nعملاء مهتمون (Hot Leads): [العدد]\nتم الحجز / التأكيد: [العدد]\nغير مهتمين / تم الخسارة: [العدد]\n\nالحالات العاجلة:\n[اسم العميل]: [الخدمة المطلوبة + الحالة + الخطوة القادمة]\nفي حال عدم وجود حالات عاجلة، يجب كتابة: "لا يوجد"\n\nشكاوى المرضى:\n[اسم المريض/الشكوى]: [تفاصيل الشكوى + الإجراء الذي تم اتخاذه]\nفي حال عدم وجود شكاوى اليوم، يجب كتابة: "لا يوجد"\n\nملاحظات أو مشاكل فنية:\n[أي ملاحظة هامة]\nفي حال عدم وجود ملاحظات، اكتب "لا يوجد"'),
  ('follow_up_daily_ar', 'تقرير مسؤول المتابعة اليومي', 'ar', 'تقرير مسؤول المتابعة اليومي — [اسم العيادة/العمل] — [التاريخ]\n\nملخص المتابعات:\nمتابعات مستحقة اليوم: [العدد]\nمتابعات تم إنجازها: [العدد]\nمتابعات متأخرة/لم تكتمل: [العدد - مع ذكر السبب بالأسفل]\nلا يوجد رد: [العدد]\nمهتمون أو تم الرد مرة أخرى: [العدد]\nتم الحجز / التأكيد: [العدد]\nغير مهتمين / تم الخسارة: [العدد]\n\nتحديثات هامة للمتابعات:\n[اسم العميل]: [آخر رد + الخطوة القادمة]\nفي حال عدم وجود تحديثات، يجب كتابة: "لا يوجد"\n\nحالات تحتاج لتدخل الإدارة أو الطبيب:\n[اسم العميل]: [المشكلة + التدخل المطلوب]\nفي حال عدم وجود حالات، اكتب "لا يوجد"\n\nحالات معلقة:\n[اسم العميل]: [سبب التعليق + تاريخ المتابعة القادم]\nفي حال عدم وجود حالات معلقة، اكتب "لا يوجد"'),
  ('auditor_clinic_daily_ar', 'تقرير التدقيق وحالة العيادة اليومي', 'ar', 'تقرير التدقيق وحالة العيادة اليومي — [اسم العيادة/العمل] — [التاريخ]\n\nمراجعة تقارير الفريق:\nتقرير المشرف (Moderator): [تم الاستلام ومطابق / يوجد نواقص وهي: ...]\nتقرير المتابعة (Follow-Up): [تم الاستلام ومطابق / يوجد نواقص وهي: ...]\nالتناقضات أو الأخطاء التي تم العثور عليها: [عدد الأخطاء بين التقارير والشيت، أو اكتب "لا يوجد"]\n\nصيانة الأجهزة وحالة العيادة:\nحالة الأجهزة الطبية: [جميع الأجهزة تعمل بحالة ممتازة ولا يوجد أي أعطال / أو اذكر العطل]\nطلبات صيانة أو تحديث: [اكتب التفاصيل، أو اكتب "لا يوجد - كل شيء مُحدث وتتم صيانة الأجهزة بانتظام"]\n\nمراجعة البيانات:\nبيانات مفقودة أو غير صحيحة تم تعديلها اليوم: [التفاصيل، أو اكتب "لا يوجد"]\nمهام معلقة من طرفي: [التفاصيل، أو اكتب "لا يوجد"]\n\nالحالات المفتوحة والعاجلة:\n[اسم العميل/الحالة]: [الحالة الحالية + الخطوة القادمة]\nفي حال عدم وجود حالات، اكتب "لا يوجد"\n\nالخلاصة اليومية:\nالوضع العام: [ممتاز / مستقر / يحتاج انتباه / عاجل]\nالمشكلة أو الملاحظة الأهم اليوم: [جملة قصيرة تلخص أي خطر تشغيلي، أو اكتب "لا يوجد"]\nقرار مطلوب من الإدارة: [الإجراء المطلوب بوضوح، أو اكتب "لا يوجد"]'),
  ('weekly_operational_ar', 'تقرير الأداء التشغيلي الأسبوعي', 'ar', 'تقرير الأداء التشغيلي الأسبوعي\nالعيادة / القسم: [عيادة / قسم]\nعن الفترة من: [تاريخ بداية الأسبوع] إلى [تاريخ نهاية الأسبوع]\nمُقدم التقرير: [الاسم]\n\nالأداء العام والمبيعات:\nإجمالي العملاء الجدد المحولين للقسم هذا الأسبوع: [العدد]\nإجمالي الحجوزات المؤكدة: [العدد]\nإجمالي الإجراءات أو الجلسات التي تمت: [العدد]\nإجمالي الحالات التي ألغت الحجز أو لم تحضر: [العدد]\n\nكفاءة قسم المتابعة:\nإجمالي المتابعات التي تمت لمرضى القسم: [العدد]\nحالات قديمة تم إعادة تنشيطها: [العدد]\nحالات معلقة ترفض الحجز حالياً: [العدد - مع ذكر السبب الأبرز مثل السعر أو عدم التوافر]\n\nالتدخل الطبي المطلوب:\nحالات تحتاج إلى استشارة أو قرار طبي من الدكتور: [اكتب اسم الحالة والتفاصيل، أو اكتب "لا يوجد حالات معلقة"]\nشكاوى أو ملاحظات طبية من المرضى: [اكتب التفاصيل بوضوح، أو اكتب "لا يوجد أي شكاوى هذا الأسبوع"]\n\nالتقييم التشغيلي والتقني:\nحالة الأجهزة والمعدات الطبية بالقسم: [تعمل بكفاءة عالية وتمت الصيانة الدورية / يوجد عطل في جهاز كذا]\nنواقص العيادة أو المستلزمات المطلوبة للأسبوع القادم: [اكتب التفاصيل، أو اكتب "لا يوجد نواقص"]\n\nالتوصيات والخلاصة:\nالوضع العام للقسم هذا الأسبوع: [ممتاز / مستقر / يحتاج إلى زيادة التسويق / يحتاج انتباه تشغيلي]\nأبرز فرصة للتحسين الأسبوع القادم: [اكتب جملة واحدة، أو اكتب "لا يوجد"]')
on conflict (template_key) do update set title = excluded.title, body = excluded.body, language = excluded.language, updated_at = now();

alter table audit_daily_reports enable row level security;
alter table audit_report_sections enable row level security;
alter table audit_metric_snapshots enable row level security;
alter table audit_metric_overrides enable row level security;
alter table audit_red_flag_conversations enable row level security;
alter table audit_ai_reviews enable row level security;
alter table audit_ai_review_samples enable row level security;
alter table audit_manual_scores enable row level security;
alter table audit_report_notes enable row level security;
alter table audit_report_templates enable row level security;
alter table operational_summary_reports enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'audit_daily_reports', 'audit_report_sections', 'audit_metric_snapshots',
    'audit_metric_overrides', 'audit_red_flag_conversations', 'audit_ai_reviews',
    'audit_ai_review_samples', 'audit_manual_scores', 'audit_report_notes',
    'audit_report_templates', 'operational_summary_reports'
  ]
  loop
    execute format('drop policy if exists "CRM active users can read" on %I', table_name);
    execute format(
      'create policy "CRM active users can read" on %I for select to authenticated using (crm_has_active_user())',
      table_name
    );
  end loop;
end $$;

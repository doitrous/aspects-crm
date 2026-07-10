-- Phase: canonical drawer tabs, WhatsApp readiness, tag ordering, follow-up plan snapshots.

alter table public.lead_tags
  add column if not exists display_order integer not null default 0;

create index if not exists lead_tags_active_order_idx
  on public.lead_tags (is_active, display_order, name);

alter table public.crm_followup_workflow_stages
  add column if not exists anchor text not null default 'stage_entry',
  add column if not exists applicable_status text,
  add column if not exists applicable_tag_id uuid references public.lead_tags(id) on delete set null,
  add column if not exists plan_version integer not null default 1;

create index if not exists crm_followup_workflow_active_order_idx
  on public.crm_followup_workflow_stages (workflow_type, is_active, stage_order);

create index if not exists crm_followup_workflow_applicability_idx
  on public.crm_followup_workflow_stages (applicable_status, applicable_tag_id)
  where is_active;

alter table public.lead_follow_up_stages
  add column if not exists template_stage_id uuid references public.crm_followup_workflow_stages(id) on delete set null,
  add column if not exists template_version integer,
  add column if not exists step_name text,
  add column if not exists anchor text,
  add column if not exists completed_by uuid references public.crm_users(id) on delete set null,
  add column if not exists snoozed_at timestamptz,
  add column if not exists snoozed_by uuid references public.crm_users(id) on delete set null;

create index if not exists lead_follow_up_stages_plan_idx
  on public.lead_follow_up_stages (lead_id, workflow_type, stage_number);

create index if not exists lead_follow_up_stages_open_due_idx
  on public.lead_follow_up_stages (workflow_type, due_at)
  where status <> 'completed';

comment on column public.lead_follow_up_stages.template_stage_id is
  'Configuration row used when this concrete follow-up step was created. Kept as a snapshot pointer; completed history is not recalculated silently.';
comment on column public.lead_follow_up_stages.template_version is
  'Plan version copied from settings when the step was created.';

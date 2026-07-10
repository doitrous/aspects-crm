-- CRM configurable escalation reasons and follow-up workflow stages.

set search_path = public, extensions;


create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.crm_escalation_reasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_escalation_reasons_active_order_idx
  on public.crm_escalation_reasons (is_active, display_order);

create table if not exists public.crm_followup_workflow_stages (
  id uuid primary key default gen_random_uuid(),
  workflow_type text not null check (workflow_type in ('regular', 'postop')),
  name text not null,
  stage_order integer not null default 0,
  due_after_amount integer not null default 0,
  due_after_unit text not null default 'days' check (due_after_unit in ('hours', 'days', 'weeks')),
  moderator_instruction text,
  color text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_followup_workflow_stages_type_order_idx
  on public.crm_followup_workflow_stages (workflow_type, is_active, stage_order);

drop trigger if exists crm_escalation_reasons_updated_at on public.crm_escalation_reasons;
create trigger crm_escalation_reasons_updated_at
before update on public.crm_escalation_reasons
for each row execute function public.update_updated_at_column();

drop trigger if exists crm_followup_workflow_stages_updated_at on public.crm_followup_workflow_stages;
create trigger crm_followup_workflow_stages_updated_at
before update on public.crm_followup_workflow_stages
for each row execute function public.update_updated_at_column();

insert into public.crm_escalation_reasons (name, description, display_order)
values
  ('Manager review requested', 'Lead needs manager review before the next action.', 10),
  ('Medical decision needed', 'Lead requires doctor or clinical decision input.', 20),
  ('Pricing concern', 'Lead needs pricing or payment approval.', 30),
  ('Complaint or risk', 'Patient complaint, operational issue, or reputational risk.', 40)
on conflict do nothing;

insert into public.crm_followup_workflow_stages (workflow_type, name, stage_order, due_after_amount, due_after_unit, moderator_instruction, color)
values
  ('regular', 'F/U 1', 1, 1, 'days', 'Confirm interest, answer objections, and set the next action.', '#2f6fed'),
  ('regular', 'F/U 2', 2, 2, 'days', 'Follow up with a concise reminder and booking CTA.', '#C084FC'),
  ('regular', 'F/U 3', 3, 3, 'days', 'Reconfirm service interest and ask what is blocking booking.', '#38BDF8'),
  ('regular', 'F/U 4', 4, 5, 'days', 'Offer manager help if pricing, timing, or doctor choice is blocking.', '#F97316'),
  ('regular', 'F/U 5', 5, 7, 'days', 'Final structured follow-up before marking lost or long-term follow-up.', '#EF4444'),
  ('postop', 'Post-Op F/U 1', 1, 1, 'days', 'Check immediate post-procedure condition and warning symptoms.', '#10B981'),
  ('postop', 'Post-Op F/U 2', 2, 3, 'days', 'Check recovery progress and answer aftercare questions.', '#14B8A6'),
  ('postop', 'Post-Op F/U 3', 3, 7, 'days', 'Confirm expected healing and identify complications early.', '#0EA5E9'),
  ('postop', 'Post-Op F/U 4', 4, 14, 'days', 'Review satisfaction and any remaining medical concerns.', '#8B5CF6'),
  ('postop', 'Post-Op F/U 5', 5, 30, 'days', 'Final follow-up, long-term outcome, and next treatment recommendation.', '#2f6fed')
on conflict do nothing;

grant select, insert, update, delete on public.crm_escalation_reasons to service_role;
grant select, insert, update, delete on public.crm_followup_workflow_stages to service_role;

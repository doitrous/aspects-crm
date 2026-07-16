-- Lead drawer, financial line-item and duplicate-review upgrade.
--
-- Additive and idempotent. Existing leads, patients, payments, duplicate flags
-- and bundle rows are retained. No historical amount is overwritten: the new
-- list_price column is backfilled from the already-frozen base_price snapshot.

set search_path = public, extensions;

-- A service line now keeps the catalogue snapshot and the patient-specific
-- bill price separately. `base_price` remains the bill price for backwards
-- compatibility with existing reports and application code.
alter table public.crm_lead_bundle_items
  add column if not exists list_price numeric(14,2),
  add column if not exists service_id uuid,
  add column if not exists source_kind text not null default 'service'
    check (source_kind in ('service', 'bundle', 'addon')),
  add column if not exists source_rule_id uuid,
  add column if not exists source_label text;

update public.crm_lead_bundle_items
set list_price = base_price
where list_price is null;

update public.crm_lead_bundle_items item
set service_id = settings.service_id
from public.crm_financial_service_settings settings
where item.service_settings_id = settings.id
  and item.service_id is null;

alter table public.crm_lead_bundle_items
  alter column list_price set not null,
  alter column list_price set default 0;

-- Older financial records could freeze one service directly on the header
-- before service-line UI existed. Materialize that snapshot only when the bill
-- has no lines, so every historical bill becomes explainable without changing
-- its total or catalogue data.
insert into public.crm_lead_bundle_items (
  lead_financials_id, service_settings_id, service_id, service_name,
  list_price, base_price, source_kind
)
select
  financial.id, financial.service_settings_id, settings.service_id,
  coalesce(financial.service_name, settings.service_name),
  financial.base_service_price, financial.base_service_price, 'service'
from public.crm_lead_financials as financial
left join public.crm_financial_service_settings as settings
  on settings.id = financial.service_settings_id
where coalesce(financial.service_name, settings.service_name) is not null
  and not exists (
    select 1 from public.crm_lead_bundle_items as item
    where item.lead_financials_id = financial.id
  );

create index if not exists crm_lead_bundle_items_service_setting_idx
  on public.crm_lead_bundle_items (lead_financials_id, service_settings_id)
  where service_settings_id is not null and source_kind = 'service';

create index if not exists crm_lead_bundle_items_rule_idx
  on public.crm_lead_bundle_items (source_kind, source_rule_id)
  where source_rule_id is not null;

create index if not exists crm_lead_bundle_items_service_idx
  on public.crm_lead_bundle_items (lead_financials_id, service_id)
  where service_id is not null;

-- Tie frozen compensation to the service line that created it. This lets an
-- unfinalized service be removed together with only its own compensation.
alter table public.crm_lead_doctor_compensation
  add column if not exists bundle_item_id uuid
    references public.crm_lead_bundle_items(id) on delete restrict;

create index if not exists crm_lead_doc_comp_bundle_item_idx
  on public.crm_lead_doctor_compensation (bundle_item_id)
  where bundle_item_id is not null;

-- A catalogue service may intentionally be available in more than one
-- specialty. UUIDs are soft references to the booking database.
alter table public.crm_financial_service_settings
  add column if not exists specialty_ids uuid[] not null default '{}'::uuid[];

create index if not exists crm_fin_service_specialties_idx
  on public.crm_financial_service_settings using gin (specialty_ids);

-- Preserve direction for parent/child and guardian relationships even though
-- the pair itself is stored in canonical UUID order.
alter table public.crm_lead_links
  add column if not exists relationship_source_lead_id uuid
    references public.leads(id) on delete cascade;

alter table public.crm_lead_links
  drop constraint if exists crm_lead_links_relationship_check;

update public.crm_lead_links
set relationship = 'relative'
where relationship in ('distant_relative', 'family');

alter table public.crm_lead_links
  add constraint crm_lead_links_relationship_check check (relationship in (
    'same_patient', 'parent', 'child', 'spouse', 'sibling', 'relative',
    'same_household', 'guardian', 'caregiver', 'related_contact', 'other'
  ));

update public.crm_lead_links
set relationship_source_lead_id = lead_a_id
where relationship_source_lead_id is null;

alter table public.crm_lead_links
  alter column relationship_source_lead_id set not null;

create index if not exists crm_lead_links_source_idx
  on public.crm_lead_links (relationship_source_lead_id);

create or replace function public.crm_sync_linked_duplicate()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if new.status = 'linked' and old.status is distinct from new.status then
    insert into public.crm_lead_links (
      lead_a_id, lead_b_id, relationship, relationship_source_lead_id,
      linked_by, notes
    ) values (
      least(new.lead_id, new.duplicate_lead_id),
      greatest(new.lead_id, new.duplicate_lead_id),
      'same_patient', new.lead_id, new.reviewed_by, new.notes
    ) on conflict (lead_a_id, lead_b_id, relationship) do update set
      relationship_source_lead_id = excluded.relationship_source_lead_id,
      linked_by = excluded.linked_by, linked_at = now(), notes = excluded.notes;
  end if;
  return new;
end;
$$;

-- Retain superseded patient rows as audit/history records when two existing
-- patient identities are deliberately linked to one canonical patient.
alter table public.patients
  add column if not exists merged_into_patient_id uuid
    references public.patients(id) on delete restrict;

create index if not exists patients_merged_into_idx
  on public.patients (merged_into_patient_id)
  where merged_into_patient_id is not null;

-- A deliberate same-patient decision is transactional: both leads remain,
-- every child record remains attached to its original lead, while patient_id
-- points both identities at one canonical patient. A secondary MRN is retained
-- in audit metadata and cleared from the non-canonical lead to avoid two MRNs.
create or replace function public.crm_link_duplicate_same_patient(
  target_flag_id uuid,
  canonical_lead_id uuid,
  actor_id uuid,
  moderator_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  flag public.lead_duplicate_flags%rowtype;
  canonical public.leads%rowtype;
  other public.leads%rowtype;
  canonical_patient_id uuid;
  secondary_patient_id uuid;
  canonical_mrn text;
  old_other_mrn text;
begin
  select * into flag from public.lead_duplicate_flags
  where id = target_flag_id for update;
  if not found then raise exception 'Duplicate flag % not found', target_flag_id; end if;
  if canonical_lead_id not in (flag.lead_id, flag.duplicate_lead_id) then
    raise exception 'Canonical lead is not part of this duplicate pair';
  end if;

  select * into canonical from public.leads where id = canonical_lead_id for update;
  select * into other from public.leads
    where id = case when flag.lead_id = canonical_lead_id then flag.duplicate_lead_id else flag.lead_id end
    for update;

  canonical_patient_id := coalesce(canonical.patient_id, other.patient_id);
  canonical_mrn := coalesce(nullif(btrim(canonical.mrn), ''), nullif(btrim(other.mrn), ''));
  if canonical_patient_id is not null then
    select coalesce(nullif(btrim(patient.mrn), ''), canonical_mrn)
      into canonical_mrn
    from public.patients as patient
    where patient.id = canonical_patient_id;
  end if;

  if canonical_patient_id is null and canonical_mrn is null then
    raise exception 'Assign an MRN to either record before linking the same patient';
  end if;

  if canonical_patient_id is null then
    if canonical_mrn is not null then
      insert into public.patients (
        mrn, name, gender, phone_country_code, phone_number, normalized_phone,
        primary_lead_id, metadata
      ) values (
        canonical_mrn, canonical.name, canonical.gender,
        canonical.phone_country_code, canonical.phone_number,
        canonical.normalized_phone, canonical.id,
        jsonb_build_object('created_from_duplicate_review', target_flag_id)
      )
      on conflict (mrn) do update set updated_at = now()
      returning id into canonical_patient_id;
    end if;
  end if;

  if canonical.patient_id is not null and other.patient_id is not null
     and canonical.patient_id <> other.patient_id then
    secondary_patient_id := other.patient_id;
    update public.leads set patient_id = canonical.patient_id, updated_at = now()
      where patient_id = secondary_patient_id;
    update public.patients
      set merged_into_patient_id = canonical.patient_id,
          metadata = metadata || jsonb_build_object(
            'merged_from_duplicate_flag', target_flag_id,
            'merged_by', actor_id,
            'merged_at', now()
          ),
          updated_at = now()
      where id = secondary_patient_id;
    canonical_patient_id := canonical.patient_id;
  elsif canonical_patient_id is not null then
    update public.leads set patient_id = canonical_patient_id, updated_at = now()
      where id in (canonical.id, other.id);
  end if;

  old_other_mrn := other.mrn;
  if canonical_mrn is not null then
    update public.leads set mrn = null, updated_at = now()
      where id = other.id and mrn is not null;
    update public.leads set mrn = canonical_mrn, updated_at = now()
      where id = canonical.id;
    if canonical_patient_id is not null then
      -- Do not rewrite a retained historical patient MRN: it may still be
      -- protected by the unique constraint. The canonical lead carries the
      -- active MRN while merged_into_patient_id records superseded identity.
      update public.patients set primary_lead_id = canonical.id,
        updated_at = now() where id = canonical_patient_id;
    end if;
  end if;

  insert into public.crm_lead_links (
    lead_a_id, lead_b_id, relationship, relationship_source_lead_id,
    linked_by, notes
  ) values (
    least(canonical.id, other.id), greatest(canonical.id, other.id),
    'same_patient', canonical.id, actor_id, nullif(btrim(moderator_note), '')
  ) on conflict (lead_a_id, lead_b_id, relationship) do update set
    relationship_source_lead_id = excluded.relationship_source_lead_id,
    linked_by = excluded.linked_by, linked_at = now(), notes = excluded.notes;

  update public.lead_duplicate_flags set status = 'linked', reviewed_by = actor_id,
    reviewed_at = now(), updated_at = now(),
    notes = coalesce(nullif(btrim(moderator_note), ''), notes)
  where id = target_flag_id;

  insert into public.duplicate_review_actions (
    duplicate_flag_id, action, action_by, notes, metadata
  ) values (
    target_flag_id, 'linked', actor_id, nullif(btrim(moderator_note), ''),
    jsonb_build_object(
      'decision', 'same_patient', 'canonical_lead_id', canonical.id,
      'canonical_patient_id', canonical_patient_id,
      'original_lead_ids', jsonb_build_array(flag.lead_id, flag.duplicate_lead_id),
      'noncanonical_mrn_before', old_other_mrn
    )
  );

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, old_values, new_values, metadata
  ) values (
    actor_id, 'duplicate.same_patient_linked', 'duplicate_flag', target_flag_id,
    jsonb_build_object('lead_ids', jsonb_build_array(flag.lead_id, flag.duplicate_lead_id)),
    jsonb_build_object('canonical_lead_id', canonical.id, 'canonical_patient_id', canonical_patient_id),
    jsonb_build_object('moderator_note', nullif(btrim(moderator_note), ''))
  );

  return jsonb_build_object(
    'canonical_lead_id', canonical.id,
    'canonical_patient_id', canonical_patient_id,
    'other_lead_id', other.id
  );
end;
$$;

-- Family/guardian decisions are also one transaction, so a relationship can
-- never be saved while the duplicate flag remains unresolved (or vice versa).
create or replace function public.crm_resolve_duplicate_relationship(
  target_flag_id uuid,
  relationship_type text,
  actor_id uuid,
  moderator_note text default null
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  flag public.lead_duplicate_flags%rowtype;
  first_lead public.leads%rowtype;
  second_lead public.leads%rowtype;
  first_patient_id uuid;
  second_patient_id uuid;
begin
  if relationship_type not in (
    'parent', 'child', 'spouse', 'sibling', 'relative', 'same_household',
    'guardian', 'caregiver', 'related_contact', 'other'
  ) then raise exception 'Unsupported patient relationship'; end if;

  select * into flag from public.lead_duplicate_flags where id = target_flag_id for update;
  if not found then raise exception 'Duplicate flag % not found', target_flag_id; end if;

  select * into first_lead from public.leads where id = flag.lead_id for update;
  select * into second_lead from public.leads where id = flag.duplicate_lead_id for update;
  if nullif(btrim(first_lead.mrn), '') is null or nullif(btrim(second_lead.mrn), '') is null then
    raise exception 'Assign a separate MRN to both people before recording their relationship';
  end if;
  if lower(btrim(first_lead.mrn)) = lower(btrim(second_lead.mrn)) then
    raise exception 'Family and related contacts must keep separate MRNs';
  end if;

  first_patient_id := first_lead.patient_id;
  if first_patient_id is null then
    insert into public.patients (
      mrn, name, gender, phone_country_code, phone_number, normalized_phone,
      primary_lead_id, metadata
    ) values (
      first_lead.mrn, first_lead.name, first_lead.gender,
      first_lead.phone_country_code, first_lead.phone_number, first_lead.normalized_phone,
      first_lead.id, jsonb_build_object('created_from_relationship_review', target_flag_id)
    ) on conflict (mrn) do update set updated_at = now()
    returning id into first_patient_id;
    update public.leads set patient_id = first_patient_id, updated_at = now() where id = first_lead.id;
  end if;

  second_patient_id := second_lead.patient_id;
  if second_patient_id is null then
    insert into public.patients (
      mrn, name, gender, phone_country_code, phone_number, normalized_phone,
      primary_lead_id, metadata
    ) values (
      second_lead.mrn, second_lead.name, second_lead.gender,
      second_lead.phone_country_code, second_lead.phone_number, second_lead.normalized_phone,
      second_lead.id, jsonb_build_object('created_from_relationship_review', target_flag_id)
    ) on conflict (mrn) do update set updated_at = now()
    returning id into second_patient_id;
    update public.leads set patient_id = second_patient_id, updated_at = now() where id = second_lead.id;
  end if;

  if first_patient_id = second_patient_id then
    raise exception 'These leads already use the same canonical patient; choose Same Patient instead';
  end if;

  insert into public.crm_lead_links (
    lead_a_id, lead_b_id, relationship, relationship_source_lead_id, linked_by, notes
  ) values (
    least(flag.lead_id, flag.duplicate_lead_id), greatest(flag.lead_id, flag.duplicate_lead_id),
    relationship_type, flag.lead_id, actor_id, nullif(btrim(moderator_note), '')
  ) on conflict (lead_a_id, lead_b_id, relationship) do update set
    relationship_source_lead_id = excluded.relationship_source_lead_id,
    linked_by = excluded.linked_by, linked_at = now(), notes = excluded.notes;

  update public.lead_duplicate_flags set status = 'dismissed', reviewed_by = actor_id,
    reviewed_at = now(), updated_at = now(),
    notes = coalesce(nullif(btrim(moderator_note), ''), notes)
  where id = target_flag_id;

  insert into public.duplicate_review_actions (duplicate_flag_id, action, action_by, notes, metadata)
  values (
    target_flag_id, 'dismissed', actor_id, nullif(btrim(moderator_note), ''),
    jsonb_build_object(
      'decision', case when relationship_type in ('guardian','caregiver','related_contact') then 'related_contact' else 'family_members' end,
      'relationship_type', relationship_type,
      'relationship_source_lead_id', flag.lead_id,
      'patient_ids', jsonb_build_array(first_patient_id, second_patient_id),
      'original_lead_ids', jsonb_build_array(flag.lead_id, flag.duplicate_lead_id)
    )
  );

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, old_values, new_values, metadata)
  values (
    actor_id,
    case when relationship_type in ('guardian','caregiver','related_contact')
      then 'duplicate.related_contact_recorded' else 'duplicate.family_relationship_recorded' end,
    'duplicate_flag', target_flag_id,
    jsonb_build_object('lead_ids', jsonb_build_array(flag.lead_id, flag.duplicate_lead_id)),
    jsonb_build_object('relationship', relationship_type),
    jsonb_build_object('moderator_note', nullif(btrim(moderator_note), ''))
  );
end;
$$;

create or replace function public.crm_dismiss_duplicate_review(
  target_flag_id uuid,
  decision_kind text,
  actor_id uuid,
  moderator_note text default null
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  flag public.lead_duplicate_flags%rowtype;
begin
  if decision_kind not in ('different_people', 'dismissed') then
    raise exception 'Unsupported duplicate dismissal decision';
  end if;
  select * into flag from public.lead_duplicate_flags where id = target_flag_id for update;
  if not found then raise exception 'Duplicate flag % not found', target_flag_id; end if;

  update public.lead_duplicate_flags set status = 'dismissed', reviewed_by = actor_id,
    reviewed_at = now(), updated_at = now(),
    notes = coalesce(nullif(btrim(moderator_note), ''), notes)
  where id = target_flag_id;

  insert into public.duplicate_review_actions (duplicate_flag_id, action, action_by, notes, metadata)
  values (
    target_flag_id, 'dismissed', actor_id, nullif(btrim(moderator_note), ''),
    jsonb_build_object(
      'decision', decision_kind,
      'original_lead_ids', jsonb_build_array(flag.lead_id, flag.duplicate_lead_id),
      'duplicate_type', flag.duplicate_type,
      'identifier_value', flag.identifier_value
    )
  );

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, old_values, new_values, metadata)
  values (
    actor_id,
    case when decision_kind = 'different_people' then 'duplicate.different_people' else 'duplicate.suggestion_dismissed' end,
    'duplicate_flag', target_flag_id,
    jsonb_build_object(
      'lead_ids', jsonb_build_array(flag.lead_id, flag.duplicate_lead_id),
      'status', flag.status,
      'identifier_value', flag.identifier_value
    ),
    jsonb_build_object('status', 'dismissed', 'decision', decision_kind),
    jsonb_build_object('moderator_note', nullif(btrim(moderator_note), ''))
  );
end;
$$;

-- Batch existing records through the exact same per-lead detector used by the
-- insert/update triggers. The caller supplies a cursor and can keep scheduling
-- small batches; canonical-pair uniqueness makes every retry idempotent.
create or replace function public.crm_backfill_duplicate_flags_batch(
  after_lead_id uuid default null,
  batch_size integer default 500
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target record;
  processed integer := 0;
  last_id uuid := after_lead_id;
  before_count bigint;
  after_count bigint;
  has_more boolean := false;
begin
  select count(*) into before_count from public.lead_duplicate_flags;
  for target in
    select id from public.leads
    where merged_into_lead_id is null
      and (after_lead_id is null or id > after_lead_id)
    order by id
    limit least(greatest(batch_size, 1), 1000)
  loop
    perform public.crm_flag_duplicate_for_lead(target.id);
    perform public.crm_flag_priority_identifiers(target.id);
    processed := processed + 1;
    last_id := target.id;
  end loop;
  select count(*) into after_count from public.lead_duplicate_flags;
  select exists (
    select 1 from public.leads
    where merged_into_lead_id is null and id > last_id
  ) into has_more;
  return jsonb_build_object(
    'processed', processed,
    'created', greatest(after_count - before_count, 0),
    'next_cursor', case when has_more then last_id else null end,
    'complete', not has_more
  );
end;
$$;

create index if not exists lead_duplicate_flags_open_page_idx
  on public.lead_duplicate_flags (match_priority, created_at desc, id)
  where status = 'pending';

create index if not exists lead_duplicate_flags_resolved_page_idx
  on public.lead_duplicate_flags (match_priority, created_at desc, id)
  where status <> 'pending';

revoke all on function public.crm_link_duplicate_same_patient(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.crm_resolve_duplicate_relationship(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.crm_dismiss_duplicate_review(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.crm_backfill_duplicate_flags_batch(uuid, integer) from public, anon, authenticated;
grant execute on function public.crm_link_duplicate_same_patient(uuid, uuid, uuid, text) to service_role;
grant execute on function public.crm_resolve_duplicate_relationship(uuid, text, uuid, text) to service_role;
grant execute on function public.crm_dismiss_duplicate_review(uuid, text, uuid, text) to service_role;
grant execute on function public.crm_backfill_duplicate_flags_batch(uuid, integer) to service_role;

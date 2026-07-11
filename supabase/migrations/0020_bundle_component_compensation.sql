alter table public.crm_financial_bundle_components
  add column if not exists doctor_id uuid,
  add column if not exists doctor_name text,
  add column if not exists compensation_kind text,
  add column if not exists compensation_value numeric(14,2),
  add column if not exists compensation_basis text default 'quoted_price';

alter table public.crm_financial_bundle_components drop constraint if exists crm_fin_bundle_component_comp_kind_check;
alter table public.crm_financial_bundle_components add constraint crm_fin_bundle_component_comp_kind_check
  check (compensation_kind is null or compensation_kind in ('percentage','fixed'));
alter table public.crm_financial_bundle_components drop constraint if exists crm_fin_bundle_component_comp_basis_check;
alter table public.crm_financial_bundle_components add constraint crm_fin_bundle_component_comp_basis_check
  check (compensation_basis in ('quoted_price','net_after_consumables'));

create index if not exists crm_fin_bundle_components_doctor_idx on public.crm_financial_bundle_components (doctor_id, bundle_id);

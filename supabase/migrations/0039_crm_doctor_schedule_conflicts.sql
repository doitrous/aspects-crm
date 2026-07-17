-- CRM schedules remain separate from Admin schedules. This adds a database-side
-- guard so two CRM requests cannot schedule the same doctor at overlapping
-- times, even if they arrive concurrently. Room overlap is guarded by 0038.

create or replace function public.crm_prevent_doctor_schedule_overlap()
returns trigger language plpgsql as $$
begin
  if new.is_active and exists (
    select 1
    from public.crm_schedule_templates schedule
    where schedule.id <> new.id
      and schedule.doctor_id = new.doctor_id
      and schedule.is_active
      and schedule.day_of_week = new.day_of_week
      and schedule.start_time < new.end_time
      and schedule.end_time > new.start_time
      and (schedule.effective_to is null or new.effective_from is null or schedule.effective_to >= new.effective_from)
      and (new.effective_to is null or schedule.effective_from is null or new.effective_to >= schedule.effective_from)
  ) then
    raise exception 'Doctor already has an overlapping CRM schedule.' using errcode = '23P01';
  end if;
  return new;
end $$;

drop trigger if exists crm_doctor_schedule_conflict on public.crm_schedule_templates;
create trigger crm_doctor_schedule_conflict
before insert or update of doctor_id, day_of_week, start_time, end_time, effective_from, effective_to, is_active
on public.crm_schedule_templates for each row execute function public.crm_prevent_doctor_schedule_overlap();

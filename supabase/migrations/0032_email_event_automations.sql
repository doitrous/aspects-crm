-- Make every user-created email automation directly dispatchable.
-- Earlier custom rules could have a null rule_key, so give those rows a stable
-- identity without changing any existing built-in rule keys.
set search_path = public, extensions;

update public.crm_email_rules
set rule_key = 'automation_' || replace(id::text, '-', '')
where rule_key is null;

alter table public.crm_email_rules alter column rule_key set not null;

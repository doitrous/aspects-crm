-- Remove the explicit UI/demo fixtures introduced by the historical baseline.
-- The metadata predicate is intentionally narrow: real leads are untouched.
delete from public.leads
where metadata @> '{"seed": true}'::jsonb;

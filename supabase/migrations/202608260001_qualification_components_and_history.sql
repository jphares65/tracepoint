-- Qualification thresholds now live with drill components in the range
-- workspace JSON. This migration expands normalized historical results so
-- imported day/night scores remain independent and weapon-specific.

alter table public.qualification_results
  add column if not exists historical_qualification_type text;

update public.qualification_results
set historical_qualification_type = 'other'
where record_origin = 'historical_import'
  and historical_qualification_type is null;

alter table public.qualification_results
  drop constraint if exists qualification_results_historical_type_check;

alter table public.qualification_results
  add constraint qualification_results_historical_type_check
  check (
    historical_qualification_type is null
    or historical_qualification_type in (
      'handgun',
      'rifle',
      'shotgun',
      'less_lethal',
      'other'
    )
  );

comment on column public.qualification_results.historical_qualification_type is
  'Normalized weapon/qualification type preserved for historical imports.';

create index if not exists qualification_results_historical_lookup_idx
  on public.qualification_results (
    department_id,
    officer_user_id,
    qualification_date,
    historical_qualification_type,
    lighting_condition
  )
  where record_origin = 'historical_import';

-- Historical records with identical course names but different weapon types
-- must remain distinct. Day and night are already separate via
-- lighting_condition.
create or replace view public.v_latest_qualification_results
with (security_invoker = true)
as
select distinct on (
  result.department_id,
  result.officer_user_id,
  coalesce(
    result.qualification_course_id::text,
    'historical:'
      || coalesce(result.historical_qualification_type, 'other')
      || ':'
      || lower(btrim(result.historical_course_name))
  ),
  result.lighting_condition
)
  result.*
from public.qualification_results result
order by
  result.department_id,
  result.officer_user_id,
  coalesce(
    result.qualification_course_id::text,
    'historical:'
      || coalesce(result.historical_qualification_type, 'other')
      || ':'
      || lower(btrim(result.historical_course_name))
  ),
  result.lighting_condition,
  result.qualification_date desc,
  result.created_at desc;

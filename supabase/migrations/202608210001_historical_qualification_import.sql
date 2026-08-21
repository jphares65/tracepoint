-- Support authoritative historical qualification imports without
-- fabricating TracePoint course/version/instructor relationships.

alter table public.qualification_results
  add column if not exists record_origin text not null default 'live',
  add column if not exists historical_course_name text,
  add column if not exists historical_instructor_name text,
  add column if not exists historical_passing_score numeric(10,2),
  add column if not exists historical_result_text text;

alter table public.qualification_results
  alter column instructor_user_id drop not null,
  alter column qualification_course_id drop not null,
  alter column qualification_course_version_id drop not null,
  alter column passed drop not null;

alter table public.qualification_results
  drop constraint if exists qualification_results_record_origin_check;

alter table public.qualification_results
  add constraint qualification_results_record_origin_check
  check (
    (
      record_origin = 'live'
      and instructor_user_id is not null
      and qualification_course_id is not null
      and qualification_course_version_id is not null
      and passed is not null
    )
    or
    (
      record_origin = 'historical_import'
      and historical_course_name is not null
      and btrim(historical_course_name) <> ''
    )
  );

alter table public.qualification_results
  drop constraint if exists qualification_results_record_origin_value_check;

alter table public.qualification_results
  add constraint qualification_results_record_origin_value_check
  check (
    record_origin in ('live', 'historical_import')
  );

comment on column public.qualification_results.record_origin is
  'Identifies whether the qualification was created through a live TracePoint workflow or imported from a legacy historical record.';

comment on column public.qualification_results.historical_course_name is
  'Original course or qualification standard name preserved from a historical source record.';

comment on column public.qualification_results.historical_instructor_name is
  'Original instructor name preserved from a historical source record when no TracePoint membership relationship exists.';

comment on column public.qualification_results.historical_passing_score is
  'Passing score stated by the original historical source, when available.';

comment on column public.qualification_results.historical_result_text is
  'Original result/status text preserved from the historical source.';
-- Keep historical qualification courses distinct in the latest-results view.
-- Live records continue grouping by TracePoint qualification course ID.
-- Historical records group by the preserved legacy course/standard name.

create or replace view public.v_latest_qualification_results
with (security_invoker = true)
as
select distinct on (
  result.department_id,
  result.officer_user_id,
  coalesce(
    result.qualification_course_id::text,
    'historical:' || lower(btrim(result.historical_course_name))
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
    'historical:' || lower(btrim(result.historical_course_name))
  ),
  result.lighting_condition,
  result.qualification_date desc,
  result.created_at desc;
-- Read-only scope scan for the range workspace cross-agency exposure.
-- Returns, per agency workspace row, how many records carry another agency's
-- department id (and which agency ids), plus how many child records hang off
-- those days. Counts and ids only: no names, titles, scores or officer ids.
begin transaction read only;

with days as (
  select w.department_id as owner_id,
         d->>'id' as day_id,
         nullif(coalesce(d->>'departmentId', d->>'department_id'), '') as stamped_id
  from public.pilot_range_workspaces w,
       jsonb_array_elements(case when jsonb_typeof(w.workspace->'rangeDays') = 'array' then w.workspace->'rangeDays' else '[]'::jsonb end) d
), foreign_days as (
  select * from days where stamped_id is not null and stamped_id <> owner_id::text
), templates as (
  select w.department_id as owner_id,
         nullif(coalesce(t->>'departmentId', t->>'department_id'), '') as stamped_id
  from public.pilot_range_workspaces w,
       jsonb_array_elements(case when jsonb_typeof(w.workspace->'drillLibrary') = 'array' then w.workspace->'drillLibrary' else '[]'::jsonb end) t
), children as (
  select w.department_id as owner_id, c.key as collection,
         nullif(coalesce(e->>'rangeDayId', e->>'range_day_id'), '') as day_id
  from public.pilot_range_workspaces w,
       jsonb_each(w.workspace) c,
       jsonb_array_elements(case when jsonb_typeof(c.value) = 'array' then c.value else '[]'::jsonb end) e
  where c.key in ('rangeDayDrills', 'rangeRoster', 'results', 'malfunctions')
)
select w.department_id as workspace_agency_id,
       w.updated_at,
       (select count(*) from foreign_days f where f.owner_id = w.department_id) as foreign_range_days,
       (select count(*) from templates t where t.owner_id = w.department_id and t.stamped_id is not null and t.stamped_id <> w.department_id::text) as foreign_drill_templates,
       (select count(*) from children c join foreign_days f on f.owner_id = c.owner_id and f.day_id = c.day_id where c.owner_id = w.department_id) as child_records_of_foreign_days,
       (select coalesce(jsonb_object_agg(collection, n), '{}'::jsonb) from (select c.collection, count(*) n from children c join foreign_days f on f.owner_id = c.owner_id and f.day_id = c.day_id where c.owner_id = w.department_id group by c.collection) x) as child_records_by_collection,
       (select coalesce(jsonb_agg(distinct stamped_id), '[]'::jsonb) from (select stamped_id from foreign_days f where f.owner_id = w.department_id union select stamped_id from templates t where t.owner_id = w.department_id and t.stamped_id is not null and t.stamped_id <> w.department_id::text) s) as foreign_agency_ids
from public.pilot_range_workspaces w
order by foreign_range_days desc, foreign_drill_templates desc;

rollback;

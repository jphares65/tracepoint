-- Generalize equipment requirements so an agency can define
-- who actually needs each equipment type.

alter table public.department_equipment_requirements
    add column if not exists scope_type text not null default 'all',
    add column if not exists scope_value text not null default '',
    add column if not exists affects_readiness boolean not null default true;

-- Supported V1 scopes:
-- all      = every active department member
-- rank     = matching rank/title
-- unit     = matching unit/assignment
-- officer  = one specific user id
alter table public.department_equipment_requirements
    drop constraint if exists department_equipment_requirements_scope_type_check;

alter table public.department_equipment_requirements
    add constraint department_equipment_requirements_scope_type_check
    check (
        scope_type in ('all', 'rank', 'unit', 'officer')
    );

alter table public.department_equipment_requirements
    drop constraint if exists department_equipment_requirements_scope_value_check;

alter table public.department_equipment_requirements
    add constraint department_equipment_requirements_scope_value_check
    check (
        (scope_type = 'all' and scope_value = '')
        or
        (scope_type <> 'all' and length(trim(scope_value)) > 0)
    );

-- Existing requirements should remain agency-wide.
update public.department_equipment_requirements
set
    scope_type = 'all',
    scope_value = ''
where scope_type is null
   or trim(scope_type) = '';

-- Remove the old "one requirement per equipment type per department"
-- uniqueness rule. The exact object may exist as either a constraint or index.
alter table public.department_equipment_requirements
    drop constraint if exists department_equipment_requirements_department_id_equipment_type_id_key;

drop index if exists public.department_equipment_requirements_department_id_equipment_type_id_key;

-- Now uniqueness includes the population to which the rule applies.
create unique index if not exists
    uq_department_equipment_requirement_scope
on public.department_equipment_requirements (
    department_id,
    equipment_type_id,
    scope_type,
    scope_value
);

create index if not exists
    idx_department_equipment_requirements_scope
on public.department_equipment_requirements (
    department_id,
    scope_type,
    scope_value
);

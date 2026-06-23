# TracePoint backend data model

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : has
  DEPARTMENTS ||--o{ DEPARTMENT_MEMBERSHIPS : contains
  PROFILES ||--o{ DEPARTMENT_MEMBERSHIPS : joins
  DEPARTMENT_MEMBERSHIPS ||--o{ DEPARTMENT_MEMBERSHIP_ROLES : receives
  ROLES ||--o{ DEPARTMENT_MEMBERSHIP_ROLES : grants
  ROLES ||--o{ ROLE_PERMISSIONS : includes
  PERMISSIONS ||--o{ ROLE_PERMISSIONS : maps

  DEPARTMENTS ||--o{ FIREARMS : owns
  FIREARMS ||--o{ FIREARM_ASSIGNMENTS : history
  FIREARMS ||--o{ FIREARM_INSPECTIONS : receives
  FIREARMS ||--o{ FIREARM_MALFUNCTIONS : experiences

  DEPARTMENTS ||--o{ DRILL_TEMPLATES : maintains
  DEPARTMENTS ||--o{ RANGE_DAYS : schedules
  RANGE_DAYS ||--o{ RANGE_DAY_INSTRUCTORS : staffs
  RANGE_DAYS ||--o{ RANGE_DAY_ROSTER : contains
  RANGE_DAY_ROSTER ||--o{ RANGE_DAY_ROSTER_FIREARMS : assigns
  RANGE_DAYS ||--o{ RANGE_DAY_DRILLS : snapshots
  DRILL_TEMPLATES ||--o{ RANGE_DAY_DRILLS : copied_into
  RANGE_DAY_DRILLS ||--o{ DRILL_RUN_RESULTS : produces
  DRILL_RUN_RESULTS ||--o{ FIREARM_MALFUNCTIONS : may_report

  QUALIFICATION_COURSES ||--o{ QUALIFICATION_COURSE_VERSIONS : versions
  QUALIFICATION_COURSE_VERSIONS ||--o{ QUALIFICATION_RESULTS : governs
  DRILL_RUN_RESULTS ||--o| QUALIFICATION_RESULTS : may_create

  DEPARTMENTS ||--o{ OFF_DUTY_FIREARM_REQUESTS : manages
  OFF_DUTY_FIREARM_REQUESTS ||--o{ OFF_DUTY_REQUEST_ACTIONS : history

  DEPARTMENTS ||--o{ INBOX_ITEMS : delivers
  DEPARTMENTS ||--o{ ALERTS : generates
  DEPARTMENTS ||--o{ AUDIT_EVENTS : records
```

## Design rules

- Every operational record is scoped to a `department_id`.
- Child records carry `department_id` and use composite foreign keys where cross-tenant integrity matters.
- Row Level Security checks active department membership and permissions.
- Drill templates are copied into `range_day_drills`; later template edits do not alter historical records.
- Firearm assignments are historical records rather than a single mutable `assignedOfficerId`.
- A user may hold multiple roles in one department.
- Audit events are written by database triggers rather than trusted to browser code.

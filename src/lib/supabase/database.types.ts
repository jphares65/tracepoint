/**
 * Bootstrap Supabase type map.
 *
 * After the migration has been pushed, replace this file with generated types:
 *
 * npx supabase gen types typescript --project-id YOUR_PROJECT_REF `
 *   --schema public > src/lib/supabase/database.types.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type GenericRow = Record<string, Json | undefined>;

type GenericTable = {
  Row: GenericRow;
  Insert: GenericRow;
  Update: GenericRow;
  Relationships: [];
};

type GenericView = {
  Row: GenericRow;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: GenericTable;
      departments: GenericTable;
      roles: GenericTable;
      permissions: GenericTable;
      role_permissions: GenericTable;
      department_memberships: GenericTable;
      department_membership_roles: GenericTable;
      firearms: GenericTable;
      firearm_assignments: GenericTable;
      firearm_inspections: GenericTable;
      drill_templates: GenericTable;
      range_days: GenericTable;
      range_day_instructors: GenericTable;
      range_day_roster: GenericTable;
      range_day_roster_firearms: GenericTable;
      range_day_drills: GenericTable;
      drill_run_results: GenericTable;
      firearm_malfunctions: GenericTable;
      qualification_courses: GenericTable;
      qualification_course_versions: GenericTable;
      qualification_results: GenericTable;
      instructor_observations: GenericTable;
      remedial_training_recommendations: GenericTable;
      range_packets: GenericTable;
      off_duty_firearm_requests: GenericTable;
      off_duty_request_actions: GenericTable;
      inbox_items: GenericTable;
      alerts: GenericTable;
      audit_events: GenericTable;
    };
    Views: {
      v_active_firearm_assignments: GenericView;
      v_range_day_summary: GenericView;
      v_latest_qualification_results: GenericView;
    };
    Functions: {
      create_department_with_owner: {
        Args: {
          p_name: string;
          p_slug: string;
          p_short_name?: string | null;
          p_badge_number?: string | null;
          p_rank_title?: string | null;
          p_unit_name?: string | null;
        };
        Returns: string;
      };
      has_department_permission: {
        Args: {
          p_department_id: string;
          p_permission_code: string;
        };
        Returns: boolean;
      };
      has_department_role: {
        Args: {
          p_department_id: string;
          p_role_codes: string[];
        };
        Returns: boolean;
      };
      is_department_member: {
        Args: {
          p_department_id: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      firearm_type:
        | "handgun"
        | "rifle"
        | "shotgun"
        | "less_lethal"
        | "other";
      firearm_status:
        | "in_service"
        | "assigned"
        | "maintenance"
        | "inspection_required"
        | "out_of_service"
        | "retired"
        | "missing";
      range_day_status:
        | "planned"
        | "in_progress"
        | "completed"
        | "locked"
        | "archived";
      range_day_type:
        | "qualification"
        | "rifle"
        | "low_light"
        | "remedial"
        | "make_up"
        | "training";
      packet_status: "needs_setup" | "in_progress" | "ready";
      drill_category:
        | "qualification"
        | "marksmanship"
        | "movement"
        | "low_light"
        | "decision_making"
        | "rifle"
        | "shotgun"
        | "transition"
        | "malfunction_clearance"
        | "active_shooter"
        | "administrative"
        | "remedial"
        | "other";
      drill_difficulty:
        | "basic"
        | "intermediate"
        | "advanced"
        | "instructor_discretion";
      drill_library_status: "active" | "inactive" | "archived";
      scoring_format:
        | "qualification"
        | "points"
        | "time"
        | "pass_fail"
        | "completion"
        | "hit_count"
        | "notes_only";
      attendance_status: "scheduled" | "present" | "absent" | "excused";
      malfunction_type:
        | "failure_to_feed"
        | "failure_to_eject"
        | "failure_to_fire"
        | "light_primer_strike"
        | "magazine_issue"
        | "optic_failure"
        | "weapon_light_failure"
        | "trigger_issue"
        | "catastrophic_failure"
        | "other";
      inspection_reason:
        | "scheduled"
        | "malfunction"
        | "pre_issue"
        | "post_repair"
        | "annual"
        | "other";
      lighting_condition: "day" | "night" | "low_light" | "not_applicable";
      off_duty_request_status:
        | "draft"
        | "pending_command_review"
        | "returned_for_correction"
        | "approved"
        | "denied"
        | "withdrawn"
        | "archived";
      authorization_status:
        | "not_authorized"
        | "authorized"
        | "expiring_soon"
        | "expired"
        | "revoked";
      inspection_status: "current" | "due_soon" | "overdue";
      compliance_status: "authorized" | "at_risk" | "non_compliant";
      off_duty_action:
        | "submitted"
        | "resubmitted"
        | "approved"
        | "denied"
        | "returned_for_correction"
        | "withdrawn"
        | "revoked"
        | "archived";
      inbox_status: "open" | "read" | "resolved" | "dismissed";
      priority_level: "normal" | "high" | "critical";
      alert_status: "open" | "acknowledged" | "resolved" | "dismissed";
      alert_severity: "low" | "medium" | "high" | "critical";
    };
    CompositeTypes: Record<string, never>;
  };
};

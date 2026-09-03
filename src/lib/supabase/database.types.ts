export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          acknowledged_at: string | null
          alert_type: string
          assigned_to_role_code: string | null
          assigned_to_user_id: string | null
          created_at: string
          department_id: string
          id: string
          message: string
          related_firearm_id: string | null
          related_officer_user_id: string | null
          related_qualification_result_id: string | null
          related_range_day_id: string | null
          resolved_at: string | null
          severity: Database["public"]["Enums"]["alert_severity"]
          status: Database["public"]["Enums"]["alert_status"]
          title: string
        }
        Insert: {
          acknowledged_at?: string | null
          alert_type: string
          assigned_to_role_code?: string | null
          assigned_to_user_id?: string | null
          created_at?: string
          department_id: string
          id?: string
          message: string
          related_firearm_id?: string | null
          related_officer_user_id?: string | null
          related_qualification_result_id?: string | null
          related_range_day_id?: string | null
          resolved_at?: string | null
          severity: Database["public"]["Enums"]["alert_severity"]
          status?: Database["public"]["Enums"]["alert_status"]
          title: string
        }
        Update: {
          acknowledged_at?: string | null
          alert_type?: string
          assigned_to_role_code?: string | null
          assigned_to_user_id?: string | null
          created_at?: string
          department_id?: string
          id?: string
          message?: string
          related_firearm_id?: string | null
          related_officer_user_id?: string | null
          related_qualification_result_id?: string | null
          related_range_day_id?: string | null
          resolved_at?: string | null
          severity?: Database["public"]["Enums"]["alert_severity"]
          status?: Database["public"]["Enums"]["alert_status"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_assigned_to_role_code_fkey"
            columns: ["assigned_to_role_code"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "alerts_department_id_assigned_to_user_id_fkey"
            columns: ["department_id", "assigned_to_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "alerts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_department_id_related_officer_user_id_fkey"
            columns: ["department_id", "related_officer_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "alerts_related_firearm_id_department_id_fkey"
            columns: ["related_firearm_id", "department_id"]
            isOneToOne: false
            referencedRelation: "firearms"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "alerts_related_qualification_result_id_department_id_fkey"
            columns: ["related_qualification_result_id", "department_id"]
            isOneToOne: false
            referencedRelation: "qualification_results"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "alerts_related_qualification_result_id_department_id_fkey"
            columns: ["related_qualification_result_id", "department_id"]
            isOneToOne: false
            referencedRelation: "v_latest_qualification_results"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "alerts_related_range_day_id_department_id_fkey"
            columns: ["related_range_day_id", "department_id"]
            isOneToOne: false
            referencedRelation: "range_days"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "alerts_related_range_day_id_department_id_fkey"
            columns: ["related_range_day_id", "department_id"]
            isOneToOne: false
            referencedRelation: "v_range_day_summary"
            referencedColumns: ["id", "department_id"]
          },
        ]
      }
      ammunition_lots: {
        Row: {
          caliber: string
          category: string
          cost_per_round: number | null
          created_at: string
          created_by: string | null
          department_id: string
          id: string
          is_active: boolean
          load_description: string | null
          lot_number: string
          low_stock_threshold: number
          manufacturer: string
          notes: string | null
          purchase_date: string | null
          quantity_on_hand: number
          recall_flag: boolean
          replacement_due_date: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          caliber: string
          category: string
          cost_per_round?: number | null
          created_at?: string
          created_by?: string | null
          department_id: string
          id?: string
          is_active?: boolean
          load_description?: string | null
          lot_number: string
          low_stock_threshold?: number
          manufacturer: string
          notes?: string | null
          purchase_date?: string | null
          quantity_on_hand?: number
          recall_flag?: boolean
          replacement_due_date?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          caliber?: string
          category?: string
          cost_per_round?: number | null
          created_at?: string
          created_by?: string | null
          department_id?: string
          id?: string
          is_active?: boolean
          load_description?: string | null
          lot_number?: string
          low_stock_threshold?: number
          manufacturer?: string
          notes?: string | null
          purchase_date?: string | null
          quantity_on_hand?: number
          recall_flag?: boolean
          replacement_due_date?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ammunition_lots_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      ammunition_reconciliation_items: {
        Row: {
          created_at: string
          department_id: string
          expected_quantity: number
          explanation: string | null
          id: string
          lot_id: string
          physical_quantity: number | null
          reconciliation_id: string
          variance: number | null
        }
        Insert: {
          created_at?: string
          department_id: string
          expected_quantity: number
          explanation?: string | null
          id?: string
          lot_id: string
          physical_quantity?: number | null
          reconciliation_id: string
          variance?: number | null
        }
        Update: {
          created_at?: string
          department_id?: string
          expected_quantity?: number
          explanation?: string | null
          id?: string
          lot_id?: string
          physical_quantity?: number | null
          reconciliation_id?: string
          variance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ammunition_reconciliation_items_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ammunition_reconciliation_items_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "ammunition_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ammunition_reconciliation_items_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "ammunition_reconciliations"
            referencedColumns: ["id"]
          },
        ]
      }
      ammunition_reconciliations: {
        Row: {
          certified_at: string | null
          certified_by: string | null
          created_at: string
          created_by: string
          cycle_end: string
          cycle_name: string
          cycle_start: string
          cycle_year: number
          department_id: string
          id: string
          notes: string | null
          status: string
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          certified_at?: string | null
          certified_by?: string | null
          created_at?: string
          created_by: string
          cycle_end: string
          cycle_name: string
          cycle_start: string
          cycle_year: number
          department_id: string
          id?: string
          notes?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          certified_at?: string | null
          certified_by?: string | null
          created_at?: string
          created_by?: string
          cycle_end?: string
          cycle_name?: string
          cycle_start?: string
          cycle_year?: number
          department_id?: string
          id?: string
          notes?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ammunition_reconciliations_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      ammunition_transactions: {
        Row: {
          actor_user_id: string
          category: string
          created_at: string
          department_id: string
          id: string
          lot_id: string
          notes: string | null
          quantity: number
          quantity_change: number
          reason: string | null
          recipient_name: string | null
          recipient_type: string | null
          reference: string | null
          transaction_date: string
          transaction_type: string
        }
        Insert: {
          actor_user_id: string
          category: string
          created_at?: string
          department_id: string
          id?: string
          lot_id: string
          notes?: string | null
          quantity: number
          quantity_change: number
          reason?: string | null
          recipient_name?: string | null
          recipient_type?: string | null
          reference?: string | null
          transaction_date?: string
          transaction_type: string
        }
        Update: {
          actor_user_id?: string
          category?: string
          created_at?: string
          department_id?: string
          id?: string
          lot_id?: string
          notes?: string | null
          quantity?: number
          quantity_change?: number
          reason?: string | null
          recipient_name?: string | null
          recipient_type?: string | null
          reference?: string | null
          transaction_date?: string
          transaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ammunition_transactions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ammunition_transactions_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "ammunition_lots"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by_user_id: string | null
          attachment_type: string
          department_id: string
          description: string | null
          entity_id: string | null
          entity_key: string | null
          entity_type: string
          file_name: string
          file_size: number
          id: string
          mime_type: string
          storage_path: string
          uploaded_at: string
          uploaded_by_user_id: string
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by_user_id?: string | null
          attachment_type?: string
          department_id: string
          description?: string | null
          entity_id?: string | null
          entity_key?: string | null
          entity_type: string
          file_name: string
          file_size: number
          id?: string
          mime_type: string
          storage_path: string
          uploaded_at?: string
          uploaded_by_user_id: string
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by_user_id?: string | null
          attachment_type?: string
          department_id?: string
          description?: string | null
          entity_id?: string | null
          entity_key?: string | null
          entity_type?: string
          file_name?: string
          file_size?: number
          id?: string
          mime_type?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          department_id: string
          entity_id: string | null
          entity_type: string
          id: number
          new_value: Json | null
          previous_value: Json | null
          summary: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          department_id: string
          entity_id?: string | null
          entity_type: string
          id?: never
          new_value?: Json | null
          previous_value?: Json | null
          summary?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          department_id?: string
          entity_id?: string | null
          entity_type?: string
          id?: never
          new_value?: Json | null
          previous_value?: Json | null
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          change_note: string
          changed_by_user_id: string
          changed_fields: string[]
          created_at: string
          department_id: string
          entity_id: string
          entity_type: string
          id: string
          new_values: Json
          old_values: Json
        }
        Insert: {
          action: string
          change_note: string
          changed_by_user_id: string
          changed_fields?: string[]
          created_at?: string
          department_id: string
          entity_id: string
          entity_type: string
          id?: string
          new_values: Json
          old_values: Json
        }
        Update: {
          action?: string
          change_note?: string
          changed_by_user_id?: string
          changed_fields?: string[]
          created_at?: string
          department_id?: string
          entity_id?: string
          entity_type?: string
          id?: string
          new_values?: Json
          old_values?: Json
        }
        Relationships: []
      }
      certification_types: {
        Row: {
          category: string
          created_at: string
          created_by_user_id: string | null
          default_due_soon_days: number
          default_valid_days: number | null
          department_id: string
          description: string | null
          expiration_required: boolean
          id: string
          is_active: boolean
          issuing_organization: string | null
          name: string
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          created_by_user_id?: string | null
          default_due_soon_days?: number
          default_valid_days?: number | null
          department_id: string
          description?: string | null
          expiration_required?: boolean
          id?: string
          is_active?: boolean
          issuing_organization?: string | null
          name: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          created_by_user_id?: string | null
          default_due_soon_days?: number
          default_valid_days?: number | null
          department_id?: string
          description?: string | null
          expiration_required?: boolean
          id?: string
          is_active?: boolean
          issuing_organization?: string | null
          name?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "certification_types_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      department_certification_requirements: {
        Row: {
          certification_type_id: string
          created_at: string
          created_by_user_id: string | null
          department_id: string
          due_soon_days: number | null
          id: string
          is_active: boolean
          is_required: boolean
          notes: string | null
          updated_at: string
          updated_by_user_id: string | null
          valid_days: number | null
        }
        Insert: {
          certification_type_id: string
          created_at?: string
          created_by_user_id?: string | null
          department_id: string
          due_soon_days?: number | null
          id?: string
          is_active?: boolean
          is_required?: boolean
          notes?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
          valid_days?: number | null
        }
        Update: {
          certification_type_id?: string
          created_at?: string
          created_by_user_id?: string | null
          department_id?: string
          due_soon_days?: number | null
          id?: string
          is_active?: boolean
          is_required?: boolean
          notes?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
          valid_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "department_certification_requirement_certification_type_id_fkey"
            columns: ["certification_type_id"]
            isOneToOne: false
            referencedRelation: "certification_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_certification_requirements_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      department_equipment_requirements: {
        Row: {
          affects_readiness: boolean
          created_at: string
          created_by: string | null
          department_id: string
          due_soon_days: number | null
          equipment_type_id: string
          id: string
          inspection_due_soon_days: number | null
          inspection_interval_days: number | null
          is_active: boolean
          is_required: boolean
          notes: string | null
          required_quantity: number
          scope_type: string
          scope_value: string
          updated_at: string
          updated_by: string | null
          valid_days: number | null
        }
        Insert: {
          affects_readiness?: boolean
          created_at?: string
          created_by?: string | null
          department_id: string
          due_soon_days?: number | null
          equipment_type_id: string
          id?: string
          inspection_due_soon_days?: number | null
          inspection_interval_days?: number | null
          is_active?: boolean
          is_required?: boolean
          notes?: string | null
          required_quantity?: number
          scope_type?: string
          scope_value?: string
          updated_at?: string
          updated_by?: string | null
          valid_days?: number | null
        }
        Update: {
          affects_readiness?: boolean
          created_at?: string
          created_by?: string | null
          department_id?: string
          due_soon_days?: number | null
          equipment_type_id?: string
          id?: string
          inspection_due_soon_days?: number | null
          inspection_interval_days?: number | null
          is_active?: boolean
          is_required?: boolean
          notes?: string | null
          required_quantity?: number
          scope_type?: string
          scope_value?: string
          updated_at?: string
          updated_by?: string | null
          valid_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "department_equipment_requirements_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_equipment_requirements_equipment_type_id_fkey"
            columns: ["equipment_type_id"]
            isOneToOne: false
            referencedRelation: "equipment_types"
            referencedColumns: ["id"]
          },
        ]
      }
      department_feature_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          department_id: string
          feature_code: string
          id: string
          new_enabled: boolean
          previous_enabled: boolean | null
          reason: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          department_id: string
          feature_code: string
          id?: string
          new_enabled: boolean
          previous_enabled?: boolean | null
          reason?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          department_id?: string
          feature_code?: string
          id?: string
          new_enabled?: boolean
          previous_enabled?: boolean | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "department_feature_events_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_feature_events_feature_code_fkey"
            columns: ["feature_code"]
            isOneToOne: false
            referencedRelation: "feature_catalog"
            referencedColumns: ["code"]
          },
        ]
      }
      department_features: {
        Row: {
          department_id: string
          disabled_at: string | null
          enabled_at: string | null
          feature_code: string
          is_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          department_id: string
          disabled_at?: string | null
          enabled_at?: string | null
          feature_code: string
          is_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          department_id?: string
          disabled_at?: string | null
          enabled_at?: string | null
          feature_code?: string
          is_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "department_features_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_features_feature_code_fkey"
            columns: ["feature_code"]
            isOneToOne: false
            referencedRelation: "feature_catalog"
            referencedColumns: ["code"]
          },
        ]
      }
      department_group_members: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          department_id: string
          group_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          department_id: string
          group_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          department_id?: string
          group_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_group_members_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "department_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_group_members_membership_fk"
            columns: ["department_id", "user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
        ]
      }
      department_groups: {
        Row: {
          created_at: string
          created_by: string | null
          department_id: string
          description: string | null
          group_type: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department_id: string
          description?: string | null
          group_type?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department_id?: string
          description?: string | null
          group_type?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_groups_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      department_membership_roles: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          department_id: string
          role_code: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          department_id: string
          role_code: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          department_id?: string
          role_code?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_membership_roles_department_id_user_id_fkey"
            columns: ["department_id", "user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "department_membership_roles_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["code"]
          },
        ]
      }
      department_memberships: {
        Row: {
          activation_status: string
          badge_number: string | null
          created_at: string
          deactivated_at: string | null
          department_id: string
          employee_number: string | null
          is_active: boolean
          joined_at: string
          rank_title: string | null
          unit_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          activation_status?: string
          badge_number?: string | null
          created_at?: string
          deactivated_at?: string | null
          department_id: string
          employee_number?: string | null
          is_active?: boolean
          joined_at?: string
          rank_title?: string | null
          unit_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          activation_status?: string
          badge_number?: string | null
          created_at?: string
          deactivated_at?: string | null
          department_id?: string
          employee_number?: string | null
          is_active?: boolean
          joined_at?: string
          rank_title?: string | null
          unit_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_memberships_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      department_qualification_standard_components: {
        Row: {
          created_at: string
          department_id: string
          id: string
          is_active: boolean
          is_required: boolean
          maximum_score: number | null
          minimum_hits: number | null
          name: string
          passing_score: number | null
          passing_time_seconds: number | null
          qualification_standard_id: string
          scoring_basis: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id: string
          id?: string
          is_active?: boolean
          is_required?: boolean
          maximum_score?: number | null
          minimum_hits?: number | null
          name: string
          passing_score?: number | null
          passing_time_seconds?: number | null
          qualification_standard_id: string
          scoring_basis: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string
          id?: string
          is_active?: boolean
          is_required?: boolean
          maximum_score?: number | null
          minimum_hits?: number | null
          name?: string
          passing_score?: number | null
          passing_time_seconds?: number | null
          qualification_standard_id?: string
          scoring_basis?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_qualification_standar_qualification_standard_id_fkey"
            columns: ["qualification_standard_id"]
            isOneToOne: false
            referencedRelation: "department_qualification_standards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_qualification_standard_components_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      department_qualification_standards: {
        Row: {
          created_at: string
          created_by: string | null
          department_id: string
          description: string | null
          firearm_type: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
          validity_days: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department_id: string
          description?: string | null
          firearm_type?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          validity_days?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department_id?: string
          description?: string | null
          firearm_type?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          validity_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "department_qualification_standards_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      department_role_permissions: {
        Row: {
          department_id: string
          granted_at: string
          granted_by: string | null
          permission_code: string
          role_code: string
        }
        Insert: {
          department_id: string
          granted_at?: string
          granted_by?: string | null
          permission_code: string
          role_code: string
        }
        Update: {
          department_id?: string
          granted_at?: string
          granted_by?: string | null
          permission_code?: string
          role_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_role_permissions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_role_permissions_permission_code_fkey"
            columns: ["permission_code"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "department_role_permissions_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["code"]
          },
        ]
      }
      department_rules: {
        Row: {
          allow_personally_owned_rifles: boolean
          battery_check_interval_days: number
          created_at: string
          department_id: string
          fall_cycle_end: string
          fall_cycle_start: string
          inspection_due_soon_days: number
          inspection_interval_days: number
          off_duty_renewal_days: number
          personal_rifle_approval_months: number
          personal_rifle_policy_text: string
          qualification_due_soon_days: number
          qualification_valid_days: number
          require_personal_rifle_annual_reinspection: boolean
          require_personal_rifle_armorer_inspection: boolean
          require_personal_rifle_chief_approval: boolean
          require_personal_rifle_qualification: boolean
          require_personal_rifle_spec_acknowledgment: boolean
          require_rifle_familiarization: boolean
          spring_cycle_end: string
          spring_cycle_start: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allow_personally_owned_rifles?: boolean
          battery_check_interval_days?: number
          created_at?: string
          department_id: string
          fall_cycle_end?: string
          fall_cycle_start?: string
          inspection_due_soon_days?: number
          inspection_interval_days?: number
          off_duty_renewal_days?: number
          personal_rifle_approval_months?: number
          personal_rifle_policy_text?: string
          qualification_due_soon_days?: number
          qualification_valid_days?: number
          require_personal_rifle_annual_reinspection?: boolean
          require_personal_rifle_armorer_inspection?: boolean
          require_personal_rifle_chief_approval?: boolean
          require_personal_rifle_qualification?: boolean
          require_personal_rifle_spec_acknowledgment?: boolean
          require_rifle_familiarization?: boolean
          spring_cycle_end?: string
          spring_cycle_start?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allow_personally_owned_rifles?: boolean
          battery_check_interval_days?: number
          created_at?: string
          department_id?: string
          fall_cycle_end?: string
          fall_cycle_start?: string
          inspection_due_soon_days?: number
          inspection_interval_days?: number
          off_duty_renewal_days?: number
          personal_rifle_approval_months?: number
          personal_rifle_policy_text?: string
          qualification_due_soon_days?: number
          qualification_valid_days?: number
          require_personal_rifle_annual_reinspection?: boolean
          require_personal_rifle_armorer_inspection?: boolean
          require_personal_rifle_chief_approval?: boolean
          require_personal_rifle_qualification?: boolean
          require_personal_rifle_spec_acknowledgment?: boolean
          require_rifle_familiarization?: boolean
          spring_cycle_end?: string
          spring_cycle_start?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "department_rules_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: true
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      department_security_settings: {
        Row: {
          created_at: string
          data_retention_days: number
          department_id: string
          export_logging_enabled: boolean
          require_mfa_policy: boolean
          session_timeout_minutes: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          data_retention_days?: number
          department_id: string
          export_logging_enabled?: boolean
          require_mfa_policy?: boolean
          session_timeout_minutes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          data_retention_days?: number
          department_id?: string
          export_logging_enabled?: boolean
          require_mfa_policy?: boolean
          session_timeout_minutes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "department_security_settings_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: true
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      department_titles: {
        Row: {
          created_at: string
          created_by: string | null
          department_id: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department_id: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department_id?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_titles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      department_units: {
        Row: {
          created_at: string
          created_by: string | null
          department_id: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department_id: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department_id?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_units_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          accent_color: string
          agency_type: string
          civilian_staff: number
          county: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          login_theme: string
          name: string
          patch_url: string | null
          primary_contact_user_id: string | null
          short_name: string | null
          slug: string
          state: string | null
          sworn_officers: number
          timezone: string
          updated_at: string
        }
        Insert: {
          accent_color?: string
          agency_type?: string
          civilian_staff?: number
          county?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          login_theme?: string
          name: string
          patch_url?: string | null
          primary_contact_user_id?: string | null
          short_name?: string | null
          slug: string
          state?: string | null
          sworn_officers?: number
          timezone?: string
          updated_at?: string
        }
        Update: {
          accent_color?: string
          agency_type?: string
          civilian_staff?: number
          county?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          login_theme?: string
          name?: string
          patch_url?: string | null
          primary_contact_user_id?: string | null
          short_name?: string | null
          slug?: string
          state?: string | null
          sworn_officers?: number
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_primary_contact_user_id_fkey"
            columns: ["primary_contact_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      drill_run_results: {
        Row: {
          completed: boolean
          deficiency_observed: boolean
          department_id: string
          firearm_id: string | null
          hit_count: number | null
          id: string
          instructor_user_id: string
          notes: string | null
          officer_user_id: string
          passed: boolean | null
          range_day_drill_id: string
          range_day_id: string
          recorded_at: string
          remedial_training_recommended: boolean
          run_number: number
          score: number | null
          scoring_format_snapshot: Database["public"]["Enums"]["scoring_format"]
          time_seconds: number | null
          updated_at: string
        }
        Insert: {
          completed?: boolean
          deficiency_observed?: boolean
          department_id: string
          firearm_id?: string | null
          hit_count?: number | null
          id?: string
          instructor_user_id: string
          notes?: string | null
          officer_user_id: string
          passed?: boolean | null
          range_day_drill_id: string
          range_day_id: string
          recorded_at?: string
          remedial_training_recommended?: boolean
          run_number: number
          score?: number | null
          scoring_format_snapshot: Database["public"]["Enums"]["scoring_format"]
          time_seconds?: number | null
          updated_at?: string
        }
        Update: {
          completed?: boolean
          deficiency_observed?: boolean
          department_id?: string
          firearm_id?: string | null
          hit_count?: number | null
          id?: string
          instructor_user_id?: string
          notes?: string | null
          officer_user_id?: string
          passed?: boolean | null
          range_day_drill_id?: string
          range_day_id?: string
          recorded_at?: string
          remedial_training_recommended?: boolean
          run_number?: number
          score?: number | null
          scoring_format_snapshot?: Database["public"]["Enums"]["scoring_format"]
          time_seconds?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drill_run_results_department_id_instructor_user_id_fkey"
            columns: ["department_id", "instructor_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "drill_run_results_department_id_officer_user_id_fkey"
            columns: ["department_id", "officer_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "drill_run_results_firearm_id_department_id_fkey"
            columns: ["firearm_id", "department_id"]
            isOneToOne: false
            referencedRelation: "firearms"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "drill_run_results_range_day_drill_id_department_id_fkey"
            columns: ["range_day_drill_id", "department_id"]
            isOneToOne: false
            referencedRelation: "range_day_drills"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "drill_run_results_range_day_id_department_id_fkey"
            columns: ["range_day_id", "department_id"]
            isOneToOne: false
            referencedRelation: "range_days"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "drill_run_results_range_day_id_department_id_fkey"
            columns: ["range_day_id", "department_id"]
            isOneToOne: false
            referencedRelation: "v_range_day_summary"
            referencedColumns: ["id", "department_id"]
          },
        ]
      }
      drill_templates: {
        Row: {
          any_firearm_type: boolean
          category: Database["public"]["Enums"]["drill_category"]
          created_at: string
          created_by_user_id: string
          default_max_score: number | null
          default_minimum_hits: number | null
          default_passing_score: number | null
          default_passing_time_seconds: number | null
          default_required: boolean
          default_run_count: number
          department_id: string
          description: string | null
          difficulty: Database["public"]["Enums"]["drill_difficulty"] | null
          estimated_minutes: number | null
          firearm_type: Database["public"]["Enums"]["firearm_type"] | null
          id: string
          instructions: string | null
          name: string
          notes: string | null
          round_count: number | null
          scoring_format: Database["public"]["Enums"]["scoring_format"]
          status: Database["public"]["Enums"]["drill_library_status"]
          tags: string[]
          updated_at: string
        }
        Insert: {
          any_firearm_type?: boolean
          category: Database["public"]["Enums"]["drill_category"]
          created_at?: string
          created_by_user_id: string
          default_max_score?: number | null
          default_minimum_hits?: number | null
          default_passing_score?: number | null
          default_passing_time_seconds?: number | null
          default_required?: boolean
          default_run_count?: number
          department_id: string
          description?: string | null
          difficulty?: Database["public"]["Enums"]["drill_difficulty"] | null
          estimated_minutes?: number | null
          firearm_type?: Database["public"]["Enums"]["firearm_type"] | null
          id?: string
          instructions?: string | null
          name: string
          notes?: string | null
          round_count?: number | null
          scoring_format: Database["public"]["Enums"]["scoring_format"]
          status?: Database["public"]["Enums"]["drill_library_status"]
          tags?: string[]
          updated_at?: string
        }
        Update: {
          any_firearm_type?: boolean
          category?: Database["public"]["Enums"]["drill_category"]
          created_at?: string
          created_by_user_id?: string
          default_max_score?: number | null
          default_minimum_hits?: number | null
          default_passing_score?: number | null
          default_passing_time_seconds?: number | null
          default_required?: boolean
          default_run_count?: number
          department_id?: string
          description?: string | null
          difficulty?: Database["public"]["Enums"]["drill_difficulty"] | null
          estimated_minutes?: number | null
          firearm_type?: Database["public"]["Enums"]["firearm_type"] | null
          id?: string
          instructions?: string | null
          name?: string
          notes?: string | null
          round_count?: number | null
          scoring_format?: Database["public"]["Enums"]["scoring_format"]
          status?: Database["public"]["Enums"]["drill_library_status"]
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drill_templates_department_id_created_by_user_id_fkey"
            columns: ["department_id", "created_by_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "drill_templates_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_asset_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          assigned_user_id: string
          assignment_notes: string | null
          created_at: string
          department_id: string
          equipment_asset_id: string
          id: string
          return_notes: string | null
          returned_at: string | null
          returned_by: string | null
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          assigned_user_id: string
          assignment_notes?: string | null
          created_at?: string
          department_id: string
          equipment_asset_id: string
          id?: string
          return_notes?: string | null
          returned_at?: string | null
          returned_by?: string | null
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          assigned_user_id?: string
          assignment_notes?: string | null
          created_at?: string
          department_id?: string
          equipment_asset_id?: string
          id?: string
          return_notes?: string | null
          returned_at?: string | null
          returned_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_asset_assignments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_asset_assignments_equipment_asset_id_fkey"
            columns: ["equipment_asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_assets: {
        Row: {
          assigned_location: string | null
          assigned_user_id: string | null
          assigned_vehicle_id: string | null
          asset_number: string | null
          created_at: string
          created_by: string | null
          department_id: string
          document_url: string | null
          equipment_type_id: string
          expiration_date: string | null
          id: string
          issue_date: string | null
          last_inspection_date: string | null
          lifecycle_status: string
          lot_number: string | null
          manufacturer: string | null
          model: string | null
          next_inspection_date: string | null
          notes: string | null
          removal_reason: string | null
          removed_at: string | null
          removed_by: string | null
          serial_number: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assigned_location?: string | null
          assigned_user_id?: string | null
          assigned_vehicle_id?: string | null
          asset_number?: string | null
          created_at?: string
          created_by?: string | null
          department_id: string
          document_url?: string | null
          equipment_type_id: string
          expiration_date?: string | null
          id?: string
          issue_date?: string | null
          last_inspection_date?: string | null
          lifecycle_status?: string
          lot_number?: string | null
          manufacturer?: string | null
          model?: string | null
          next_inspection_date?: string | null
          notes?: string | null
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          serial_number?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assigned_location?: string | null
          assigned_user_id?: string | null
          assigned_vehicle_id?: string | null
          asset_number?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string
          document_url?: string | null
          equipment_type_id?: string
          expiration_date?: string | null
          id?: string
          issue_date?: string | null
          last_inspection_date?: string | null
          lifecycle_status?: string
          lot_number?: string | null
          manufacturer?: string | null
          model?: string | null
          next_inspection_date?: string | null
          notes?: string | null
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          serial_number?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_assets_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_assets_equipment_type_id_fkey"
            columns: ["equipment_type_id"]
            isOneToOne: false
            referencedRelation: "equipment_types"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_types: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          default_due_soon_days: number
          default_inspection_due_soon_days: number
          default_inspection_interval_days: number | null
          default_valid_days: number | null
          department_id: string
          description: string | null
          expiration_required: boolean
          id: string
          inspection_required: boolean
          is_active: boolean
          name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string | null
          default_due_soon_days?: number
          default_inspection_due_soon_days?: number
          default_inspection_interval_days?: number | null
          default_valid_days?: number | null
          department_id: string
          description?: string | null
          expiration_required?: boolean
          id?: string
          inspection_required?: boolean
          is_active?: boolean
          name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          default_due_soon_days?: number
          default_inspection_due_soon_days?: number
          default_inspection_interval_days?: number | null
          default_valid_days?: number | null
          department_id?: string
          description?: string | null
          expiration_required?: boolean
          id?: string
          inspection_required?: boolean
          is_active?: boolean
          name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_types_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_catalog: {
        Row: {
          code: string
          created_at: string
          description: string | null
          display_name: string
          is_active: boolean
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          display_name: string
          is_active?: boolean
          sort_order?: number
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          display_name?: string
          is_active?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      firearm_assignments: {
        Row: {
          assigned_at: string
          assigned_by_user_id: string | null
          assigned_to_user_id: string
          condition_at_issue: string | null
          condition_at_return: string | null
          created_at: string
          department_id: string
          firearm_id: string
          id: string
          issue_condition: string | null
          magazine_description: string | null
          magazine_discrepancy_reason: string | null
          magazines_expected_return: number | null
          magazines_issued: number
          magazines_returned: number | null
          notes: string | null
          return_condition: string | null
          returned_at: string | null
          returned_by_user_id: string | null
          returned_to_user_id: string | null
          updated_at: string
        }
        Insert: {
          assigned_at?: string
          assigned_by_user_id?: string | null
          assigned_to_user_id: string
          condition_at_issue?: string | null
          condition_at_return?: string | null
          created_at?: string
          department_id: string
          firearm_id: string
          id?: string
          issue_condition?: string | null
          magazine_description?: string | null
          magazine_discrepancy_reason?: string | null
          magazines_expected_return?: number | null
          magazines_issued?: number
          magazines_returned?: number | null
          notes?: string | null
          return_condition?: string | null
          returned_at?: string | null
          returned_by_user_id?: string | null
          returned_to_user_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_at?: string
          assigned_by_user_id?: string | null
          assigned_to_user_id?: string
          condition_at_issue?: string | null
          condition_at_return?: string | null
          created_at?: string
          department_id?: string
          firearm_id?: string
          id?: string
          issue_condition?: string | null
          magazine_description?: string | null
          magazine_discrepancy_reason?: string | null
          magazines_expected_return?: number | null
          magazines_issued?: number
          magazines_returned?: number | null
          notes?: string | null
          return_condition?: string | null
          returned_at?: string | null
          returned_by_user_id?: string | null
          returned_to_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "firearm_assignments_department_id_assigned_to_user_id_fkey"
            columns: ["department_id", "assigned_to_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "firearm_assignments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "firearm_assignments_firearm_id_department_id_fkey"
            columns: ["firearm_id", "department_id"]
            isOneToOne: false
            referencedRelation: "firearms"
            referencedColumns: ["id", "department_id"]
          },
        ]
      }
      firearm_inspection_items: {
        Row: {
          created_at: string
          critical: boolean
          id: string
          inspection_id: string
          label: string
          note: string | null
          section: string | null
          sort_order: number
          status: string
        }
        Insert: {
          created_at?: string
          critical?: boolean
          id?: string
          inspection_id: string
          label: string
          note?: string | null
          section?: string | null
          sort_order?: number
          status: string
        }
        Update: {
          created_at?: string
          critical?: boolean
          id?: string
          inspection_id?: string
          label?: string
          note?: string | null
          section?: string | null
          sort_order?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "firearm_inspection_items_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "firearm_inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      firearm_inspections: {
        Row: {
          ammunition_removed: string | null
          assignee_name: string | null
          cleaning_condition: string | null
          corrective_action: string | null
          created_at: string
          department_id: string
          findings: string | null
          firearm_id: string
          follow_up_date: string | null
          id: string
          inspected_by_user_id: string
          inspection_date: string
          inspection_location: string | null
          inspection_reason: string | null
          inspection_type: string | null
          inspector_name: string | null
          magazines_presented: string | null
          next_inspection_due: string | null
          notes: string | null
          optic_battery_status: string | null
          reason: Database["public"]["Enums"]["inspection_reason"]
          result: string | null
          returned_to_service: boolean
          round_count: string | null
          service_recommendation: string | null
          updated_at: string
          weapon_cleared: string | null
        }
        Insert: {
          ammunition_removed?: string | null
          assignee_name?: string | null
          cleaning_condition?: string | null
          corrective_action?: string | null
          created_at?: string
          department_id: string
          findings?: string | null
          firearm_id: string
          follow_up_date?: string | null
          id?: string
          inspected_by_user_id: string
          inspection_date: string
          inspection_location?: string | null
          inspection_reason?: string | null
          inspection_type?: string | null
          inspector_name?: string | null
          magazines_presented?: string | null
          next_inspection_due?: string | null
          notes?: string | null
          optic_battery_status?: string | null
          reason: Database["public"]["Enums"]["inspection_reason"]
          result?: string | null
          returned_to_service?: boolean
          round_count?: string | null
          service_recommendation?: string | null
          updated_at?: string
          weapon_cleared?: string | null
        }
        Update: {
          ammunition_removed?: string | null
          assignee_name?: string | null
          cleaning_condition?: string | null
          corrective_action?: string | null
          created_at?: string
          department_id?: string
          findings?: string | null
          firearm_id?: string
          follow_up_date?: string | null
          id?: string
          inspected_by_user_id?: string
          inspection_date?: string
          inspection_location?: string | null
          inspection_reason?: string | null
          inspection_type?: string | null
          inspector_name?: string | null
          magazines_presented?: string | null
          next_inspection_due?: string | null
          notes?: string | null
          optic_battery_status?: string | null
          reason?: Database["public"]["Enums"]["inspection_reason"]
          result?: string | null
          returned_to_service?: boolean
          round_count?: string | null
          service_recommendation?: string | null
          updated_at?: string
          weapon_cleared?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "firearm_inspections_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "firearm_inspections_department_id_inspected_by_user_id_fkey"
            columns: ["department_id", "inspected_by_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "firearm_inspections_firearm_id_department_id_fkey"
            columns: ["firearm_id", "department_id"]
            isOneToOne: false
            referencedRelation: "firearms"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "firearm_inspections_firearm_id_fkey"
            columns: ["firearm_id"]
            isOneToOne: false
            referencedRelation: "firearms"
            referencedColumns: ["id"]
          },
        ]
      }
      firearm_malfunctions: {
        Row: {
          created_at: string
          department_id: string
          drill_run_result_id: string | null
          firearm_id: string
          id: string
          inspection_required: boolean
          malfunction_type: Database["public"]["Enums"]["malfunction_type"]
          notes: string | null
          occurred_at: string
          officer_user_id: string | null
          range_day_id: string | null
          removed_from_service: boolean
          reported_by_user_id: string
          resolved_on_range: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id: string
          drill_run_result_id?: string | null
          firearm_id: string
          id?: string
          inspection_required?: boolean
          malfunction_type: Database["public"]["Enums"]["malfunction_type"]
          notes?: string | null
          occurred_at?: string
          officer_user_id?: string | null
          range_day_id?: string | null
          removed_from_service?: boolean
          reported_by_user_id: string
          resolved_on_range?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string
          drill_run_result_id?: string | null
          firearm_id?: string
          id?: string
          inspection_required?: boolean
          malfunction_type?: Database["public"]["Enums"]["malfunction_type"]
          notes?: string | null
          occurred_at?: string
          officer_user_id?: string | null
          range_day_id?: string | null
          removed_from_service?: boolean
          reported_by_user_id?: string
          resolved_on_range?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "firearm_malfunctions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "firearm_malfunctions_department_id_officer_user_id_fkey"
            columns: ["department_id", "officer_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "firearm_malfunctions_department_id_reported_by_user_id_fkey"
            columns: ["department_id", "reported_by_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "firearm_malfunctions_drill_run_result_id_department_id_fkey"
            columns: ["drill_run_result_id", "department_id"]
            isOneToOne: false
            referencedRelation: "drill_run_results"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "firearm_malfunctions_firearm_id_department_id_fkey"
            columns: ["firearm_id", "department_id"]
            isOneToOne: false
            referencedRelation: "firearms"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "firearm_malfunctions_range_day_id_department_id_fkey"
            columns: ["range_day_id", "department_id"]
            isOneToOne: false
            referencedRelation: "range_days"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "firearm_malfunctions_range_day_id_department_id_fkey"
            columns: ["range_day_id", "department_id"]
            isOneToOne: false
            referencedRelation: "v_range_day_summary"
            referencedColumns: ["id", "department_id"]
          },
        ]
      }
      firearm_status_history: {
        Row: {
          changed_at: string
          changed_by_user_id: string | null
          department_id: string
          firearm_id: string
          id: string
          new_status: string
          notes: string | null
          old_status: string | null
        }
        Insert: {
          changed_at?: string
          changed_by_user_id?: string | null
          department_id: string
          firearm_id: string
          id?: string
          new_status: string
          notes?: string | null
          old_status?: string | null
        }
        Update: {
          changed_at?: string
          changed_by_user_id?: string | null
          department_id?: string
          firearm_id?: string
          id?: string
          new_status?: string
          notes?: string | null
          old_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "firearm_status_history_firearm_id_fkey"
            columns: ["firearm_id"]
            isOneToOne: false
            referencedRelation: "firearms"
            referencedColumns: ["id"]
          },
        ]
      }
      firearms: {
        Row: {
          acquisition_date: string | null
          archive_reason: string | null
          archived_at: string | null
          archived_by_user_id: string | null
          asset_number: string | null
          caliber: string
          condition_status: string
          created_at: string
          created_by: string | null
          department_id: string
          firearm_type: Database["public"]["Enums"]["firearm_type"]
          id: string
          is_active: boolean
          last_inspection_date: string | null
          make: string
          model: string
          needs_attention: boolean
          attention_reasons: string[]
          next_inspection_due: string | null
          notes: string | null
          retired_date: string | null
          round_count: number
          serial_number: string
          status: Database["public"]["Enums"]["firearm_status"]
          updated_at: string
        }
        Insert: {
          acquisition_date?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by_user_id?: string | null
          asset_number?: string | null
          caliber: string
          condition_status?: string
          created_at?: string
          created_by?: string | null
          department_id: string
          firearm_type?: Database["public"]["Enums"]["firearm_type"]
          id?: string
          is_active?: boolean
          last_inspection_date?: string | null
          make: string
          model: string
          needs_attention?: boolean
          attention_reasons?: string[]
          next_inspection_due?: string | null
          notes?: string | null
          retired_date?: string | null
          round_count?: number
          serial_number: string
          status?: Database["public"]["Enums"]["firearm_status"]
          updated_at?: string
        }
        Update: {
          acquisition_date?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by_user_id?: string | null
          asset_number?: string | null
          caliber?: string
          condition_status?: string
          created_at?: string
          created_by?: string | null
          department_id?: string
          firearm_type?: Database["public"]["Enums"]["firearm_type"]
          id?: string
          is_active?: boolean
          last_inspection_date?: string | null
          make?: string
          model?: string
          needs_attention?: boolean
          attention_reasons?: string[]
          next_inspection_due?: string | null
          notes?: string | null
          retired_date?: string | null
          round_count?: number
          serial_number?: string
          status?: Database["public"]["Enums"]["firearm_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "firearms_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_items: {
        Row: {
          assigned_to_role_code: string | null
          assigned_to_user_id: string | null
          created_at: string
          created_by_user_id: string | null
          department_id: string
          due_at: string | null
          href: string | null
          id: string
          message: string
          priority: Database["public"]["Enums"]["priority_level"]
          read_at: string | null
          resolved_at: string | null
          source_id: string | null
          source_type: string
          status: Database["public"]["Enums"]["inbox_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to_role_code?: string | null
          assigned_to_user_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          department_id: string
          due_at?: string | null
          href?: string | null
          id?: string
          message: string
          priority?: Database["public"]["Enums"]["priority_level"]
          read_at?: string | null
          resolved_at?: string | null
          source_id?: string | null
          source_type: string
          status?: Database["public"]["Enums"]["inbox_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to_role_code?: string | null
          assigned_to_user_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          department_id?: string
          due_at?: string | null
          href?: string | null
          id?: string
          message?: string
          priority?: Database["public"]["Enums"]["priority_level"]
          read_at?: string | null
          resolved_at?: string | null
          source_id?: string | null
          source_type?: string
          status?: Database["public"]["Enums"]["inbox_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbox_items_assigned_to_role_code_fkey"
            columns: ["assigned_to_role_code"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "inbox_items_department_id_assigned_to_user_id_fkey"
            columns: ["department_id", "assigned_to_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "inbox_items_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      instructor_observations: {
        Row: {
          category: string
          created_at: string
          department_id: string
          id: string
          instructor_user_id: string
          observation: string
          officer_user_id: string
          positive_observation: boolean
          range_day_id: string
          remedial_training_recommended: boolean
        }
        Insert: {
          category: string
          created_at?: string
          department_id: string
          id?: string
          instructor_user_id: string
          observation: string
          officer_user_id: string
          positive_observation?: boolean
          range_day_id: string
          remedial_training_recommended?: boolean
        }
        Update: {
          category?: string
          created_at?: string
          department_id?: string
          id?: string
          instructor_user_id?: string
          observation?: string
          officer_user_id?: string
          positive_observation?: boolean
          range_day_id?: string
          remedial_training_recommended?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "instructor_observations_department_id_instructor_user_id_fkey"
            columns: ["department_id", "instructor_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "instructor_observations_department_id_officer_user_id_fkey"
            columns: ["department_id", "officer_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "instructor_observations_range_day_id_department_id_fkey"
            columns: ["range_day_id", "department_id"]
            isOneToOne: false
            referencedRelation: "range_days"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "instructor_observations_range_day_id_department_id_fkey"
            columns: ["range_day_id", "department_id"]
            isOneToOne: false
            referencedRelation: "v_range_day_summary"
            referencedColumns: ["id", "department_id"]
          },
        ]
      }
      notification_email_queue: {
        Row: {
          attempt_count: number
          body_text: string
          created_at: string
          department_id: string
          fingerprint: string
          id: string
          last_error: string | null
          notification_key: string
          provider_message_id: string | null
          recipient_email: string
          scheduled_for: string
          sent_at: string | null
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          body_text: string
          created_at?: string
          department_id: string
          fingerprint: string
          id?: string
          last_error?: string | null
          notification_key: string
          provider_message_id?: string | null
          recipient_email: string
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          body_text?: string
          created_at?: string
          department_id?: string
          fingerprint?: string
          id?: string
          last_error?: string | null
          notification_key?: string
          provider_message_id?: string | null
          recipient_email?: string
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_events: {
        Row: {
          acknowledged_at: string | null
          created_at: string
          department_id: string
          detail: string
          fingerprint: string
          first_seen_at: string
          href: string
          id: string
          kind: string
          last_seen_at: string
          notification_key: string
          priority: string
          resolved_at: string | null
          snoozed_until: string | null
          source: string
          source_created_at: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          created_at?: string
          department_id: string
          detail: string
          fingerprint: string
          first_seen_at?: string
          href: string
          id?: string
          kind: string
          last_seen_at?: string
          notification_key: string
          priority?: string
          resolved_at?: string | null
          snoozed_until?: string | null
          source: string
          source_created_at?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          created_at?: string
          department_id?: string
          detail?: string
          fingerprint?: string
          first_seen_at?: string
          href?: string
          id?: string
          kind?: string
          last_seen_at?: string
          notification_key?: string
          priority?: string
          resolved_at?: string | null
          snoozed_until?: string | null
          source?: string
          source_created_at?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          created_at: string
          critical_email_only: boolean
          department_id: string
          digest_mode: string
          email_enabled: boolean
          id: string
          in_app_enabled: boolean
          source_preferences: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          critical_email_only?: boolean
          department_id: string
          digest_mode?: string
          email_enabled?: boolean
          id?: string
          in_app_enabled?: boolean
          source_preferences?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          critical_email_only?: boolean
          department_id?: string
          digest_mode?: string
          email_enabled?: boolean
          id?: string
          in_app_enabled?: boolean
          source_preferences?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      off_duty_firearm_history: {
        Row: {
          action: string
          actor_name: string
          actor_role: string
          actor_user_id: string
          created_at: string
          department_id: string
          id: string
          notes: string | null
          request_id: string
        }
        Insert: {
          action: string
          actor_name: string
          actor_role: string
          actor_user_id: string
          created_at?: string
          department_id: string
          id?: string
          notes?: string | null
          request_id: string
        }
        Update: {
          action?: string
          actor_name?: string
          actor_role?: string
          actor_user_id?: string
          created_at?: string
          department_id?: string
          id?: string
          notes?: string | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "off_duty_firearm_history_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "off_duty_firearm_history_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "off_duty_firearm_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      off_duty_firearm_inspections: {
        Row: {
          created_at: string
          department_id: string
          id: string
          inspected_by_user_id: string
          inspection_date: string
          notes: string | null
          request_id: string
          result: string
        }
        Insert: {
          created_at?: string
          department_id: string
          id?: string
          inspected_by_user_id: string
          inspection_date: string
          notes?: string | null
          request_id: string
          result: string
        }
        Update: {
          created_at?: string
          department_id?: string
          id?: string
          inspected_by_user_id?: string
          inspection_date?: string
          notes?: string | null
          request_id?: string
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "off_duty_firearm_inspections_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "off_duty_firearm_inspections_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "off_duty_firearm_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      off_duty_firearm_requests: {
        Row: {
          approval_date: string | null
          approval_effective_date: string | null
          approval_expiration_date: string | null
          approval_expires_on: string | null
          authorization_status: string
          caliber: string
          capacity: string | null
          compliance_status: string
          created_at: string
          decision_notes: string | null
          department_id: string
          firearm_type: string
          holster: string | null
          id: string
          inspection_reviewed: boolean
          inspection_status: string
          last_qualification_date: string | null
          make: string
          model: string
          officer_notes: string | null
          officer_user_id: string
          optic: string | null
          policy_acknowledged: boolean
          proof_of_ownership_reviewed: boolean
          proof_ownership: boolean
          qualification_exception_reason: string | null
          qualification_exception_used: boolean
          qualification_reviewed: boolean
          request_status: string
          reviewed_at: string | null
          reviewed_by_user_id: string | null
          serial_number: string
          submitted_at: string
          updated_at: string
          weapon_light: string | null
        }
        Insert: {
          approval_date?: string | null
          approval_effective_date?: string | null
          approval_expiration_date?: string | null
          approval_expires_on?: string | null
          authorization_status?: string
          caliber: string
          capacity?: string | null
          compliance_status?: string
          created_at?: string
          decision_notes?: string | null
          department_id: string
          firearm_type: string
          holster?: string | null
          id?: string
          inspection_reviewed?: boolean
          inspection_status?: string
          last_qualification_date?: string | null
          make: string
          model: string
          officer_notes?: string | null
          officer_user_id: string
          optic?: string | null
          policy_acknowledged?: boolean
          proof_of_ownership_reviewed?: boolean
          proof_ownership?: boolean
          qualification_exception_reason?: string | null
          qualification_exception_used?: boolean
          qualification_reviewed?: boolean
          request_status?: string
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          serial_number: string
          submitted_at?: string
          updated_at?: string
          weapon_light?: string | null
        }
        Update: {
          approval_date?: string | null
          approval_effective_date?: string | null
          approval_expiration_date?: string | null
          approval_expires_on?: string | null
          authorization_status?: string
          caliber?: string
          capacity?: string | null
          compliance_status?: string
          created_at?: string
          decision_notes?: string | null
          department_id?: string
          firearm_type?: string
          holster?: string | null
          id?: string
          inspection_reviewed?: boolean
          inspection_status?: string
          last_qualification_date?: string | null
          make?: string
          model?: string
          officer_notes?: string | null
          officer_user_id?: string
          optic?: string | null
          policy_acknowledged?: boolean
          proof_of_ownership_reviewed?: boolean
          proof_ownership?: boolean
          qualification_exception_reason?: string | null
          qualification_exception_used?: boolean
          qualification_reviewed?: boolean
          request_status?: string
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          serial_number?: string
          submitted_at?: string
          updated_at?: string
          weapon_light?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "off_duty_firearm_requests_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "off_duty_firearm_requests_department_id_officer_user_id_fkey"
            columns: ["department_id", "officer_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "off_duty_firearm_requests_department_id_reviewed_by_user_i_fkey"
            columns: ["department_id", "reviewed_by_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
        ]
      }
      off_duty_request_actions: {
        Row: {
          action: Database["public"]["Enums"]["off_duty_action"]
          created_at: string
          department_id: string
          from_status:
            | Database["public"]["Enums"]["off_duty_request_status"]
            | null
          id: string
          notes: string | null
          performed_by_user_id: string
          request_id: string
          to_status: Database["public"]["Enums"]["off_duty_request_status"]
        }
        Insert: {
          action: Database["public"]["Enums"]["off_duty_action"]
          created_at?: string
          department_id: string
          from_status?:
            | Database["public"]["Enums"]["off_duty_request_status"]
            | null
          id?: string
          notes?: string | null
          performed_by_user_id: string
          request_id: string
          to_status: Database["public"]["Enums"]["off_duty_request_status"]
        }
        Update: {
          action?: Database["public"]["Enums"]["off_duty_action"]
          created_at?: string
          department_id?: string
          from_status?:
            | Database["public"]["Enums"]["off_duty_request_status"]
            | null
          id?: string
          notes?: string | null
          performed_by_user_id?: string
          request_id?: string
          to_status?: Database["public"]["Enums"]["off_duty_request_status"]
        }
        Relationships: [
          {
            foreignKeyName: "off_duty_request_actions_department_id_performed_by_user_i_fkey"
            columns: ["department_id", "performed_by_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "off_duty_request_actions_request_id_department_id_fkey"
            columns: ["request_id", "department_id"]
            isOneToOne: false
            referencedRelation: "off_duty_firearm_requests"
            referencedColumns: ["id", "department_id"]
          },
        ]
      }
      permissions: {
        Row: {
          code: string
          description: string | null
          display_name: string
        }
        Insert: {
          code: string
          description?: string | null
          display_name: string
        }
        Update: {
          code?: string
          description?: string | null
          display_name?: string
        }
        Relationships: []
      }
      personal_rifle_status_history: {
        Row: {
          action: string
          actor_user_id: string
          created_at: string
          department_id: string
          from_status: string | null
          id: string
          metadata: Json
          notes: string | null
          personal_rifle_id: string
          to_status: string
        }
        Insert: {
          action: string
          actor_user_id: string
          created_at?: string
          department_id: string
          from_status?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          personal_rifle_id: string
          to_status: string
        }
        Update: {
          action?: string
          actor_user_id?: string
          created_at?: string
          department_id?: string
          from_status?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          personal_rifle_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "personal_rifle_status_history_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_rifle_status_history_personal_rifle_id_fkey"
            columns: ["personal_rifle_id"]
            isOneToOne: false
            referencedRelation: "personal_rifles"
            referencedColumns: ["id"]
          },
        ]
      }
      personal_rifles: {
        Row: {
          approval_date: string | null
          armorer_checklist: Json
          armorer_decision_notes: string | null
          armorer_reviewed_at: string | null
          armorer_reviewed_by: string | null
          barrel_length: string | null
          caliber: string
          chief_decision_notes: string | null
          chief_reviewed_at: string | null
          chief_reviewed_by: string | null
          correction_notes: string | null
          created_at: string
          department_id: string
          expiration_date: string | null
          id: string
          inspection_date: string | null
          magazine_type: string | null
          manufacturer: string
          model: string
          muzzle_device: string | null
          operating_system: string | null
          other_modifications: string | null
          owner_user_id: string
          ownership_confirmed: boolean
          qualification_verified: boolean
          qualification_verified_at: string | null
          qualification_verified_by: string | null
          revocation_notes: string | null
          revocation_reason: string | null
          serial_number: string
          sights_optic: string | null
          sling: string | null
          specification_acknowledged: boolean
          status: string
          stock_brace_configuration: string | null
          submitted_at: string | null
          suspension_notes: string | null
          suspension_reason: string | null
          trigger: string | null
          updated_at: string
          weapon_mounted_light: string | null
        }
        Insert: {
          approval_date?: string | null
          armorer_checklist?: Json
          armorer_decision_notes?: string | null
          armorer_reviewed_at?: string | null
          armorer_reviewed_by?: string | null
          barrel_length?: string | null
          caliber: string
          chief_decision_notes?: string | null
          chief_reviewed_at?: string | null
          chief_reviewed_by?: string | null
          correction_notes?: string | null
          created_at?: string
          department_id: string
          expiration_date?: string | null
          id?: string
          inspection_date?: string | null
          magazine_type?: string | null
          manufacturer: string
          model: string
          muzzle_device?: string | null
          operating_system?: string | null
          other_modifications?: string | null
          owner_user_id: string
          ownership_confirmed?: boolean
          qualification_verified?: boolean
          qualification_verified_at?: string | null
          qualification_verified_by?: string | null
          revocation_notes?: string | null
          revocation_reason?: string | null
          serial_number: string
          sights_optic?: string | null
          sling?: string | null
          specification_acknowledged?: boolean
          status?: string
          stock_brace_configuration?: string | null
          submitted_at?: string | null
          suspension_notes?: string | null
          suspension_reason?: string | null
          trigger?: string | null
          updated_at?: string
          weapon_mounted_light?: string | null
        }
        Update: {
          approval_date?: string | null
          armorer_checklist?: Json
          armorer_decision_notes?: string | null
          armorer_reviewed_at?: string | null
          armorer_reviewed_by?: string | null
          barrel_length?: string | null
          caliber?: string
          chief_decision_notes?: string | null
          chief_reviewed_at?: string | null
          chief_reviewed_by?: string | null
          correction_notes?: string | null
          created_at?: string
          department_id?: string
          expiration_date?: string | null
          id?: string
          inspection_date?: string | null
          magazine_type?: string | null
          manufacturer?: string
          model?: string
          muzzle_device?: string | null
          operating_system?: string | null
          other_modifications?: string | null
          owner_user_id?: string
          ownership_confirmed?: boolean
          qualification_verified?: boolean
          qualification_verified_at?: string | null
          qualification_verified_by?: string | null
          revocation_notes?: string | null
          revocation_reason?: string | null
          serial_number?: string
          sights_optic?: string | null
          sling?: string | null
          specification_acknowledged?: boolean
          status?: string
          stock_brace_configuration?: string | null
          submitted_at?: string | null
          suspension_notes?: string | null
          suspension_reason?: string | null
          trigger?: string | null
          updated_at?: string
          weapon_mounted_light?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "personal_rifles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      pilot_ammunition_workspaces: {
        Row: {
          department_id: string
          updated_at: string
          updated_by: string | null
          workspace: Json
        }
        Insert: {
          department_id: string
          updated_at?: string
          updated_by?: string | null
          workspace?: Json
        }
        Update: {
          department_id?: string
          updated_at?: string
          updated_by?: string | null
          workspace?: Json
        }
        Relationships: [
          {
            foreignKeyName: "pilot_ammunition_workspaces_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: true
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pilot_ammunition_workspaces_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pilot_range_workspaces: {
        Row: {
          created_at: string
          department_id: string
          updated_at: string
          updated_by_user_id: string | null
          workspace: Json
        }
        Insert: {
          created_at?: string
          department_id: string
          updated_at?: string
          updated_by_user_id?: string | null
          workspace?: Json
        }
        Update: {
          created_at?: string
          department_id?: string
          updated_at?: string
          updated_by_user_id?: string | null
          workspace?: Json
        }
        Relationships: [
          {
            foreignKeyName: "pilot_range_workspaces_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: true
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      pilot_remediation_workspaces: {
        Row: {
          department_id: string
          remediations: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          department_id: string
          remediations?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          department_id?: string
          remediations?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pilot_remediation_workspaces_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: true
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          created_by: string | null
          display_name: string | null
          is_active: boolean
          notes: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          is_active?: boolean
          notes?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          is_active?: boolean
          notes?: string | null
          user_id?: string
        }
        Relationships: []
      }
      platform_agency_accounts: {
        Row: {
          account_status: string
          created_at: string
          created_by: string | null
          department_id: string
          internal_notes: string | null
          onboarding_status: string
          pilot_start_date: string | null
          plan_type: string
          production_start_date: string | null
          updated_at: string
        }
        Insert: {
          account_status?: string
          created_at?: string
          created_by?: string | null
          department_id: string
          internal_notes?: string | null
          onboarding_status?: string
          pilot_start_date?: string | null
          plan_type?: string
          production_start_date?: string | null
          updated_at?: string
        }
        Update: {
          account_status?: string
          created_at?: string
          created_by?: string | null
          department_id?: string
          internal_notes?: string | null
          onboarding_status?: string
          pilot_start_date?: string | null
          plan_type?: string
          production_start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_agency_accounts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: true
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      qualification_course_versions: {
        Row: {
          created_at: string
          department_id: string
          description: string | null
          effective_date: string
          id: string
          is_active: boolean
          max_score: number
          passing_score: number
          qualification_course_id: string
          updated_at: string
          valid_for_months: number | null
          version_name: string
        }
        Insert: {
          created_at?: string
          department_id: string
          description?: string | null
          effective_date: string
          id?: string
          is_active?: boolean
          max_score: number
          passing_score: number
          qualification_course_id: string
          updated_at?: string
          valid_for_months?: number | null
          version_name: string
        }
        Update: {
          created_at?: string
          department_id?: string
          description?: string | null
          effective_date?: string
          id?: string
          is_active?: boolean
          max_score?: number
          passing_score?: number
          qualification_course_id?: string
          updated_at?: string
          valid_for_months?: number | null
          version_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "qualification_course_versions_qualification_course_id_depa_fkey"
            columns: ["qualification_course_id", "department_id"]
            isOneToOne: false
            referencedRelation: "qualification_courses"
            referencedColumns: ["id", "department_id"]
          },
        ]
      }
      qualification_courses: {
        Row: {
          created_at: string
          created_by_user_id: string
          department_id: string
          description: string | null
          firearm_type: Database["public"]["Enums"]["firearm_type"]
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_user_id: string
          department_id: string
          description?: string | null
          firearm_type: Database["public"]["Enums"]["firearm_type"]
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string
          department_id?: string
          description?: string | null
          firearm_type?: Database["public"]["Enums"]["firearm_type"]
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qualification_courses_department_id_created_by_user_id_fkey"
            columns: ["department_id", "created_by_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "qualification_courses_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      qualification_results: {
        Row: {
          created_at: string
          department_id: string
          drill_run_result_id: string | null
          expires_on: string | null
          firearm_id: string | null
          historical_course_name: string | null
          historical_instructor_name: string | null
          historical_passing_score: number | null
          historical_qualification_type: string | null
          historical_result_text: string | null
          id: string
          instructor_user_id: string | null
          lighting_condition: Database["public"]["Enums"]["lighting_condition"]
          notes: string | null
          officer_user_id: string
          passed: boolean | null
          qualification_course_id: string | null
          qualification_course_version_id: string | null
          qualification_date: string
          range_day_id: string | null
          record_origin: string
          score: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id: string
          drill_run_result_id?: string | null
          expires_on?: string | null
          firearm_id?: string | null
          historical_course_name?: string | null
          historical_instructor_name?: string | null
          historical_passing_score?: number | null
          historical_qualification_type?: string | null
          historical_result_text?: string | null
          id?: string
          instructor_user_id?: string | null
          lighting_condition?: Database["public"]["Enums"]["lighting_condition"]
          notes?: string | null
          officer_user_id: string
          passed?: boolean | null
          qualification_course_id?: string | null
          qualification_course_version_id?: string | null
          qualification_date: string
          range_day_id?: string | null
          record_origin?: string
          score: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string
          drill_run_result_id?: string | null
          expires_on?: string | null
          firearm_id?: string | null
          historical_course_name?: string | null
          historical_instructor_name?: string | null
          historical_passing_score?: number | null
          historical_qualification_type?: string | null
          historical_result_text?: string | null
          id?: string
          instructor_user_id?: string | null
          lighting_condition?: Database["public"]["Enums"]["lighting_condition"]
          notes?: string | null
          officer_user_id?: string
          passed?: boolean | null
          qualification_course_id?: string | null
          qualification_course_version_id?: string | null
          qualification_date?: string
          range_day_id?: string | null
          record_origin?: string
          score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qualification_results_department_id_instructor_user_id_fkey"
            columns: ["department_id", "instructor_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "qualification_results_department_id_officer_user_id_fkey"
            columns: ["department_id", "officer_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "qualification_results_drill_run_result_id_department_id_fkey"
            columns: ["drill_run_result_id", "department_id"]
            isOneToOne: false
            referencedRelation: "drill_run_results"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "qualification_results_firearm_id_department_id_fkey"
            columns: ["firearm_id", "department_id"]
            isOneToOne: false
            referencedRelation: "firearms"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "qualification_results_qualification_course_id_department_i_fkey"
            columns: ["qualification_course_id", "department_id"]
            isOneToOne: false
            referencedRelation: "qualification_courses"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "qualification_results_qualification_course_version_id_depa_fkey"
            columns: ["qualification_course_version_id", "department_id"]
            isOneToOne: false
            referencedRelation: "qualification_course_versions"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "qualification_results_range_day_id_department_id_fkey"
            columns: ["range_day_id", "department_id"]
            isOneToOne: false
            referencedRelation: "range_days"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "qualification_results_range_day_id_department_id_fkey"
            columns: ["range_day_id", "department_id"]
            isOneToOne: false
            referencedRelation: "v_range_day_summary"
            referencedColumns: ["id", "department_id"]
          },
        ]
      }
      range_day_drills: {
        Row: {
          any_firearm_type: boolean
          category: Database["public"]["Enums"]["drill_category"]
          copied_from_library_at: string | null
          created_at: string
          department_id: string
          description: string | null
          difficulty: Database["public"]["Enums"]["drill_difficulty"] | null
          display_order: number
          estimated_minutes: number | null
          firearm_type: Database["public"]["Enums"]["firearm_type"] | null
          id: string
          instructions: string | null
          max_score: number | null
          minimum_hits: number | null
          name: string
          notes: string | null
          passing_score: number | null
          passing_time_seconds: number | null
          range_day_id: string
          required: boolean
          round_count: number | null
          run_count: number
          scoring_format: Database["public"]["Enums"]["scoring_format"]
          source_template_id: string | null
          source_template_name: string | null
          updated_at: string
        }
        Insert: {
          any_firearm_type?: boolean
          category: Database["public"]["Enums"]["drill_category"]
          copied_from_library_at?: string | null
          created_at?: string
          department_id: string
          description?: string | null
          difficulty?: Database["public"]["Enums"]["drill_difficulty"] | null
          display_order?: number
          estimated_minutes?: number | null
          firearm_type?: Database["public"]["Enums"]["firearm_type"] | null
          id?: string
          instructions?: string | null
          max_score?: number | null
          minimum_hits?: number | null
          name: string
          notes?: string | null
          passing_score?: number | null
          passing_time_seconds?: number | null
          range_day_id: string
          required?: boolean
          round_count?: number | null
          run_count?: number
          scoring_format: Database["public"]["Enums"]["scoring_format"]
          source_template_id?: string | null
          source_template_name?: string | null
          updated_at?: string
        }
        Update: {
          any_firearm_type?: boolean
          category?: Database["public"]["Enums"]["drill_category"]
          copied_from_library_at?: string | null
          created_at?: string
          department_id?: string
          description?: string | null
          difficulty?: Database["public"]["Enums"]["drill_difficulty"] | null
          display_order?: number
          estimated_minutes?: number | null
          firearm_type?: Database["public"]["Enums"]["firearm_type"] | null
          id?: string
          instructions?: string | null
          max_score?: number | null
          minimum_hits?: number | null
          name?: string
          notes?: string | null
          passing_score?: number | null
          passing_time_seconds?: number | null
          range_day_id?: string
          required?: boolean
          round_count?: number | null
          run_count?: number
          scoring_format?: Database["public"]["Enums"]["scoring_format"]
          source_template_id?: string | null
          source_template_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "range_day_drills_range_day_id_department_id_fkey"
            columns: ["range_day_id", "department_id"]
            isOneToOne: false
            referencedRelation: "range_days"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "range_day_drills_range_day_id_department_id_fkey"
            columns: ["range_day_id", "department_id"]
            isOneToOne: false
            referencedRelation: "v_range_day_summary"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "range_day_drills_source_template_id_department_id_fkey"
            columns: ["source_template_id", "department_id"]
            isOneToOne: false
            referencedRelation: "drill_templates"
            referencedColumns: ["id", "department_id"]
          },
        ]
      }
      range_day_instructors: {
        Row: {
          assigned_at: string
          department_id: string
          is_lead: boolean
          range_day_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          department_id: string
          is_lead?: boolean
          range_day_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          department_id?: string
          is_lead?: boolean
          range_day_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "range_day_instructors_department_id_user_id_fkey"
            columns: ["department_id", "user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "range_day_instructors_range_day_id_department_id_fkey"
            columns: ["range_day_id", "department_id"]
            isOneToOne: false
            referencedRelation: "range_days"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "range_day_instructors_range_day_id_department_id_fkey"
            columns: ["range_day_id", "department_id"]
            isOneToOne: false
            referencedRelation: "v_range_day_summary"
            referencedColumns: ["id", "department_id"]
          },
        ]
      }
      range_day_roster: {
        Row: {
          attendance_status: Database["public"]["Enums"]["attendance_status"]
          attendance_time: string | null
          created_at: string
          department_id: string
          id: string
          notes: string | null
          officer_user_id: string
          range_day_id: string
          updated_at: string
        }
        Insert: {
          attendance_status?: Database["public"]["Enums"]["attendance_status"]
          attendance_time?: string | null
          created_at?: string
          department_id: string
          id?: string
          notes?: string | null
          officer_user_id: string
          range_day_id: string
          updated_at?: string
        }
        Update: {
          attendance_status?: Database["public"]["Enums"]["attendance_status"]
          attendance_time?: string | null
          created_at?: string
          department_id?: string
          id?: string
          notes?: string | null
          officer_user_id?: string
          range_day_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "range_day_roster_department_id_officer_user_id_fkey"
            columns: ["department_id", "officer_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "range_day_roster_range_day_id_department_id_fkey"
            columns: ["range_day_id", "department_id"]
            isOneToOne: false
            referencedRelation: "range_days"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "range_day_roster_range_day_id_department_id_fkey"
            columns: ["range_day_id", "department_id"]
            isOneToOne: false
            referencedRelation: "v_range_day_summary"
            referencedColumns: ["id", "department_id"]
          },
        ]
      }
      range_day_roster_firearms: {
        Row: {
          assigned_at: string
          department_id: string
          firearm_id: string
          is_primary: boolean
          roster_entry_id: string
        }
        Insert: {
          assigned_at?: string
          department_id: string
          firearm_id: string
          is_primary?: boolean
          roster_entry_id: string
        }
        Update: {
          assigned_at?: string
          department_id?: string
          firearm_id?: string
          is_primary?: boolean
          roster_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "range_day_roster_firearms_firearm_id_department_id_fkey"
            columns: ["firearm_id", "department_id"]
            isOneToOne: false
            referencedRelation: "firearms"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "range_day_roster_firearms_roster_entry_id_department_id_fkey"
            columns: ["roster_entry_id", "department_id"]
            isOneToOne: false
            referencedRelation: "range_day_roster"
            referencedColumns: ["id", "department_id"]
          },
        ]
      }
      range_days: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by_user_id: string
          department_id: string
          end_time: string | null
          id: string
          lead_instructor_user_id: string
          location: string
          locked_at: string | null
          locked_by_user_id: string | null
          notes: string | null
          outline: Json
          packet_status: Database["public"]["Enums"]["packet_status"]
          range_date: string
          range_type: Database["public"]["Enums"]["range_day_type"]
          staffing_notes: string | null
          start_time: string | null
          status: Database["public"]["Enums"]["range_day_status"]
          title: string
          updated_at: string
          weather: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by_user_id: string
          department_id: string
          end_time?: string | null
          id?: string
          lead_instructor_user_id: string
          location: string
          locked_at?: string | null
          locked_by_user_id?: string | null
          notes?: string | null
          outline?: Json
          packet_status?: Database["public"]["Enums"]["packet_status"]
          range_date: string
          range_type?: Database["public"]["Enums"]["range_day_type"]
          staffing_notes?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["range_day_status"]
          title: string
          updated_at?: string
          weather?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by_user_id?: string
          department_id?: string
          end_time?: string | null
          id?: string
          lead_instructor_user_id?: string
          location?: string
          locked_at?: string | null
          locked_by_user_id?: string | null
          notes?: string | null
          outline?: Json
          packet_status?: Database["public"]["Enums"]["packet_status"]
          range_date?: string
          range_type?: Database["public"]["Enums"]["range_day_type"]
          staffing_notes?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["range_day_status"]
          title?: string
          updated_at?: string
          weather?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "range_days_department_id_created_by_user_id_fkey"
            columns: ["department_id", "created_by_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "range_days_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "range_days_department_id_lead_instructor_user_id_fkey"
            columns: ["department_id", "lead_instructor_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
        ]
      }
      range_packets: {
        Row: {
          department_id: string
          generated_at: string
          generated_by_user_id: string
          id: string
          includes_drill_sheets: boolean
          includes_instructor_notes: boolean
          includes_qualification_sheets: boolean
          includes_remedial_section: boolean
          includes_roster: boolean
          range_day_id: string
          storage_path: string | null
        }
        Insert: {
          department_id: string
          generated_at?: string
          generated_by_user_id: string
          id?: string
          includes_drill_sheets?: boolean
          includes_instructor_notes?: boolean
          includes_qualification_sheets?: boolean
          includes_remedial_section?: boolean
          includes_roster?: boolean
          range_day_id: string
          storage_path?: string | null
        }
        Update: {
          department_id?: string
          generated_at?: string
          generated_by_user_id?: string
          id?: string
          includes_drill_sheets?: boolean
          includes_instructor_notes?: boolean
          includes_qualification_sheets?: boolean
          includes_remedial_section?: boolean
          includes_roster?: boolean
          range_day_id?: string
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "range_packets_department_id_generated_by_user_id_fkey"
            columns: ["department_id", "generated_by_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "range_packets_range_day_id_department_id_fkey"
            columns: ["range_day_id", "department_id"]
            isOneToOne: false
            referencedRelation: "range_days"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "range_packets_range_day_id_department_id_fkey"
            columns: ["range_day_id", "department_id"]
            isOneToOne: false
            referencedRelation: "v_range_day_summary"
            referencedColumns: ["id", "department_id"]
          },
        ]
      }
      remedial_training_recommendations: {
        Row: {
          assigned_date: string
          completed: boolean
          completed_by_user_id: string | null
          completed_date: string | null
          created_at: string
          created_by_instructor_user_id: string
          department_id: string
          id: string
          notes: string | null
          officer_user_id: string
          range_day_id: string
          reason: string
          updated_at: string
        }
        Insert: {
          assigned_date?: string
          completed?: boolean
          completed_by_user_id?: string | null
          completed_date?: string | null
          created_at?: string
          created_by_instructor_user_id: string
          department_id: string
          id?: string
          notes?: string | null
          officer_user_id: string
          range_day_id: string
          reason: string
          updated_at?: string
        }
        Update: {
          assigned_date?: string
          completed?: boolean
          completed_by_user_id?: string | null
          completed_date?: string | null
          created_at?: string
          created_by_instructor_user_id?: string
          department_id?: string
          id?: string
          notes?: string | null
          officer_user_id?: string
          range_day_id?: string
          reason?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "remedial_training_recommendat_department_id_created_by_ins_fkey"
            columns: ["department_id", "created_by_instructor_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "remedial_training_recommendat_department_id_officer_user_i_fkey"
            columns: ["department_id", "officer_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "remedial_training_recommendatio_range_day_id_department_id_fkey"
            columns: ["range_day_id", "department_id"]
            isOneToOne: false
            referencedRelation: "range_days"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "remedial_training_recommendatio_range_day_id_department_id_fkey"
            columns: ["range_day_id", "department_id"]
            isOneToOne: false
            referencedRelation: "v_range_day_summary"
            referencedColumns: ["id", "department_id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission_code: string
          role_code: string
        }
        Insert: {
          permission_code: string
          role_code: string
        }
        Update: {
          permission_code?: string
          role_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_code_fkey"
            columns: ["permission_code"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "role_permissions_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["code"]
          },
        ]
      }
      roles: {
        Row: {
          code: string
          description: string | null
          display_name: string
          sort_order: number
        }
        Insert: {
          code: string
          description?: string | null
          display_name: string
          sort_order?: number
        }
        Update: {
          code?: string
          description?: string | null
          display_name?: string
          sort_order?: number
        }
        Relationships: []
      }
      training_certifications: {
        Row: {
          certification_title: string
          certification_type_id: string | null
          created_at: string
          created_by_user_id: string | null
          credential_number: string | null
          department_id: string
          document_url: string | null
          expiration_date: string | null
          id: string
          is_active: boolean
          issue_date: string | null
          issuing_organization: string | null
          notes: string | null
          reminder_days: number[]
          updated_at: string
          updated_by_user_id: string | null
          user_id: string
        }
        Insert: {
          certification_title: string
          certification_type_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          credential_number?: string | null
          department_id: string
          document_url?: string | null
          expiration_date?: string | null
          id?: string
          is_active?: boolean
          issue_date?: string | null
          issuing_organization?: string | null
          notes?: string | null
          reminder_days?: number[]
          updated_at?: string
          updated_by_user_id?: string | null
          user_id: string
        }
        Update: {
          certification_title?: string
          certification_type_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          credential_number?: string | null
          department_id?: string
          document_url?: string | null
          expiration_date?: string | null
          id?: string
          is_active?: boolean
          issue_date?: string | null
          issuing_organization?: string | null
          notes?: string | null
          reminder_days?: number[]
          updated_at?: string
          updated_by_user_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_certifications_certification_type_id_fkey"
            columns: ["certification_type_id"]
            isOneToOne: false
            referencedRelation: "certification_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_certifications_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_active_firearm_assignments: {
        Row: {
          assigned_at: string | null
          assigned_to_name: string | null
          assigned_to_user_id: string | null
          badge_number: string | null
          caliber: string | null
          department_id: string | null
          firearm_id: string | null
          firearm_type: Database["public"]["Enums"]["firearm_type"] | null
          id: string | null
          make: string | null
          model: string | null
          rank_title: string | null
          serial_number: string | null
          unit_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "firearm_assignments_department_id_assigned_to_user_id_fkey"
            columns: ["department_id", "assigned_to_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "firearm_assignments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "firearm_assignments_firearm_id_department_id_fkey"
            columns: ["firearm_id", "department_id"]
            isOneToOne: false
            referencedRelation: "firearms"
            referencedColumns: ["id", "department_id"]
          },
        ]
      }
      v_latest_qualification_results: {
        Row: {
          created_at: string | null
          department_id: string | null
          drill_run_result_id: string | null
          expires_on: string | null
          firearm_id: string | null
          historical_course_name: string | null
          historical_instructor_name: string | null
          historical_passing_score: number | null
          historical_qualification_type: string | null
          historical_result_text: string | null
          id: string | null
          instructor_user_id: string | null
          lighting_condition:
            | Database["public"]["Enums"]["lighting_condition"]
            | null
          notes: string | null
          officer_user_id: string | null
          passed: boolean | null
          qualification_course_id: string | null
          qualification_course_version_id: string | null
          qualification_date: string | null
          range_day_id: string | null
          record_origin: string | null
          score: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qualification_results_department_id_instructor_user_id_fkey"
            columns: ["department_id", "instructor_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "qualification_results_department_id_officer_user_id_fkey"
            columns: ["department_id", "officer_user_id"]
            isOneToOne: false
            referencedRelation: "department_memberships"
            referencedColumns: ["department_id", "user_id"]
          },
          {
            foreignKeyName: "qualification_results_drill_run_result_id_department_id_fkey"
            columns: ["drill_run_result_id", "department_id"]
            isOneToOne: false
            referencedRelation: "drill_run_results"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "qualification_results_firearm_id_department_id_fkey"
            columns: ["firearm_id", "department_id"]
            isOneToOne: false
            referencedRelation: "firearms"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "qualification_results_qualification_course_id_department_i_fkey"
            columns: ["qualification_course_id", "department_id"]
            isOneToOne: false
            referencedRelation: "qualification_courses"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "qualification_results_qualification_course_version_id_depa_fkey"
            columns: ["qualification_course_version_id", "department_id"]
            isOneToOne: false
            referencedRelation: "qualification_course_versions"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "qualification_results_range_day_id_department_id_fkey"
            columns: ["range_day_id", "department_id"]
            isOneToOne: false
            referencedRelation: "range_days"
            referencedColumns: ["id", "department_id"]
          },
          {
            foreignKeyName: "qualification_results_range_day_id_department_id_fkey"
            columns: ["range_day_id", "department_id"]
            isOneToOne: false
            referencedRelation: "v_range_day_summary"
            referencedColumns: ["id", "department_id"]
          },
        ]
      }
      v_range_day_summary: {
        Row: {
          attended_count: number | null
          completed_result_count: number | null
          department_id: string | null
          drill_count: number | null
          id: string | null
          location: string | null
          packet_status: Database["public"]["Enums"]["packet_status"] | null
          range_date: string | null
          range_type: Database["public"]["Enums"]["range_day_type"] | null
          roster_count: number | null
          status: Database["public"]["Enums"]["range_day_status"] | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "range_days_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      apply_off_duty_firearm_decision: {
        Args: {
          p_action: string
          p_actor_name: string
          p_actor_role: string
          p_actor_user_id: string
          p_department_id: string
          p_effective_date?: string
          p_expiration_date?: string
          p_notes: string
          p_qualification_exception_reason?: string
          p_qualification_exception_used?: boolean
          p_request_id: string
        }
        Returns: undefined
      }
      can_manage_department_member: {
        Args: { p_department_id: string; p_target_user_id: string }
        Returns: boolean
      }
      create_department_with_owner: {
        Args: {
          p_badge_number?: string
          p_name: string
          p_rank_title?: string
          p_short_name?: string
          p_slug: string
          p_unit_name?: string
        }
        Returns: string
      }
      get_department_members: {
        Args: { p_department_id: string }
        Returns: {
          activation_status: string
          badge_number: string
          effective_permissions: string[]
          email: string
          employee_number: string
          full_name: string
          is_active: boolean
          joined_at: string
          rank_title: string
          role_codes: string[]
          unit_name: string
          user_id: string
        }[]
      }
      has_any_department_permission: {
        Args: { p_department_id: string; p_permission_codes: string[] }
        Returns: boolean
      }
      has_department_permission: {
        Args: { p_department_id: string; p_permission_code: string }
        Returns: boolean
      }
      has_department_role: {
        Args: { p_department_id: string; p_role_codes: string[] }
        Returns: boolean
      }
      is_active_department_member: {
        Args: { p_department_id: string; p_user_id: string }
        Returns: boolean
      }
      is_department_member: {
        Args: { p_department_id: string }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      platform_create_agency: {
        Args: {
          p_account_status?: string
          p_agency_type?: string
          p_civilian_staff?: number
          p_county?: string
          p_internal_notes?: string
          p_name: string
          p_plan_type?: string
          p_short_name: string
          p_slug: string
          p_state?: string
          p_sworn_officers?: number
          p_timezone?: string
        }
        Returns: string
      }
      record_off_duty_firearm_inspection: {
        Args: {
          p_department_id: string
          p_inspected_by_user_id: string
          p_inspection_date: string
          p_notes?: string
          p_request_id: string
          p_result: string
        }
        Returns: {
          created_at: string
          department_id: string
          id: string
          inspected_by_user_id: string
          inspection_date: string
          notes: string | null
          request_id: string
          result: string
        }
        SetofOptions: {
          from: "*"
          to: "off_duty_firearm_inspections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resubmit_off_duty_firearm_request: {
        Args: {
          p_actor_name: string
          p_actor_role: string
          p_caliber: string
          p_capacity?: string
          p_department_id: string
          p_firearm_type: string
          p_holster?: string
          p_inspection_reviewed?: boolean
          p_make: string
          p_model: string
          p_officer_notes?: string
          p_officer_user_id: string
          p_optic?: string
          p_policy_acknowledged?: boolean
          p_proof_ownership?: boolean
          p_qualification_reviewed?: boolean
          p_request_id: string
          p_serial_number: string
          p_weapon_light?: string
        }
        Returns: undefined
      }
      set_department_group_members: {
        Args: {
          p_department_id: string
          p_group_ids: string[]
          p_user_id: string
        }
        Returns: undefined
      }
      set_department_member_roles: {
        Args: {
          p_department_id: string
          p_role_codes: string[]
          p_user_id: string
        }
        Returns: undefined
      }
      set_department_role_permissions: {
        Args: {
          p_department_id: string
          p_permission_codes: string[]
          p_role_code: string
        }
        Returns: undefined
      }
      submit_off_duty_firearm_request: {
        Args: {
          p_actor_name: string
          p_actor_role: string
          p_caliber: string
          p_capacity?: string
          p_department_id: string
          p_firearm_type: string
          p_holster?: string
          p_inspection_reviewed?: boolean
          p_make: string
          p_model: string
          p_officer_notes?: string
          p_officer_user_id: string
          p_optic?: string
          p_policy_acknowledged?: boolean
          p_proof_ownership?: boolean
          p_qualification_reviewed?: boolean
          p_serial_number: string
          p_weapon_light?: string
        }
        Returns: string
      }
      update_department_member: {
        Args: {
          p_badge_number: string
          p_department_id: string
          p_employee_number: string
          p_is_active: boolean
          p_rank_title: string
          p_unit_name: string
          p_user_id: string
        }
        Returns: undefined
      }
      update_firearm_with_audit: {
        Args: {
          p_asset_number: string
          p_caliber: string
          p_change_note: string
          p_department_id: string
          p_firearm_id: string
          p_firearm_type: string
          p_make: string
          p_model: string
          p_notes: string
          p_serial_number: string
          p_user_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      alert_severity: "low" | "medium" | "high" | "critical"
      alert_status: "open" | "acknowledged" | "resolved" | "dismissed"
      attendance_status: "scheduled" | "present" | "absent" | "excused"
      authorization_status:
        | "not_authorized"
        | "authorized"
        | "expiring_soon"
        | "expired"
        | "revoked"
      compliance_status: "authorized" | "at_risk" | "non_compliant"
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
        | "other"
      drill_difficulty:
        | "basic"
        | "intermediate"
        | "advanced"
        | "instructor_discretion"
      drill_library_status: "active" | "inactive" | "archived"
      firearm_status:
        | "in_service"
        | "assigned"
        | "maintenance"
        | "inspection_required"
        | "out_of_service"
        | "retired"
        | "missing"
      firearm_type: "handgun" | "rifle" | "shotgun" | "less_lethal" | "other"
      inbox_status: "open" | "read" | "resolved" | "dismissed"
      inspection_reason:
        | "scheduled"
        | "malfunction"
        | "pre_issue"
        | "post_repair"
        | "annual"
        | "other"
      inspection_status: "current" | "due_soon" | "overdue"
      lighting_condition: "day" | "night" | "low_light" | "not_applicable"
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
        | "other"
      off_duty_action:
        | "submitted"
        | "resubmitted"
        | "approved"
        | "denied"
        | "returned_for_correction"
        | "withdrawn"
        | "revoked"
        | "archived"
      off_duty_request_status:
        | "draft"
        | "pending_command_review"
        | "returned_for_correction"
        | "approved"
        | "denied"
        | "withdrawn"
        | "archived"
      packet_status: "needs_setup" | "in_progress" | "ready"
      priority_level: "normal" | "high" | "critical"
      range_day_status:
        | "planned"
        | "in_progress"
        | "completed"
        | "locked"
        | "archived"
      range_day_type:
        | "qualification"
        | "rifle"
        | "low_light"
        | "remedial"
        | "make_up"
        | "training"
      scoring_format:
        | "qualification"
        | "points"
        | "time"
        | "pass_fail"
        | "completion"
        | "hit_count"
        | "notes_only"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      alert_severity: ["low", "medium", "high", "critical"],
      alert_status: ["open", "acknowledged", "resolved", "dismissed"],
      attendance_status: ["scheduled", "present", "absent", "excused"],
      authorization_status: [
        "not_authorized",
        "authorized",
        "expiring_soon",
        "expired",
        "revoked",
      ],
      compliance_status: ["authorized", "at_risk", "non_compliant"],
      drill_category: [
        "qualification",
        "marksmanship",
        "movement",
        "low_light",
        "decision_making",
        "rifle",
        "shotgun",
        "transition",
        "malfunction_clearance",
        "active_shooter",
        "administrative",
        "remedial",
        "other",
      ],
      drill_difficulty: [
        "basic",
        "intermediate",
        "advanced",
        "instructor_discretion",
      ],
      drill_library_status: ["active", "inactive", "archived"],
      firearm_status: [
        "in_service",
        "assigned",
        "maintenance",
        "inspection_required",
        "out_of_service",
        "retired",
        "missing",
      ],
      firearm_type: ["handgun", "rifle", "shotgun", "less_lethal", "other"],
      inbox_status: ["open", "read", "resolved", "dismissed"],
      inspection_reason: [
        "scheduled",
        "malfunction",
        "pre_issue",
        "post_repair",
        "annual",
        "other",
      ],
      inspection_status: ["current", "due_soon", "overdue"],
      lighting_condition: ["day", "night", "low_light", "not_applicable"],
      malfunction_type: [
        "failure_to_feed",
        "failure_to_eject",
        "failure_to_fire",
        "light_primer_strike",
        "magazine_issue",
        "optic_failure",
        "weapon_light_failure",
        "trigger_issue",
        "catastrophic_failure",
        "other",
      ],
      off_duty_action: [
        "submitted",
        "resubmitted",
        "approved",
        "denied",
        "returned_for_correction",
        "withdrawn",
        "revoked",
        "archived",
      ],
      off_duty_request_status: [
        "draft",
        "pending_command_review",
        "returned_for_correction",
        "approved",
        "denied",
        "withdrawn",
        "archived",
      ],
      packet_status: ["needs_setup", "in_progress", "ready"],
      priority_level: ["normal", "high", "critical"],
      range_day_status: [
        "planned",
        "in_progress",
        "completed",
        "locked",
        "archived",
      ],
      range_day_type: [
        "qualification",
        "rifle",
        "low_light",
        "remedial",
        "make_up",
        "training",
      ],
      scoring_format: [
        "qualification",
        "points",
        "time",
        "pass_fail",
        "completion",
        "hit_count",
        "notes_only",
      ],
    },
  },
} as const



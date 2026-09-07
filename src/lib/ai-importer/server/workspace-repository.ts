/* eslint-disable @typescript-eslint/no-explicit-any -- Workspace tables are introduced by an additive migration and are not in the generated Supabase snapshot yet. */
import "server-only";

import { parseWorkspaceState } from "./workspace-state.ts";
import type { MigrationWorkspaceView } from "../workspace-types.ts";

export async function loadWorkspace(admin: any, workspaceId: string, departmentId: string): Promise<(MigrationWorkspaceView & { completedDomains: string[] }) | null> {
  if (!/^[a-f0-9-]{36}$/i.test(workspaceId)) return null;
  const result = await admin.from("ai_migration_workspaces").select("id,status,state,completed_domains,created_at,updated_at,completed_at,expires_at").eq("id", workspaceId).eq("department_id", departmentId).maybeSingle();
  if (result.error) throw new Error("Migration workspace could not be loaded.");
  if (!result.data) return null;
  return {
    id: result.data.id, status: result.data.status, state: parseWorkspaceState(result.data.state), completedDomains: result.data.completed_domains ?? [],
    createdAt: result.data.created_at, updatedAt: result.data.updated_at, completedAt: result.data.completed_at, expiresAt: result.data.expires_at,
  };
}

import { NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { createOperationsReadRepository } from "@/lib/operations/read-repository";

export const dynamic = "force-dynamic";

function dateValue(value: unknown) {
  if (typeof value !== "string" || !value) return 0;
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00`).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function missingTable(error: any) {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

export async function GET() {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);

  const context = resolved.context;
  if (
    !hasAnyServerPermission(context, [
      "view_command_dashboard",
      "administer_department",
    ])
  ) {
    return permissionDeniedResponse("Command Dashboard permission is required.");
  }

  const [trainingResult, fleetResult] = await createOperationsReadRepository(context.admin, context.departmentId).getCommandDashboard(context.departmentId);

  if (trainingResult.error && !missingTable(trainingResult.error)) {
    return NextResponse.json({ error: trainingResult.error.message }, { status: 500 });
  }
  if (fleetResult.error && !missingTable(fleetResult.error)) {
    return NextResponse.json({ error: fleetResult.error.message }, { status: 500 });
  }

  const now = Date.now();
  const sevenDays = now + 7 * 86_400_000;
  const thirtyDays = now + 30 * 86_400_000;
  const trainingEvents = trainingResult.error || !Array.isArray(trainingResult.data) ? [] : trainingResult.data;
  const vehicles = fleetResult.error || !Array.isArray(fleetResult.data) ? [] : fleetResult.data;

  const upcomingTraining = trainingEvents
    .filter((event: any) => {
      const startsAt = dateValue(event.starts_at);
      return event.status === "scheduled" && startsAt >= now && startsAt <= thirtyDays;
    })
    .slice(0, 5)
    .map((event: any) => ({
      id: event.id,
      title: event.title,
      trainingType: event.training_type,
      startsAt: event.starts_at,
      location: event.location,
      attendeeCount: Array.isArray(event.agency_training_attendees)
        ? event.agency_training_attendees.length
        : 0,
    }));

  const trainingAttention = trainingEvents
    .filter((event: any) => {
      const attendeeCount = Array.isArray(event.agency_training_attendees)
        ? event.agency_training_attendees.length
        : 0;
      const startsAt = dateValue(event.starts_at);
      return (
        event.status === "in_progress" ||
        (event.status === "scheduled" &&
          startsAt >= now &&
          startsAt <= sevenDays &&
          attendeeCount === 0)
      );
    })
    .slice(0, 5)
    .map((event: any) => ({
      id: event.id,
      title: event.title,
      detail:
        event.status === "in_progress"
          ? "Training is currently in progress and requires closeout when complete."
          : "Training begins within seven days and has no roster assignments.",
      href: "/agency-training",
      priority: event.status === "in_progress" ? "blue" : "amber",
    }));

  const fleetAttention = vehicles
    .filter((vehicle: any) => {
      const dueDates = [
        vehicle.next_service_date,
        vehicle.inspection_due_date,
        vehicle.registration_expiration_date,
      ].map(dateValue).filter(Boolean);
      return (
        ["Attention", "Maintenance", "Out of Service"].includes(vehicle.status) ||
        dueDates.some((value) => value <= thirtyDays)
      );
    })
    .slice(0, 8)
    .map((vehicle: any) => {
      const overdue = [
        vehicle.next_service_date,
        vehicle.inspection_due_date,
        vehicle.registration_expiration_date,
      ].map(dateValue).filter(Boolean).some((value) => value < now);
      return {
        id: vehicle.id,
        title: `Unit ${vehicle.unit_number}: ${vehicle.status}`,
        detail: overdue
          ? "A service, inspection, or registration date is overdue."
          : Number(vehicle.open_issue_count ?? 0) > 0
            ? `${Number(vehicle.open_issue_count)} open issue${Number(vehicle.open_issue_count) === 1 ? "" : "s"}.`
            : "A service, inspection, or registration date is approaching.",
        href: `/fleet-management/${vehicle.id}`,
        priority:
          vehicle.status === "Out of Service" || overdue
            ? "red"
            : vehicle.status === "Maintenance"
              ? "amber"
              : "blue",
      };
    });

  return NextResponse.json(
    {
      agencyTraining: {
        available: !trainingResult.error,
        total: trainingEvents.length,
        draft: trainingEvents.filter((event: any) => event.status === "draft").length,
        scheduled: trainingEvents.filter((event: any) => event.status === "scheduled").length,
        inProgress: trainingEvents.filter((event: any) => event.status === "in_progress").length,
        completed: trainingEvents.filter((event: any) => event.status === "completed").length,
        rosterAssignments: trainingEvents.reduce(
          (total: number, event: any) =>
            total +
            (Array.isArray(event.agency_training_attendees)
              ? event.agency_training_attendees.length
              : 0),
          0,
        ),
        upcoming: upcomingTraining,
        attention: trainingAttention,
      },
      fleet: {
        available: !fleetResult.error,
        total: vehicles.length,
        availableVehicles: vehicles.filter((vehicle: any) => vehicle.status === "Available").length,
        attention: vehicles.filter((vehicle: any) => vehicle.status === "Attention").length,
        maintenance: vehicles.filter((vehicle: any) => vehicle.status === "Maintenance").length,
        outOfService: vehicles.filter((vehicle: any) => vehicle.status === "Out of Service").length,
        openIssues: vehicles.reduce(
          (total: number, vehicle: any) => total + Number(vehicle.open_issue_count ?? 0),
          0,
        ),
        attentionItems: fleetAttention,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

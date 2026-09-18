import type { AnalyticsDashboardConfiguration } from "./analytics-dashboard-config.ts";

export type CommandOperationsSourceResult = {
  data: unknown;
  error: unknown;
};

type TrainingEvent = {
  id: string;
  title: string;
  training_type: string;
  starts_at: string;
  location: string | null;
  status: string;
  agency_training_attendees?: unknown[] | null;
};

type FleetVehicle = {
  id: string;
  unit_number: string;
  status: string;
  open_issue_count?: number | string | null;
  next_service_date?: string | null;
  inspection_due_date?: string | null;
  registration_expiration_date?: string | null;
};

type FleetUpcomingEvent = {
  id: string;
  vehicleId: string;
  unitNumber: string;
  label: string;
  dueDate: string;
};

function dateValue(value: unknown) {
  if (typeof value !== "string" || !value) return 0;
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00`).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function buildCommandOperationsPresentation(
  trainingResult: CommandOperationsSourceResult,
  fleetResult: CommandOperationsSourceResult,
  configuration: AnalyticsDashboardConfiguration,
  now = Date.now(),
) {
  const trainingAttentionLimit = now + configuration.command_training_attention_window_days * 86_400_000;
  const trainingUpcomingLimit = now + configuration.command_training_upcoming_window_days * 86_400_000;
  const fleetAttentionLimit = now + configuration.command_fleet_attention_window_days * 86_400_000;
  const trainingEvents: TrainingEvent[] = trainingResult.error || !Array.isArray(trainingResult.data)
    ? []
    : trainingResult.data as TrainingEvent[];
  const vehicles: FleetVehicle[] = fleetResult.error || !Array.isArray(fleetResult.data)
    ? []
    : fleetResult.data as FleetVehicle[];

  const upcomingTraining = trainingEvents
    .filter((event) => {
      const startsAt = dateValue(event.starts_at);
      return event.status === "scheduled" && startsAt >= now && startsAt <= trainingUpcomingLimit;
    })
    .slice(0, configuration.command_training_upcoming_item_limit)
    .map((event) => ({
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
    .filter((event) => {
      const attendeeCount = Array.isArray(event.agency_training_attendees)
        ? event.agency_training_attendees.length
        : 0;
      const startsAt = dateValue(event.starts_at);
      return (
        event.status === "in_progress" ||
        (event.status === "scheduled" &&
          startsAt >= now &&
          startsAt <= trainingAttentionLimit &&
          attendeeCount === 0)
      );
    })
    .slice(0, configuration.command_training_attention_item_limit)
    .map((event) => ({
      id: event.id,
      title: event.title,
      detail:
        event.status === "in_progress"
          ? "Training is currently in progress and requires closeout when complete."
          : `Training begins within ${configuration.command_training_attention_window_days} days and has no roster assignments.`,
      href: "/agency-training",
      priority: event.status === "in_progress" ? "blue" : "amber",
    }));

  const fleetAttention = vehicles
    .filter((vehicle) => {
      const dueDates = [
        vehicle.next_service_date,
        vehicle.inspection_due_date,
        vehicle.registration_expiration_date,
      ].map(dateValue).filter(Boolean);
      return (
        ["Attention", "Maintenance", "Out of Service"].includes(vehicle.status) ||
        dueDates.some((value) => value <= fleetAttentionLimit)
      );
    })
    .slice(0, configuration.command_fleet_attention_item_limit)
    .map((vehicle) => {
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

  const current = new Date(now);
  const today = new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate(),
  ).getTime();
  const fleetUpcoming = vehicles
    .flatMap((vehicle) =>
      [
        {
          key: "service",
          label: "Service due",
          dueDate: vehicle.next_service_date,
        },
        {
          key: "inspection",
          label: "Inspection due",
          dueDate: vehicle.inspection_due_date,
        },
        {
          key: "registration",
          label: "Registration expires",
          dueDate: vehicle.registration_expiration_date,
        },
      ].map((event) => ({
        id: `${vehicle.id}-${event.key}`,
        vehicleId: vehicle.id,
        unitNumber: vehicle.unit_number,
        label: event.label,
        dueDate: event.dueDate,
      })),
    )
    .filter((event): event is FleetUpcomingEvent => {
      const dueAt = dateValue(event.dueDate);
      return (
        typeof event.dueDate === "string" &&
        dueAt >= today &&
        dueAt <= fleetAttentionLimit
      );
    })
    .sort((left, right) => dateValue(left.dueDate) - dateValue(right.dueDate));

  return {
    agencyTraining: {
      available: !trainingResult.error,
      total: trainingEvents.length,
      draft: trainingEvents.filter((event) => event.status === "draft").length,
      scheduled: trainingEvents.filter((event) => event.status === "scheduled").length,
      inProgress: trainingEvents.filter((event) => event.status === "in_progress").length,
      completed: trainingEvents.filter((event) => event.status === "completed").length,
      rosterAssignments: trainingEvents.reduce(
        (total, event) => total +
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
      availableVehicles: vehicles.filter((vehicle) => vehicle.status === "Available").length,
      attention: vehicles.filter((vehicle) => vehicle.status === "Attention").length,
      maintenance: vehicles.filter((vehicle) => vehicle.status === "Maintenance").length,
      outOfService: vehicles.filter((vehicle) => vehicle.status === "Out of Service").length,
      openIssues: vehicles.reduce(
        (total, vehicle) => total + Number(vehicle.open_issue_count ?? 0),
        0,
      ),
      upcoming: fleetUpcoming,
      attentionItems: fleetAttention,
    },
  };
}

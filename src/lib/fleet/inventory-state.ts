export const FLEET_STATUSES = [
  "Available",
  "Attention",
  "Maintenance",
  "Out of Service",
  "Retired",
] as const;

export const ASSIGNMENT_TYPES = ["Pool", "Permanent", "Specialized"] as const;

export const INVENTORY_SORT_COLUMNS = [
  "unit",
  "vehicle",
  "assignment",
  "mileage",
  "inspection",
  "service",
  "issues",
  "status",
] as const;

export const SCHEDULE_STATES = [
  "current",
  "due-soon",
  "overdue",
  "not-scheduled",
] as const;

export const ISSUE_FILTERS = ["open", "none"] as const;

export type FleetStatus = (typeof FLEET_STATUSES)[number];
export type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];
export type InventorySortColumn = (typeof INVENTORY_SORT_COLUMNS)[number];
export type SortDirection = "asc" | "desc";
export type ScheduleState = (typeof SCHEDULE_STATES)[number];
export type IssueFilter = "" | (typeof ISSUE_FILTERS)[number];

export type FleetInventoryVehicle = {
  id: string;
  unit_number: string;
  vin: string | null;
  license_plate: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vehicle_type: string | null;
  assignment_type: AssignmentType;
  assigned_to: string | null;
  home_location: string | null;
  current_mileage: number | null;
  current_hours: number | null;
  status: FleetStatus;
  inspection_due_date: string | null;
  next_service_date: string | null;
  next_service_mileage: number | null;
  open_issue_count: number | null;
};

export type InventoryQueryState = {
  search: string;
  status: "All" | FleetStatus;
  vehicle: string;
  assignment: "" | AssignmentType;
  location: string;
  inspection: "" | ScheduleState;
  service: "" | ScheduleState;
  issues: IssueFilter;
  sort: InventorySortColumn | null;
  direction: SortDirection;
};

export const DEFAULT_INVENTORY_QUERY: InventoryQueryState = {
  search: "",
  status: "All",
  vehicle: "",
  assignment: "",
  location: "",
  inspection: "",
  service: "",
  issues: "",
  sort: null,
  direction: "asc",
};

export const SERVICE_DUE_SOON_MILES = 1_000;

const naturalCollator = new Intl.Collator("en-US", {
  numeric: true,
  sensitivity: "base",
});

function oneOf<T extends string>(value: string | null, values: readonly T[]): T | null {
  return values.includes(value as T) ? (value as T) : null;
}

function cleanText(value: string | null, maximum = 200) {
  return (value ?? "").trim().slice(0, maximum);
}

function boundedText(value: string | null, maximum = 200) {
  return (value ?? "").slice(0, maximum);
}

export function parseInventoryQuery(
  input: URLSearchParams | string,
): InventoryQueryState {
  const params = typeof input === "string" ? new URLSearchParams(input) : input;
  const sort = oneOf(params.get("sort"), INVENTORY_SORT_COLUMNS);

  return {
    search: boundedText(params.get("q"), 300),
    status: oneOf(params.get("status"), FLEET_STATUSES) ?? "All",
    vehicle: boundedText(params.get("vehicle")),
    assignment: oneOf(params.get("assignment"), ASSIGNMENT_TYPES) ?? "",
    location: cleanText(params.get("location")),
    inspection: oneOf(params.get("inspection"), SCHEDULE_STATES) ?? "",
    service: oneOf(params.get("service"), SCHEDULE_STATES) ?? "",
    issues: oneOf(params.get("issues"), ISSUE_FILTERS) ?? "",
    sort,
    direction: sort && params.get("dir") === "desc" ? "desc" : "asc",
  };
}

export function serializeInventoryQuery(state: InventoryQueryState) {
  const params = new URLSearchParams();
  if (state.search) params.set("q", state.search);
  if (state.status !== "All") params.set("status", state.status);
  if (state.vehicle) params.set("vehicle", state.vehicle);
  if (state.assignment) params.set("assignment", state.assignment);
  if (state.location) params.set("location", state.location);
  if (state.inspection) params.set("inspection", state.inspection);
  if (state.service) params.set("service", state.service);
  if (state.issues) params.set("issues", state.issues);
  if (state.sort) {
    params.set("sort", state.sort);
    params.set("dir", state.direction);
  }
  return params;
}

export function clearAdvancedFilters(
  state: InventoryQueryState,
): InventoryQueryState {
  return {
    ...state,
    vehicle: "",
    assignment: "",
    location: "",
    inspection: "",
    service: "",
    issues: "",
  };
}

function dateDay(value: string | null) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) return null;
  return timestamp / 86_400_000;
}

function todayDay(now: Date) {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000;
}

export function inspectionState(
  value: string | null,
  now = new Date(),
): ScheduleState {
  const due = dateDay(value);
  if (due === null) return "not-scheduled";
  const days = due - todayDay(now);
  if (days < 0) return "overdue";
  if (days <= 30) return "due-soon";
  return "current";
}

function finiteNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function serviceState(
  vehicle: Pick<
    FleetInventoryVehicle,
    "next_service_date" | "next_service_mileage" | "current_mileage"
  >,
  now = new Date(),
): ScheduleState {
  const dateStatus = inspectionState(vehicle.next_service_date, now);
  const threshold = finiteNumber(vehicle.next_service_mileage);
  const mileage = finiteNumber(vehicle.current_mileage);
  const mileageRemaining = threshold === null || mileage === null
    ? null
    : threshold - mileage;

  if (dateStatus === "overdue" || (mileageRemaining !== null && mileageRemaining <= 0)) {
    return "overdue";
  }
  if (
    dateStatus === "due-soon" ||
    (mileageRemaining !== null && mileageRemaining <= SERVICE_DUE_SOON_MILES)
  ) return "due-soon";
  if (dateStatus === "current" || threshold !== null) return "current";
  return "not-scheduled";
}

function issueCount(vehicle: FleetInventoryVehicle) {
  const count = finiteNumber(vehicle.open_issue_count);
  return count === null ? 0 : Math.max(0, count);
}

function includes(value: Array<string | number | null>, query: string) {
  return value
    .filter((item) => item !== null)
    .join(" ")
    .toLocaleLowerCase("en-US")
    .includes(query.toLocaleLowerCase("en-US"));
}

export function filterFleetVehicles<T extends FleetInventoryVehicle>(
  vehicles: readonly T[],
  state: InventoryQueryState,
  now = new Date(),
) {
  const search = state.search.trim();
  const vehicleQuery = state.vehicle.trim();
  const location = state.location.toLocaleLowerCase("en-US");

  return vehicles.filter((vehicle) => {
    if (state.status !== "All" && vehicle.status !== state.status) return false;
    if (state.assignment && vehicle.assignment_type !== state.assignment) return false;
    if (
      location &&
      (vehicle.home_location ?? "").toLocaleLowerCase("en-US") !== location
    ) return false;
    if (
      state.inspection &&
      inspectionState(vehicle.inspection_due_date, now) !== state.inspection
    ) return false;
    if (state.service && serviceState(vehicle, now) !== state.service) return false;
    if (state.issues === "open" && issueCount(vehicle) === 0) return false;
    if (state.issues === "none" && issueCount(vehicle) > 0) return false;
    if (
      vehicleQuery &&
      !includes(
        [vehicle.year, vehicle.make, vehicle.model, vehicle.vehicle_type],
        vehicleQuery,
      )
    ) return false;
    if (!search) return true;
    return includes(
      [
        vehicle.unit_number,
        vehicle.vin,
        vehicle.license_plate,
        vehicle.year,
        vehicle.make,
        vehicle.model,
        vehicle.vehicle_type,
        vehicle.assignment_type,
        vehicle.assigned_to,
        vehicle.home_location,
        vehicle.status,
      ],
      search,
    );
  });
}

function compareText(left: string | null | undefined, right: string | null | undefined) {
  const a = left?.trim() || null;
  const b = right?.trim() || null;
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return naturalCollator.compare(a, b);
}

function compareNumber(left: number | null | undefined, right: number | null | undefined) {
  const a = finiteNumber(left);
  const b = finiteNumber(right);
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function compareDate(left: string | null, right: string | null) {
  return compareNumber(dateDay(left), dateDay(right));
}

const scheduleSortRank: Record<ScheduleState, number> = {
  overdue: 0,
  "due-soon": 1,
  current: 2,
  "not-scheduled": 3,
};

function compareService(
  left: FleetInventoryVehicle,
  right: FleetInventoryVehicle,
  now: Date,
) {
  const stateComparison = scheduleSortRank[serviceState(left, now)] -
    scheduleSortRank[serviceState(right, now)];
  if (stateComparison) return stateComparison;

  const dateComparison = compareDate(left.next_service_date, right.next_service_date);
  const leftHasDate = dateDay(left.next_service_date) !== null;
  const rightHasDate = dateDay(right.next_service_date) !== null;
  if (leftHasDate || rightHasDate) return dateComparison;

  const leftRemaining = finiteNumber(left.next_service_mileage) === null
    ? null
    : (left.next_service_mileage as number) - (finiteNumber(left.current_mileage) ?? 0);
  const rightRemaining = finiteNumber(right.next_service_mileage) === null
    ? null
    : (right.next_service_mileage as number) - (finiteNumber(right.current_mileage) ?? 0);
  return compareNumber(leftRemaining, rightRemaining);
}

function compareForColumn(
  left: FleetInventoryVehicle,
  right: FleetInventoryVehicle,
  column: InventorySortColumn,
  now: Date,
) {
  switch (column) {
    case "unit":
      return compareText(left.unit_number, right.unit_number);
    case "vehicle": {
      const year = compareNumber(left.year, right.year);
      return year || compareText(
        [left.make, left.model].filter(Boolean).join(" ") || null,
        [right.make, right.model].filter(Boolean).join(" ") || null,
      );
    }
    case "assignment":
      return compareText(
        left.assigned_to || left.assignment_type,
        right.assigned_to || right.assignment_type,
      ) || compareText(left.home_location, right.home_location);
    case "mileage":
      return compareNumber(left.current_mileage, right.current_mileage);
    case "inspection":
      return compareDate(left.inspection_due_date, right.inspection_due_date);
    case "service":
      return compareService(left, right, now);
    case "issues":
      return issueCount(left) - issueCount(right);
    case "status":
      return compareText(left.status, right.status);
  }
}

function isMissingSortValue(
  vehicle: FleetInventoryVehicle,
  column: InventorySortColumn,
) {
  switch (column) {
    case "vehicle":
      return finiteNumber(vehicle.year) === null;
    case "mileage":
      return finiteNumber(vehicle.current_mileage) === null;
    case "inspection":
      return dateDay(vehicle.inspection_due_date) === null;
    case "service":
      return dateDay(vehicle.next_service_date) === null &&
        finiteNumber(vehicle.next_service_mileage) === null;
    default:
      return false;
  }
}

export function sortFleetVehicles<T extends FleetInventoryVehicle>(
  vehicles: readonly T[],
  column: InventorySortColumn | null,
  direction: SortDirection,
  now = new Date(),
) {
  if (!column) return [...vehicles];
  return vehicles
    .map((vehicle, index) => ({ vehicle, index }))
    .sort((left, right) => {
      const leftMissing = isMissingSortValue(left.vehicle, column);
      const rightMissing = isMissingSortValue(right.vehicle, column);
      if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
      const compared = compareForColumn(left.vehicle, right.vehicle, column, now);
      return (direction === "asc" ? compared : -compared) || left.index - right.index;
    })
    .map(({ vehicle }) => vehicle);
}

export function applyInventoryView<T extends FleetInventoryVehicle>(
  vehicles: readonly T[],
  state: InventoryQueryState,
  now = new Date(),
) {
  return sortFleetVehicles(
    filterFleetVehicles(vehicles, state, now),
    state.sort,
    state.direction,
    now,
  );
}

export function activeAdvancedFilterCount(state: InventoryQueryState) {
  return [
    state.vehicle,
    state.assignment,
    state.location,
    state.inspection,
    state.service,
    state.issues,
  ].filter(Boolean).length;
}

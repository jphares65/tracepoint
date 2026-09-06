import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION,
} from "./analytics-dashboard-config.ts";
import { buildCommandOperationsPresentation } from "./command-operations.ts";

const now = new Date("2026-09-06T12:00:00Z").getTime();

function training(id: string, days: number, attendeeCount = 0) {
  return {
    id,
    title: id,
    training_type: "Annual",
    starts_at: new Date(now + days * 86_400_000).toISOString(),
    location: null,
    status: "scheduled",
    agency_training_attendees: Array.from({ length: attendeeCount }, (_, index) => ({ id: index })),
  };
}

function vehicle(id: string, days: number) {
  return {
    id,
    unit_number: id,
    status: "Available",
    open_issue_count: 0,
    next_service_date: new Date(now + days * 86_400_000).toISOString(),
  };
}

test("preserves the current command operations windows and list limits by default", () => {
  const result = buildCommandOperationsPresentation(
    { data: Array.from({ length: 10 }, (_, index) => training(`training-${index}`, index + 1)), error: null },
    { data: Array.from({ length: 10 }, (_, index) => vehicle(`vehicle-${index}`, index + 1)), error: null },
    DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION,
    now,
  );

  assert.equal(result.agencyTraining.upcoming.length, 5);
  assert.equal(result.agencyTraining.attention.length, 5);
  assert.equal(result.fleet.attentionItems.length, 8);
  assert.match(result.agencyTraining.attention[0].detail, /within 7 days/);
});

test("applies agency command operations windows and limits independently", () => {
  const configuration = {
    ...DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION,
    command_training_attention_window_days: 2,
    command_training_upcoming_window_days: 3,
    command_fleet_attention_window_days: 4,
    command_training_upcoming_item_limit: 2,
    command_training_attention_item_limit: 1,
    command_fleet_attention_item_limit: 3,
  };
  const rows = Array.from({ length: 6 }, (_, index) => training(`training-${index}`, index + 1));
  const vehicles = Array.from({ length: 6 }, (_, index) => vehicle(`vehicle-${index}`, index + 1));
  const result = buildCommandOperationsPresentation(
    { data: rows, error: null },
    { data: vehicles, error: null },
    configuration,
    now,
  );

  assert.deepEqual(result.agencyTraining.upcoming.map((item) => item.id), ["training-0", "training-1"]);
  assert.deepEqual(result.agencyTraining.attention.map((item) => item.id), ["training-0"]);
  assert.deepEqual(result.fleet.attentionItems.map((item) => item.id), ["vehicle-0", "vehicle-1", "vehicle-2"]);
  assert.match(result.agencyTraining.attention[0].detail, /within 2 days/);
});

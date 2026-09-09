import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUpcomingOperationalEvents,
  type UpcomingOperationalEvent,
  type UpcomingOperationalEventSource,
} from "./upcoming-operational-events.ts";

const now = new Date("2026-09-06T12:00:00Z").getTime();

function event(
  id: string,
  source: UpcomingOperationalEvent["source"],
  days: number,
): UpcomingOperationalEvent {
  return {
    id,
    title: id,
    date: new Date(now + days * 86_400_000).toISOString(),
    source,
    type: "Scheduled",
    detail: `${source} detail`,
    href: "/",
  };
}

function source(
  enabled: boolean,
  available: boolean,
  events: UpcomingOperationalEvent[],
): UpcomingOperationalEventSource {
  return { enabled, available, events };
}

test("combines supported operational events in chronological order", () => {
  const result = buildUpcomingOperationalEvents(
    [
      source(true, true, [event("range", "Range & Training", 3)]),
      source(true, true, [event("training", "Agency Training", 1)]),
      source(true, true, [event("fleet", "Fleet", 2)]),
      source(true, true, [event("certification", "Certifications", 4)]),
    ],
    4,
    now,
  );

  assert.deepEqual(
    result.map((item) => item.id),
    ["training", "fleet", "range", "certification"],
  );
});

test("omits disabled, unavailable, past, and over-limit events", () => {
  const result = buildUpcomingOperationalEvents(
    [
      source(false, true, [event("disabled", "Range & Training", 1)]),
      source(true, false, [event("unavailable", "Fleet", 1)]),
      source(true, true, [event("past", "Certifications", -2)]),
      source(true, true, [
        event("first", "Agency Training", 1),
        event("second", "Agency Training", 2),
      ]),
    ],
    1,
    now,
  );

  assert.deepEqual(result.map((item) => item.id), ["first"]);
});

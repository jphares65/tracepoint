import "@/lib/testing/dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import CompletionChoiceControl from "./CompletionChoiceControl.tsx";

afterEach(cleanup);

function pressed(name: string) {
  return screen.getByRole("button", { name }).getAttribute("aria-pressed");
}

test("UX-RB-1: an untouched Completion row shows Not recorded with neither choice selected", () => {
  render(<CompletionChoiceControl scoringFormat="Completion" officerName="Ofc. A" onChange={() => {}} />);
  assert.equal(pressed("Complete"), "false");
  assert.equal(pressed("Incomplete"), "false");
  assert.ok(screen.getByText("Not recorded"));
});

test("UX-RB-1: each choice is explicit; one tap on Complete records complete", () => {
  const changes: boolean[] = [];
  render(<CompletionChoiceControl scoringFormat="Completion" officerName="Ofc. A" onChange={(value) => changes.push(value)} />);
  fireEvent.click(screen.getByRole("button", { name: "Complete" }));
  fireEvent.click(screen.getByRole("button", { name: "Incomplete" }));
  assert.deepEqual(changes, [true, false]);
});

test("UX-RB-1: the highlighted choice is the stored value", () => {
  const { rerender } = render(<CompletionChoiceControl scoringFormat="Completion" completed officerName="Ofc. A" onChange={() => {}} />);
  assert.equal(pressed("Complete"), "true");
  rerender(<CompletionChoiceControl scoringFormat="Completion" completed={false} officerName="Ofc. A" onChange={() => {}} />);
  assert.equal(pressed("Incomplete"), "true");
  assert.equal(screen.queryByText("Not recorded"), null);
});

test("UX-RB-1: scored formats show the complete default they save", () => {
  render(<CompletionChoiceControl scoringFormat="Points" officerName="Ofc. A" onChange={() => {}} />);
  assert.equal(pressed("Complete"), "true");
  assert.equal(screen.queryByText("Not recorded"), null);
});

test("the control is labelled for the officer", () => {
  render(<CompletionChoiceControl scoringFormat="Completion" officerName="Ofc. Rivera" onChange={() => {}} />);
  assert.ok(screen.getByRole("group", { name: "Completion for Ofc. Rivera" }));
});

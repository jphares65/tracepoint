import "@/lib/testing/dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import InspectionChoiceControl from "./InspectionChoiceControl.tsx";

afterEach(cleanup);

const options = [
  { value: "Pass", tone: "pass" as const },
  { value: "Fail", tone: "fail" as const },
  { value: "N/A", tone: "neutral" as const },
];

test("UX-RB-2: an unanswered item shows Not inspected and no option selected", () => {
  render(<InspectionChoiceControl itemLabel="Safe for duty use" value={null} options={options} onChange={() => {}} />);
  assert.ok(screen.getByRole("group", { name: "Safe for duty use" }));
  for (const name of ["Pass", "Fail", "N/A"]) assert.equal(screen.getByRole("button", { name }).getAttribute("aria-pressed"), "false");
  assert.ok(screen.getByText("Not inspected"));
});

test("UX-RB-2: choosing an option reports it and highlights only the stored value", () => {
  const chosen: string[] = [];
  const { rerender } = render(<InspectionChoiceControl itemLabel="Item" value={null} options={options} onChange={(value) => chosen.push(value)} />);
  fireEvent.click(screen.getByRole("button", { name: "Fail" }));
  assert.deepEqual(chosen, ["Fail"]);
  rerender(<InspectionChoiceControl itemLabel="Item" value="Fail" options={options} onChange={() => {}} />);
  assert.equal(screen.getByRole("button", { name: "Fail" }).getAttribute("aria-pressed"), "true");
  assert.equal(screen.queryByText("Not inspected"), null);
});

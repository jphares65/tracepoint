import "@/lib/testing/dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, render } from "@testing-library/react";

import { useDirtyGuard } from "./use-dirty-guard.ts";

afterEach(cleanup);

function Form({ dirty }: { dirty: boolean }) {
  useDirtyGuard(dirty);
  return null;
}

function unload() {
  const event = new window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

test("E-06: the leave-page warning is registered only while there are unsaved changes", () => {
  const view = render(<Form dirty={false} />);
  assert.equal(unload(), false);
  view.rerender(<Form dirty />);
  assert.equal(unload(), true);
  view.rerender(<Form dirty={false} />);
  assert.equal(unload(), false);
  view.rerender(<Form dirty />);
  view.unmount();
  assert.equal(unload(), false, "unmounting removes the listener");
});

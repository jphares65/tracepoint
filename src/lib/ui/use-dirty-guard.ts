"use client";

import { useEffect } from "react";

// E-06: while a form has unsaved changes, closing or reloading the page asks
// the browser's leave-page question. In-page navigation (tabs, Refresh) asks
// through the page's own confirmation.
export function useDirtyGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers need a return value to show the prompt.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

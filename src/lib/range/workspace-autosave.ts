export type WorkspaceAutosaveState = "idle" | "saving" | "saved" | "error";

/** Serializes saves and always sends the newest pending workspace snapshot next. */
export class LatestWorkspaceSaveQueue<T> {
  private pending: { value: T; version: number } | null = null;
  private failed: { value: T; version: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving = false;
  private version = 0;

  schedule(
    snapshot: T,
    delay: number,
    save: (value: T) => Promise<void>,
    onState: (state: WorkspaceAutosaveState, error?: string) => void,
  ) {
    this.pending = { value: snapshot, version: ++this.version };
    this.failed = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush(save, onState);
    }, delay);
  }

  /** Flushes the already-scheduled latest snapshot through the same queue. */
  flushNow(
    save: (value: T) => Promise<void>,
    onState: (state: WorkspaceAutosaveState, error?: string) => void,
  ) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    return this.flush(save, onState);
  }

  async flush(
    save: (value: T) => Promise<void>,
    onState: (state: WorkspaceAutosaveState, error?: string) => void,
  ) {
    if (this.saving || !this.pending) return;
    const snapshot = this.pending;
    this.pending = null;
    this.saving = true;
    onState("saving");

    try {
      await save(snapshot.value);
      if (snapshot.version === this.version) {
        this.failed = null;
        onState("saved");
      }
    } catch (error) {
      if (snapshot.version === this.version) {
        this.failed = snapshot;
        onState(
          "error",
          error instanceof Error ? error.message : "The range workspace could not be saved.",
        );
      }
    } finally {
      this.saving = false;
      if (this.pending) void this.flush(save, onState);
    }
  }

  retry(
    save: (value: T) => Promise<void>,
    onState: (state: WorkspaceAutosaveState, error?: string) => void,
  ) {
    if (!this.failed) return;
    this.pending = this.failed;
    this.failed = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.flush(save, onState);
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

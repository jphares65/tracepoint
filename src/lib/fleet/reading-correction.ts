// UX-RB2-7 (D-08): lowering a vehicle's mileage or engine hours is a correction
// the server accepts only with a reason (B4). The reason is a field in the
// vehicle dialog, shown as soon as a reading is lowered.
const lowered = (input: string, stored: number | null | undefined) =>
  input.trim() !== "" && Number(input) < Number(stored ?? 0);

export function readingCorrectionNeeded(
  form: { currentMileage: string; currentHours: string },
  original: { current_mileage?: number | null; current_hours?: number | null } | null | undefined,
) {
  return Boolean(original) && (lowered(form.currentMileage, original!.current_mileage) || lowered(form.currentHours, original!.current_hours));
}

export const READING_CORRECTION_REQUIRED =
  "Lowering the mileage or engine hours is a correction. Enter why the recorded reading is wrong.";

"use client";

export type TracePointAccentColor =
  | "blue"
  | "indigo"
  | "emerald"
  | "slate";

export type TracePointBrightness =
  | "dark"
  | "balanced"
  | "high-contrast";

export type TracePointAppearancePreferences = {
  accentColor: TracePointAccentColor;
  brightness: TracePointBrightness;
};

export const TRACEPOINT_APPEARANCE_STORAGE_KEY =
  "tracepoint.appearance.v1";

export const TRACEPOINT_APPEARANCE_EVENT =
  "tracepoint:appearance-updated";

export const DEFAULT_APPEARANCE: TracePointAppearancePreferences = {
  accentColor: "blue",
  brightness: "dark",
};

export function normalizeAccentColor(
  value: unknown,
): TracePointAccentColor {
  if (
    value === "blue" ||
    value === "indigo" ||
    value === "emerald" ||
    value === "slate"
  ) {
    return value;
  }

  return DEFAULT_APPEARANCE.accentColor;
}

export function normalizeBrightness(
  value: unknown,
): TracePointBrightness {
  if (
    value === "dark" ||
    value === "balanced" ||
    value === "high-contrast"
  ) {
    return value;
  }

  // Older builds used "light" or "system" for this same control.
  // Keep those values safe without letting them produce a broken select.
  if (value === "light" || value === "system") {
    return "balanced";
  }

  return DEFAULT_APPEARANCE.brightness;
}

export function buildAppearancePreferences(
  accentColor: unknown,
  brightness: unknown,
): TracePointAppearancePreferences {
  return {
    accentColor: normalizeAccentColor(accentColor),
    brightness: normalizeBrightness(brightness),
  };
}

export function getStoredAppearancePreferences() {
  if (typeof window === "undefined") {
    return DEFAULT_APPEARANCE;
  }

  try {
    const raw = window.localStorage.getItem(
      TRACEPOINT_APPEARANCE_STORAGE_KEY,
    );

    if (!raw) {
      return DEFAULT_APPEARANCE;
    }

    const parsed = JSON.parse(raw) as Partial<{
      accentColor: unknown;
      brightness: unknown;
    }>;

    return buildAppearancePreferences(
      parsed.accentColor,
      parsed.brightness,
    );
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function saveAppearancePreferences(
  preferences: TracePointAppearancePreferences,
) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(
    TRACEPOINT_APPEARANCE_STORAGE_KEY,
    JSON.stringify(preferences),
  );
}

export function applyAppearanceToDocument(
  preferences: TracePointAppearancePreferences,
) {
  if (typeof document === "undefined") return;

  document.documentElement.dataset.tracepointAccent =
    preferences.accentColor;
  document.documentElement.dataset.tracepointBrightness =
    preferences.brightness;
}

export function broadcastAppearancePreferences(
  preferences: TracePointAppearancePreferences,
) {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent(TRACEPOINT_APPEARANCE_EVENT, {
      detail: preferences,
    }),
  );
}

export function persistAndApplyAppearance(
  preferences: TracePointAppearancePreferences,
) {
  saveAppearancePreferences(preferences);
  applyAppearanceToDocument(preferences);
  broadcastAppearancePreferences(preferences);
}

export type SearchablePickerOption = {
  id: string;
  label: string;
  detail?: string;
  keywords?: string;
};

export function filterSearchablePickerOptions(
  options: SearchablePickerOption[],
  query: string,
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return options;
  return options.filter((option) =>
    `${option.label} ${option.detail ?? ""} ${option.keywords ?? ""}`
      .toLowerCase()
      .includes(normalized),
  );
}

export function nextSearchablePickerIndex(
  current: number,
  length: number,
  direction: 1 | -1,
) {
  if (!length) return 0;
  return Math.min(Math.max(current + direction, 0), length - 1);
}

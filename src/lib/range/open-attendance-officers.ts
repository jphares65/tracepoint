export type OpenAttendanceOfficer = {
  id: string;
  displayName: string;
  fullName?: string | null;
  badgeNumber?: string | null;
  rankTitle?: string | null;
  unitName?: string | null;
};

/** Provides a stable, disambiguating label for the walk-up officer picker. */
export function getOpenAttendanceOfficerLabel(
  officer: OpenAttendanceOfficer,
) {
  const name = officer.fullName?.trim() || officer.displayName;
  const badge = officer.badgeNumber?.trim();
  const unit = officer.unitName?.trim();

  return [name, badge ? `#${badge}` : null, unit]
    .filter(Boolean)
    .join(" — ");
}

/** Filters the walk-up picker without exposing officers already on this session. */
export function filterOpenAttendanceOfficers<T extends OpenAttendanceOfficer>(
  officers: T[],
  search: string,
) {
  const query = search.trim().toLowerCase();
  if (!query) return officers;

  return officers.filter((officer) =>
    [
      officer.displayName,
      officer.fullName,
      officer.badgeNumber,
      officer.rankTitle,
      officer.unitName,
    ]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(query)),
  );
}

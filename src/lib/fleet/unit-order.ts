const unitIdentifierCollator = new Intl.Collator("en-US", {
  numeric: true,
  sensitivity: "base",
});

export function compareUnitIdentifiers(left: unknown, right: unknown) {
  const leftIdentifier = String(left ?? "");
  const rightIdentifier = String(right ?? "");
  const naturalComparison = unitIdentifierCollator.compare(
    leftIdentifier,
    rightIdentifier,
  );

  if (naturalComparison !== 0) return naturalComparison;
  if (leftIdentifier < rightIdentifier) return -1;
  if (leftIdentifier > rightIdentifier) return 1;
  return 0;
}

export function sortFleetVehiclesByUnit<T>(vehicles: readonly T[]) {
  return [...vehicles].sort((left, right) =>
    compareUnitIdentifiers(
      (left as { unit_number?: unknown }).unit_number,
      (right as { unit_number?: unknown }).unit_number,
    ),
  );
}

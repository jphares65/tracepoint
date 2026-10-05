export type RecipientOption = {
  id: string;
  label: string;
  detail?: string;
};

export function filterRecipientOptions(
  options: RecipientOption[],
  query: string,
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return options;
  return options.filter((option) =>
    `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(normalized),
  );
}

export function checkoutRecipientPayload(
  recipientType: "officer" | "unit" | "vehicle",
  recipient: string,
) {
  return {
    recipientUserId: recipientType === "officer" ? recipient : "",
    recipientUnit: recipientType === "unit" ? recipient : "",
    recipientVehicleId: recipientType === "vehicle" ? recipient : "",
  };
}

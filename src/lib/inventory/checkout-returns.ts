export function validateReturnQuantity(value: string, outstanding: number) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { error: "Enter a quantity greater than zero." } as const;
  }
  if (quantity > outstanding) {
    return { error: `Only ${outstanding} is outstanding.` } as const;
  }
  return { quantity } as const;
}

export function returnPayload(quantity: number, note: string) {
  return { quantity, reason: note || null, reference: null };
}

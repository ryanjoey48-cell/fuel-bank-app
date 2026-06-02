export function normalizeFuelLogLocation(value: unknown) {
  const location = String(value ?? "").trim();
  const lowerLocation = location.toLocaleLowerCase();

  if (lowerLocation.startsWith("bangchak")) {
    return "Bangchak";
  }

  if (lowerLocation.startsWith("shell")) {
    return "Shell";
  }

  return location;
}

export function shouldShowFuelLogLocationOption(value: unknown) {
  return normalizeFuelLogLocation(value).toLocaleLowerCase() !== "chonburi??";
}

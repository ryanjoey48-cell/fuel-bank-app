/** Shared Expenses Centre readiness labels for bootstrap and UI. Never activates writes. */
export type ExpensesReadiness =
  | 'ready'
  | 'activation_required'
  | 'schema_upgrade_required'
  | 'private_storage_required'
  | 'schema_unavailable';

export function resolveExpensesReadiness(input: {
  schemaPresent: boolean;
  schemaVersion: number | null | undefined;
  enabled: boolean | null | undefined;
  privateBucket: boolean;
  environmentReady: boolean;
}): ExpensesReadiness {
  if (!input.schemaPresent) return 'schema_unavailable';
  if (input.schemaVersion !== 3) return 'schema_upgrade_required';
  if (!input.privateBucket) return 'private_storage_required';
  if (!input.enabled || !input.environmentReady) return 'activation_required';
  return 'ready';
}

export function expensesRegisterQuerySupported(readiness: ExpensesReadiness | undefined): boolean {
  return readiness === 'ready' || readiness === 'activation_required' || readiness === 'private_storage_required';
}

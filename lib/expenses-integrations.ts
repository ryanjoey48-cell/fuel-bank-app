import { countsAsSpend, type Expense } from './expenses';
/** Read-only handoff contract. No consumer is activated and no ledger is mutated. */
export type ExpenseCostHandoff = { origin:'expenses-centre'; expenseId:string; source:string; sourceId:string; deduplicationKey:string; amountSatang:number; expenseDate:string; vehicleId:string|null; treatment:string; eligibleForStandaloneReport:boolean };
export function prepareExpenseCostHandoff(expense:Expense):ExpenseCostHandoff {
  const d=expense.data;
  return {origin:'expenses-centre',expenseId:expense.id,source:d.source,sourceId:d.source_id,deduplicationKey:d.source==='standalone'?`expenses-centre:${expense.id}`:`${d.source}:${d.source_id}`,amountSatang:d.amount_satang,expenseDate:d.date,vehicleId:d.allocation==='vehicle'?d.vehicle_id:null,treatment:d.cost_treatment,eligibleForStandaloneReport:countsAsSpend(expense)};
}

// Fictional, in-memory demonstration only. No Supabase or invoice issuance.
export type DemoActor = "office" | "management" | "finance" | "approver";
export type DemoAction = "receive_order" | "receive_parking" | "receive_toll" | "verify" | "resolve" | "record_expense" | "price_list" | "manual_price" | "create_batch" | "draft_trn" | "approve" | "prepare_pack";
export type DemoStatus = "awaiting_paperwork" | "discrepancy" | "needs_recheck" | "ready";
export type DemoEvent = { action: DemoAction; actor: DemoActor; step: number };
export type DemoJob = {
  id: string; workOrder: string; customer: string; date: string; pickup: string; dropoff: string; driver: string; vehicle: string;
  mismatch: boolean; documents: { order: boolean; parking: boolean; toll: boolean };
  status: DemoStatus; expense: number | null; price: number | null; priceSource: "list" | "manual" | null;
  batch: string | null; draft: boolean; approved: boolean; pack: boolean; events: DemoEvent[];
};

export const demoJobs: DemoJob[] = [
  { id: "match", workOrder: "SIM-WO-1001", customer: "Sample Customer A", date: "2026-10-05", pickup: "Example Depot", dropoff: "Example Warehouse", driver: "Demo Driver A", vehicle: "DEMO-01", mismatch: false, documents: { order: false, parking: false, toll: false }, status: "awaiting_paperwork", expense: null, price: null, priceSource: null, batch: null, draft: false, approved: false, pack: false, events: [] },
  { id: "missing", workOrder: "SIM-WO-1002", customer: "Sample Customer A", date: "2026-10-06", pickup: "Example Depot", dropoff: "Example Port", driver: "Demo Driver B", vehicle: "DEMO-02", mismatch: false, documents: { order: false, parking: false, toll: false }, status: "awaiting_paperwork", expense: null, price: null, priceSource: null, batch: null, draft: false, approved: false, pack: false, events: [] },
  { id: "mismatch", workOrder: "SIM-WO-1003", customer: "Sample Customer A", date: "2026-10-07", pickup: "Example Warehouse", dropoff: "Example Depot", driver: "Demo Driver C", vehicle: "DEMO-03", mismatch: true, documents: { order: false, parking: false, toll: false }, status: "awaiting_paperwork", expense: null, price: null, priceSource: null, batch: null, draft: false, approved: false, pack: false, events: [] }
];

const allowed: Record<DemoAction, DemoActor> = {
  receive_order: "office", receive_parking: "office", receive_toll: "office", verify: "office", resolve: "management",
  record_expense: "finance", price_list: "finance", manual_price: "finance", create_batch: "finance", draft_trn: "finance", approve: "approver", prepare_pack: "finance"
};

export function applyDemoAction(job: DemoJob, action: DemoAction, actor: DemoActor, manualAmount?: number): DemoJob {
  if (allowed[action] !== actor) throw new Error("DEMO_ROLE_REQUIRED");
  const next: DemoJob = { ...job, documents: { ...job.documents }, events: [...job.events] };
  switch (action) {
    case "receive_order": next.documents.order = true; break;
    case "receive_parking": next.documents.parking = true; break;
    case "receive_toll": next.documents.toll = true; break;
    case "verify":
      if (!next.documents.order || !next.documents.parking || !next.documents.toll) throw new Error("DEMO_PAPERWORK_REQUIRED");
      if (next.status === "discrepancy") throw new Error("DEMO_MANAGEMENT_REQUIRED");
      next.status = next.mismatch ? "discrepancy" : "ready";
      break;
    case "resolve":
      if (next.status !== "discrepancy") throw new Error("DEMO_NO_OPEN_DISCREPANCY");
      next.mismatch = false; next.status = "needs_recheck";
      break;
    case "record_expense":
      if (next.status !== "ready" || next.expense !== null) throw new Error("DEMO_VERIFICATION_REQUIRED");
      next.expense = 185; // Fictional parking + toll example, THB.
      break;
    case "price_list":
    case "manual_price":
      if (next.status !== "ready" || next.expense === null || next.price !== null) throw new Error("DEMO_PRICE_GATE");
      if (action === "manual_price" && (!Number.isFinite(manualAmount) || manualAmount! <= 0)) throw new Error("DEMO_AMOUNT_REQUIRED");
      next.price = action === "price_list" ? 2400 : manualAmount!; next.priceSource = action === "price_list" ? "list" : "manual";
      break;
    case "create_batch":
      if (next.price === null || next.batch) throw new Error("DEMO_BATCH_GATE");
      next.batch = "SIM-WEEK-2026-41";
      break;
    case "draft_trn":
      if (!next.batch || next.draft) throw new Error("DEMO_DRAFT_GATE");
      next.draft = true;
      break;
    case "approve":
      if (!next.draft || next.approved) throw new Error("DEMO_APPROVAL_GATE");
      next.approved = true;
      break;
    case "prepare_pack":
      if (!next.approved || next.pack) throw new Error("DEMO_PACK_GATE");
      next.pack = true;
      break;
  }
  next.events.push({ action, actor, step: next.events.length + 1 });
  return next;
}

export function demoFinanceReady(job: DemoJob) { return job.status === "ready"; }
export function demoHasFinalTrnNumber(_job: DemoJob) { return false; }

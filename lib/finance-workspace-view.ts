import type { SheetTransport } from "./finance-demo-centre";

/** Presentation only: an amount by itself is never evidence of contract verification. */
export function transportEvidenceState(transport: SheetTransport | null | undefined) {
  if (!transport) return "missing" as const;
  if (transport.source === "manual" || transport.overrideReason) return "manual" as const;
  return transport.provenance ? "verified" as const : "entered" as const;
}

/** Screen geometry only. PDF and print retain the original 816 × 1056 proportions. */
export function invoiceDisplayWidth(width: number, height: number, fit: "auto" | "width" | "page" | "zoom", zoom: number) {
  const available = Math.max(100, width - 40);
  if (fit === "auto") return Math.min(available, 1000);
  if (fit === "zoom") return 816 * Math.min(400, Math.max(10, zoom)) / 100;
  return fit === "page" ? Math.min(available, Math.max(100, height - 40) * 816 / 1056) : available;
}

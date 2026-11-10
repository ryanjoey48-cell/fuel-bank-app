/**
 * Browser side of the EES invoice: loads the Thai font + logo, rasterises the fixed-geometry pages (lib/finance-invoice-render)
 * and writes them to a US Letter PDF with the existing image-page PDF writer.
 *
 * Limitation (reported): pages are embedded as 300 dpi-class images, so text in the downloaded PDF is not selectable.
 */
import { buildImagePagesPdf, downloadBlob, loadCanvasImage } from "@/lib/oil-service-pdf";
import { drawInvoice, INVOICE_PAGE, INVOICE_THAI_FONT_FAMILY, type InvoiceVariant } from "@/lib/finance-invoice-render";
import type { InvoiceDocument } from "@/lib/finance-invoice-model";

let fontPromise: Promise<void> | null = null;
export function loadInvoiceFonts(): Promise<void> {
  if (typeof document === "undefined" || typeof FontFace === "undefined") return Promise.resolve();
  fontPromise ??= (async () => {
    try {
      const response = await fetch("/fonts/boss-pdf-thai.ttf");
      if (!response.ok) return;
      const face = new FontFace(INVOICE_THAI_FONT_FAMILY, await response.arrayBuffer(), { style: "normal", weight: "400 700" });
      await face.load();
      document.fonts.add(face);
      await document.fonts.ready;
    } catch { /* falls back to system Thai fonts */ }
  })();
  return fontPromise;
}

const logoPromises: Partial<Record<InvoiceVariant, Promise<HTMLImageElement | null>>> = {};
/** reference = purple word-mark from the owner example; modern = the current EES logo (public/ees-logo.png, unmodified). */
export function loadInvoiceLogo(variant: InvoiceVariant = "reference"): Promise<HTMLImageElement | null> {
  logoPromises[variant] ??= loadCanvasImage(variant === "modern" ? "/ees-logo.png" : "/ees-invoice-logo.png").catch(() => null);
  return logoPromises[variant]!;
}

/** Renders every page; `scale` 1.5 for on-screen preview, 4 for PDF/print (288 dpi). */
export async function renderInvoiceCanvases(doc: InvoiceDocument, scale: number, variant: InvoiceVariant = "reference"): Promise<HTMLCanvasElement[]> {
  await loadInvoiceFonts();
  const logo = await loadInvoiceLogo(variant);
  return drawInvoice((w, h) => { const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h; return canvas; }, scale, doc, { images: { logo }, variant });
}

export async function downloadInvoicePdf(doc: InvoiceDocument, fileName: string, variant: InvoiceVariant = "reference") {
  const canvases = await renderInvoiceCanvases(doc, 4, variant);
  const pages = canvases.map((canvas) => ({ data: atob(canvas.toDataURL("image/jpeg", 0.95).split(",")[1] ?? ""), width: canvas.width, height: canvas.height }));
  downloadBlob(buildImagePagesPdf(pages, { width: INVOICE_PAGE.width, height: INVOICE_PAGE.height }), fileName);
}

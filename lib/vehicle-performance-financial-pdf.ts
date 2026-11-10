import { buildImagePagesPdf, downloadBlob } from '@/lib/oil-service-pdf';
import {
  SOURCE_FIELDS, baht, satang, operationalFleetFinancials, operationalVehicleFinancials,
  OWNER_REPORTING_NOTE_EN, OWNER_REPORTING_NOTE_TH,
  type FinancialReport, type FinancialVehicle
} from './vehicle-performance-financial';
import { financialCopy } from './vehicle-performance-financial-copy';

/** Uses the same financial utility as the screen; fixed landscape pages with Thai font support. */
export async function downloadFinancialPdf(report: FinancialReport, language: 'en' | 'th', vehicle?: FinancialVehicle) {
  const fontResponse = await fetch('/fonts/boss-pdf-thai.ttf');
  if (!fontResponse.ok) throw new Error('Unable to load the report font.');
  const font = new FontFace('EESFinancial', await fontResponse.arrayBuffer());
  await font.load(); document.fonts.add(font);
  const c = financialCopy[language], fleet = operationalFleetFinancials(report), rows = vehicle ? [vehicle] : report.rows;
  const pages: HTMLCanvasElement[] = [];
  const generated = new Date().toLocaleString(language === 'th' ? 'th-TH' : 'en-GB', { timeZone: 'Asia/Bangkok', hour12: false });
  const period = new Date(report.year, report.month - 1, 1).toLocaleDateString(language === 'th' ? 'th-TH' : 'en-GB', { month: 'long', year: 'numeric' });
  const methodology = language === 'th' ? OWNER_REPORTING_NOTE_TH : OWNER_REPORTING_NOTE_EN;
  for (let page = 0; page < 2; page++) {
    const canvas = document.createElement('canvas'); canvas.width = 1684; canvas.height = 1190;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('PDF canvas unavailable');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const text = (value: string, x: number, y: number, size = 19, color = '#263142', align: CanvasTextAlign = 'left') => {
      ctx.font = `${size}px EESFinancial, Tahoma, sans-serif`; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(value, x, y);
    };
    const wrap = (value: string, y: number, width = 1570) => {
      ctx.font = '18px EESFinancial, Tahoma, sans-serif';
      let line = '', lines = 0;
      const words = Array.from(new Intl.Segmenter(language, { granularity: 'word' }).segment(value), part => part.segment);
      for (const word of words) {
        if (ctx.measureText(line + word).width > width && line) { text(line, 52, y + lines++ * 25, 18); line = word; } else line += word;
      }
      if (line) text(line, 52, y + lines++ * 25, 18);
      return y + lines * 25;
    };
    ctx.fillStyle = '#54228a'; ctx.fillRect(0, 0, 1684, 112); ctx.fillStyle = '#f58220'; ctx.fillRect(0, 112, 1684, 7);
    text('EES | Expert Express Sender Co., Ltd.', 52, 47, 30, '#fff');
    text(`${c.title} | ${period}${vehicle ? ` | ${vehicle.registration}` : ''}`, 52, 86, 23, '#fff');
    if (page === 0) {
      const summary = vehicle ? operationalVehicleFinancials(vehicle) : null;
      const metrics = [
        [c.revenue, baht(summary ? summary.revenue : fleet.revenue)],
        [c.knownCosts, baht(summary ? summary.knownCosts : fleet.knownCosts)],
        [language === 'th' ? 'ยอดคงเหลือที่รายงาน' : 'Recorded balance', baht(summary ? summary.balance : fleet.balance)],
        [c.jobs, String(summary ? summary.jobs ?? '—' : fleet.jobs)]
      ];
      metrics.forEach(([label, value], i) => { text(label, 52 + i * 400, 164, 19, '#6b4b87'); text(value, 52 + i * 400, 203, 31, '#54228a'); });
      let y = wrap(methodology, 246);
      y = wrap(language === 'th'
        ? 'ตัวเลขนี้เป็นยอดดำเนินงานภายใน ไม่ใช่กำไรทางบัญชีที่ตรวจสอบแล้ว · † แก้ไขหลังนำเข้า'
        : 'These are internal recorded operating balances, not audited net profit. † Amended after import.', y + 6);
      if (report.month === 9) y = wrap(c.salaryNote, y + 6);
      else if (summary) y = wrap(`${summary.reportingStatus === 'adjusted' ? (language === 'th' ? 'ปรับแล้ว' : 'Adjusted') : summary.reportingStatus === 'review' ? (language === 'th' ? 'ตรวจทาน' : 'Review') : (language === 'th' ? 'รายงานแล้ว' : 'Reported')} | ${c.margin}: ${summary.margin == null ? 'N/A' : summary.margin.toFixed(2) + '%'}`, y + 6);
      else y = wrap(`${c.margin}: ${fleet.margin == null ? 'N/A' : fleet.margin.toFixed(2) + '%'} | ${fleet.reviewCount} ${language === 'th' ? 'รายการตรวจทาน' : 'review rows'}`, y + 6);
      const headers = [c.registration, c.jobsColumn, c.revenue, c.knownCosts, language === 'th' ? 'ยอดคงเหลือ' : 'Balance', c.margin, c.status];
      const widths = [190, 75, 235, 235, 235, 180, 430];
      const body = rows.map(row => {
        const m = operationalVehicleFinancials(row);
        const status = m.reportingStatus === 'adjusted'
          ? (language === 'th' ? 'ปรับแล้ว' : 'Adjusted')
          : m.reportingStatus === 'review'
            ? (language === 'th' ? 'ตรวจทาน' : 'Review')
            : (language === 'th' ? 'รายงานแล้ว' : 'Reported');
        return [
          row.registration + (Object.values(row.cells).some(cell => cell.adjustmentId) ? ' †' : ''),
          String(m.jobs ?? '—'), baht(m.revenue), baht(m.knownCosts), baht(m.balance),
          m.margin == null ? 'N/A' : m.margin.toFixed(2) + '%', status
        ];
      });
      if (!vehicle) body.push([
        language === 'th' ? 'รวม' : 'TOTAL', String(fleet.jobs), baht(fleet.revenue), baht(fleet.knownCosts),
        baht(fleet.balance), fleet.margin == null ? 'N/A' : fleet.margin.toFixed(2) + '%',
        language === 'th' ? 'รายงานแล้ว' : 'Reported'
      ]);
      drawTable(headers, body, widths, y + 14);
    } else {
      text(c.source + ': ' + report.sourceFile, 52, 158, 20);
      text('SHA-256: ' + report.sourceSha256, 52, 188, 16, '#64748b');
      const headers = [c.registration, ...SOURCE_FIELDS.map(field => field === 'jobs' ? c.jobsColumn : c[field])];
      const widths = [185, 150, 75, 160, 140, 140, 200, 190, 170, 170];
      const body = rows.map(row => [row.registration, ...SOURCE_FIELDS.map(field => {
        const cell = row.cells[field];
        return (cell.status === 'unknown' ? '—' : cell.status === 'not_applicable' ? 'N/A' : field === 'jobs' ? cell.value! : baht(satang(cell.value!))) + (cell.adjustmentId ? ' †' : '');
      })]);
      if (!vehicle) body.push(['TOTAL', ...SOURCE_FIELDS.map(field => field === 'jobs' ? String(fleet.jobs) : baht(fleet.totals[field]))]);
      drawTable(headers, body, widths, 218);
      let y = 218 + 32 * (body.length + 1) + 30;
      y = wrap(methodology, y);
      if (vehicle?.identityReview) y = wrap(c.identity, y + 4);
      y = wrap(language === 'th' ? '† แก้ไขหลังนำเข้า ยอดรวมเป็นค่าที่บันทึกปัจจุบัน ต้นฉบับไม่ถูกแก้ไข' : '† Amended after import. Totals use current saved values; source figures remain unchanged.', y + 4);
      wrap(c.definition, y + 4);
    }
    text(`${c.generate}: ${generated} (Asia/Bangkok)`, 52, 1150, 16, '#64748b');
    text(`${page + 1} / 2`, 1632, 1150, 16, '#64748b', 'right');
    pages.push(canvas);

    function drawTable(headers: string[], body: string[][], widths: number[], top: number) {
      const tableRows = [headers, ...body];
      tableRows.forEach((cells, r) => {
        const y = top + r * 32;
        ctx!.fillStyle = r === 0 ? '#54228a' : r % 2 ? '#f5f2fa' : '#fff'; ctx!.fillRect(52, y, 1580, 32);
        let x = 52;
        cells.forEach((value, col) => {
          const numeric = col > 0 && (page === 1 || col < 5);
          const available = widths[col] - 16;
          let size = 18; ctx!.font = `${size}px EESFinancial`;
          while (ctx!.measureText(value).width > available && size > 13) ctx!.font = `${--size}px EESFinancial`;
          text(value, numeric ? x + widths[col] - 8 : x + 8, y + 23, size, r === 0 ? '#fff' : '#263142', numeric ? 'right' : 'left');
          x += widths[col];
        });
      });
    }
  }
  const last = pages[0].getContext('2d')!;
  last.font = '17px EESFinancial'; last.fillStyle = '#64748b'; last.textAlign = 'left'; last.fillText(c.overhead, 52, 1100, 1580);
  const pdf = buildImagePagesPdf(pages.map(canvas => ({ data: atob(canvas.toDataURL('image/jpeg', .96).split(',')[1]), width: canvas.width, height: canvas.height })), { width: 841.89, height: 595.28 });
  downloadBlob(pdf, `EES-Vehicle-Performance-2026-${report.month}${vehicle ? '-' + vehicle.registration : ''}.pdf`);
}

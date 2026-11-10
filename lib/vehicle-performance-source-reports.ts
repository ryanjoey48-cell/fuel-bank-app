/** Server-only source adapter: reuses existing immutable previews, restoring original dash cells. */
import august from '@/data/vehicle-performance-v4/previews/2026-08.json';
import september from '@/data/vehicle-performance-v4/previews/2026-09.json';
import { SOURCE_FIELDS, fleetFinancials, type FinancialCell, type FinancialReport, type SourceField } from './vehicle-performance-financial';

export function loadVehicleSourceReports(): FinancialReport[] {
  return [august, september].map((source, index) => {
    const month = index + 8;
    const report: FinancialReport = {
      month, year: 2026,
      sourceFile: `EES_${month === 8 ? 'August' : 'September'}_2026_Registration_First.pdf`,
      sourceSha256: month === 8 ? 'ccf9097118a34ac9633ffbc910b415d49c53b004100d7fdca2a3bc03b6811f24' : 'a83c4d0aacf30777b934c9006189d8ae5b187e3a33ab13b01836ebd35821abc3',
      verifiedAgainstPdf: true, controls: source.sourceFooterTotals,
      rows: source.rows.map(row => ({
        registration: row.registration, month, salaryProvisional: month === 9,
        identityReview: row.registration === '3ฒล-4565',
        cells: Object.fromEntries(SOURCE_FIELDS.map(field => {
          const sourceDash = (row.sourceDashes as string[]).includes(field);
          const nonLpg = field === 'lpg' && row.registration !== 'ฒอ-8453';
          const value = sourceDash ? null : row[field];
          const cell: FinancialCell = nonLpg ? { value: '0', status: 'not_applicable', sourceDash }
            : { value, status: value == null ? 'unknown' : Number(value) === 0 ? 'recorded_zero' : 'recorded', sourceDash };
          return [field, cell];
        })) as Record<SourceField, FinancialCell>
      }))
    };
    if (new Set(report.rows.map(r => r.registration)).size !== 21 || report.rows.length !== 21 || !fleetFinancials(report).reconciled) {
      throw new Error(`Source reconciliation failed for 2026-${month}`);
    }
    return report;
  });
}

"""Read every PDF page and compare every registration/cell to the existing source preview.

Run with the bundled Python (pdfplumber). No financial data or database is changed.
"""
import hashlib
import json
from decimal import Decimal
from pathlib import Path
import pdfplumber

root = Path(__file__).resolve().parents[1]
results = []
fields = ['salary', 'jobs', 'tripPayments', 'expenses', 'parkingFees', 'totalReceived', 'fuel', 'lpg', 'maintenance']
for month, name in [(8, 'August'), (9, 'September')]:
    preview = json.loads((root / f'data/vehicle-performance-v4/previews/2026-{month:02}.json').read_text(encoding='utf8'))
    source = root / f'data/vehicle-performance-v4/source-reports/EES_{name}_2026_Registration_First.pdf'
    with pdfplumber.open(source) as pdf:
        pages = [page.extract_text(layout=True) or '' for page in pdf.pages]
    lines = [line.split() for text in pages for line in text.splitlines()]
    rows = {row['registration']: row for row in preview['rows']}
    records = [line for line in lines if line and line[0] in rows]
    assert len(records) == len(rows) == 21
    assert len({line[0] for line in records}) == 21
    sums = dict.fromkeys(fields, Decimal('0'))
    dash_counts = dict.fromkeys(fields, 0)
    for record in records:
        assert len(record) == 10, record
        row = rows[record[0]]
        for field, value in zip(fields, record[1:]):
            if value == '—':
                assert field in row['sourceDashes'], (record[0], field)
                dash_counts[field] += 1
            else:
                assert field not in row['sourceDashes'], (record[0], field)
                exact = Decimal(value.replace(',', ''))
                assert exact == Decimal(row[field]), (record[0], field, value, row[field])
                sums[field] += exact
    footer = [line for line in lines if line and line[0] == 'TOTAL']
    assert len(footer) == 1 and len(footer[0]) == 10
    for field, value in zip(fields, footer[0][1:]):
        assert Decimal(value.replace(',', '')) == Decimal(preview['sourceFooterTotals'][field]) == sums[field], field
    results.append({
        'month': f'2026-{month:02}', 'sourceFile': source.name,
        'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'pagesRead': len(pages),
        'uniqueRegistrations': 21, 'sourceCellsChecked': 189, 'dashCounts': dash_counts,
        'allCellsMatch': True, 'allNineControlsMatch': True,
        'differences': {field: '0.00' for field in fields},
        'salaryStatus': 'provisional_pending_payroll' if month == 9 else 'reported_salary_sheet_allocations',
    })
output = root / 'output/vehicle-performance-v5/source-verification.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps(results, ensure_ascii=False, indent=2))

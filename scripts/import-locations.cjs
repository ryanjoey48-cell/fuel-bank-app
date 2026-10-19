#!/usr/bin/env node
/* Review-first Excel importer. Default mode is a report only; --apply inserts
   valid non-duplicates and never updates or deletes existing rows. */
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");

const args = process.argv.slice(2);
const reportArgIndex = args.indexOf("--report");
const reportArg = reportArgIndex >= 0 ? args[reportArgIndex + 1] : null;
const inputArg = args.find((arg, index) => !arg.startsWith("--") && (reportArgIndex < 0 || index !== reportArgIndex + 1));
const apply = args.includes("--apply");
const includeReviewedDuplicates = args.includes("--include-reviewed-duplicates");
if (!inputArg) {
  console.error("Usage: node scripts/import-locations.cjs <workbook.xlsx> [--report <report.json>] [--apply]\nDefault mode writes a review report only.");
  process.exit(2);
}
const input = path.resolve(inputArg);
if (!fs.existsSync(input)) { console.error(`Workbook not found: ${input}`); process.exit(2); }
const norm = (value) => String(value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
const first = (row, ...keys) => {
  for (const key of keys) {
    const match = Object.keys(row).find((name) => norm(name).replace(/[^\p{L}\p{N}]/gu, "") === norm(key).replace(/[^\p{L}\p{N}]/gu, ""));
    if (match && String(row[match] ?? "").trim()) return String(row[match]).trim();
  }
  return "";
};
const isMapUrl = (value) => {
  if (!value) return true;
  try { const url = new URL(value); return url.protocol === "https:" && (url.hostname === "maps.google.com" || /^(www\.)?google\.(com|[a-z]{2,3}|co\.[a-z]{2})$/.test(url.hostname)) && url.pathname.startsWith("/maps"); }
  catch { return false; }
};
const workbook = XLSX.readFile(input, { cellDates: true });
const candidates = [];
const canonicalSheet = workbook.SheetNames.find((name) => norm(name) === "destinations");
const sourceSheets = canonicalSheet ? [canonicalSheet] : workbook.SheetNames;
for (const sheetName of sourceSheets) {
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  rows.forEach((row, index) => {
    const company_name = first(row, "company / destination", "company/destination", "company name", "company", "customer", "destination", "name", "client name");
    const address = first(row, "full address / best available", "full address", "current address", "address", "location address", "destination address");
    if (!company_name && !address) return;
    const rawMaps = first(row, "open google maps", "google maps url", "google maps", "maps link", "map url", "google map link");
    const rawAlt = first(row, "alternative company names", "alternative names", "also known as", "aliases", "other names", "alternate name");
    const verificationStatus = first(row, "verification status", "status");
    const verificationNotes = first(row, "verification notes", "reason / next step", "reason", "verification note");
    const evidence = first(row, "source / evidence", "source", "evidence", "source url");
    const historicalDate = first(row, "historical date", "date");
    candidates.push({
      company_name,
      thai_name: first(row, "thai name", "company name thai", "ชื่อบริษัท", "ชื่อภาษาไทย") || null,
      alternative_names: rawAlt.split(/[\n,;|]/).map((name) => name.trim()).filter(Boolean),
      address,
      province: first(row, "province", "จังหวัด") || null,
      destination_type: first(row, "location type", "destination type", "type", "category") || "Other",
      google_maps_url: rawMaps || null,
      map_link_kind: !rawMaps ? "missing" : /\/maps\/search\b|[?&]query=/.test(rawMaps) ? "search_link" : "stored_maps_link",
      truck_entrance_url: first(row, "truck entrance url", "truck entrance", "loading entrance") || null,
      verification_status: "needs_check",
      verified_at: null,
      notes: [verificationStatus && `Workbook status: ${verificationStatus}`, verificationNotes && `Verification note: ${verificationNotes}`,
        first(row, "notes", "remarks", "note")].filter(Boolean).join("\n") || null,
      source_info: [`Historical workbook: ${path.basename(input)}; sheet ${sheetName}; row ${index + 2}`,
        evidence && `Source/evidence: ${evidence}`, historicalDate && `Historical date: ${historicalDate}`].filter(Boolean).join("; "),
      source: { sheet: sheetName, row: index + 2 },
      issues: [],
      duplicate_warnings: []
    });
  });
}
const seenPairs = new Map();
const seenNames = new Map();
const seenAddresses = new Map();
for (const row of candidates) {
  if (!row.company_name) row.issues.push("Missing company/destination name");
  if (!row.address) row.issues.push("Missing address");
  if (!isMapUrl(row.google_maps_url)) row.issues.push("Invalid Google Maps URL");
  if (!isMapUrl(row.truck_entrance_url)) row.issues.push("Invalid truck entrance URL");
  const canonicalType = ["Factory", "Warehouse", "Airport", "Port", "Customer", "Depot", "Other"].find((type) => type.toLowerCase() === row.destination_type.toLowerCase());
  row.destination_type = canonicalType || "Other";
  const nameKey = norm(row.company_name);
  const addressKey = norm(row.address);
  const pairKey = `${nameKey}|${addressKey}`;
  if (nameKey && addressKey && seenPairs.has(pairKey)) row.issues.push(`Duplicate company and address in workbook: ${seenPairs.get(pairKey)}`);
  else if (nameKey && addressKey) seenPairs.set(pairKey, `${row.source.sheet} row ${row.source.row}`);
  if (nameKey && seenNames.has(nameKey)) row.duplicate_warnings.push(`Same company name appears in workbook: ${seenNames.get(nameKey)}; verify these are separate destinations`);
  else if (nameKey) seenNames.set(nameKey, `${row.source.sheet} row ${row.source.row}`);
  if (addressKey && seenAddresses.has(addressKey)) row.duplicate_warnings.push(`Same address appears in workbook: ${seenAddresses.get(addressKey)}; verify before importing`);
  else if (addressKey) seenAddresses.set(addressKey, `${row.source.sheet} row ${row.source.row}`);
}

function buildSummary() {
  const statusCounts = {};
  for (const row of candidates) {
    const status = row.notes?.match(/(?:^|\n)Workbook status: ([^\n]+)/)?.[1] || "No workbook status";
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }
  const hasIssues = (row) => row.issues.length > 0;
  const hasDuplicateWarning = (row) => row.duplicate_warnings.length > 0;
  const nameReview = (row) => norm(row.company_name) === "w/h" || /company\s*(?:name\s*)?(?:unconfirmed|needs? confirmation|needs? confirm)|exact company|name match needs confirmation|exact warehouse unresolved|branch to confirm/i.test(`${row.company_name} ${row.address} ${row.notes ?? ""}`);
  return {
    total: candidates.length,
    valid: candidates.filter((row) => !hasIssues(row) && !hasDuplicateWarning(row)).length,
    structurally_complete: candidates.filter((row) => !hasIssues(row)).length,
    importable_without_duplicate_override: candidates.filter((row) => !hasIssues(row) || (includeReviewedDuplicates && row.issues.every((issue) => /^(Duplicate company and address|Exact company and address)/.test(issue)))).length,
    flagged: candidates.filter((row) => hasIssues(row) || hasDuplicateWarning(row)).length,
    duplicate_pairs: candidates.filter((row) => row.issues.some((issue) => /Duplicate company and address/.test(issue))).length,
    possible_duplicate_records: candidates.filter(hasDuplicateWarning).length,
    missing_company_name: candidates.filter((row) => !row.company_name).length,
    missing_address: candidates.filter((row) => !row.address).length,
    invalid_google_maps_urls: candidates.filter((row) => row.issues.some((issue) => /Google Maps URL/.test(issue))).length,
    google_maps_search_links: candidates.filter((row) => row.map_link_kind === "search_link").length,
    company_name_manual_checks: candidates.filter(nameReview).length,
    records_needing_manual_verification: candidates.filter((row) => row.verification_status !== "verified" || row.map_link_kind === "search_link").length,
    records_marked_verified: candidates.filter((row) => row.verification_status === "verified").length,
    workbook_status_counts: statusCounts
  };
}

async function main() {
  if (apply) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("--apply requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
    const { createClient } = require("@supabase/supabase-js");
    const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: existing, error } = await db.from("ees_locations").select("id,company_name,address");
    if (error) throw error;
    const existingPairs = new Set((existing ?? []).map((row) => `${norm(row.company_name)}|${norm(row.address)}`));
    const existingNames = new Set((existing ?? []).map((row) => norm(row.company_name)).filter(Boolean));
    const existingAddresses = new Set((existing ?? []).map((row) => norm(row.address)).filter(Boolean));
    for (const row of candidates) {
      const nameKey = norm(row.company_name);
      const addressKey = norm(row.address);
      if (existingPairs.has(`${nameKey}|${addressKey}`)) row.issues.push("Exact company and address already exist; not imported");
      else {
        if (nameKey && existingNames.has(nameKey)) row.duplicate_warnings.push("Company name already exists at another address; verify this is a separate destination");
        if (addressKey && existingAddresses.has(addressKey)) row.duplicate_warnings.push("Address already exists under another company; verify before importing");
        if (nameKey) existingNames.add(nameKey);
        if (addressKey) existingAddresses.add(addressKey);
        existingPairs.add(`${nameKey}|${addressKey}`);
      }
    }
    const eligible = candidates.filter((row) => row.issues.length === 0 || (includeReviewedDuplicates && row.issues.every((issue) => /^(Duplicate company and address|Exact company and address)/.test(issue))));
    for (const row of eligible) {
      const { source: _source, issues: _issues, duplicate_warnings: _duplicateWarnings, map_link_kind: _mapLinkKind, ...record } = row;
      const { error: insertError } = await db.from("ees_locations").insert(record);
      if (insertError) { row.issues.push(`Insert failed: ${insertError.message}`); }
    }
    console.log(`Inserted ${eligible.filter((row) => row.issues.length === 0).length} of ${candidates.length} records. Existing and ambiguous records were left untouched.`);
  }
  const reportPath = reportArg ? path.resolve(reportArg) : path.resolve(`${input}.locations-review.json`);
  const summary = buildSummary();
  fs.writeFileSync(reportPath, JSON.stringify({ workbook: path.basename(input), generatedAt: new Date().toISOString(), apply, includeReviewedDuplicates, summary, records: candidates }, null, 2));
  console.log(`Review report: ${reportPath}`);
  console.log(`Rows found: ${summary.total}; clean: ${summary.valid}; flagged: ${summary.flagged}; manual verification: ${summary.records_needing_manual_verification}.`);
}
main().catch((error) => { console.error(error.message); process.exit(1); });

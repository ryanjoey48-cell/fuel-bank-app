export type InsuranceStatus =
  | "active"
  | "due_90"
  | "due_60"
  | "due_30"
  | "expired"
  | "missing";

export type VerificationStatus = "needs_review" | "verified";
export type InsuranceRequirement = "required" | "not_required" | "unknown";

export type InsuranceAssetRecord = {
  id: string;
  vehicle_registration: string;
  ownership_holder: string | null;
  insurer_th: string | null;
  insurer_en: string | null;
  policy_number: string | null;
  insurance_class: string | null;
  policy_issue_date: string | null;
  insured_value: number | null;
  repair_type: string | null;
  vehicle_make: string | null;
  vehicle_year: number | null;
  chassis_number: string | null;
  compulsory_included: boolean | null;
  compulsory_policy_number: string | null;
  compulsory_policy_issue_date: string | null;
  compulsory_start_date: string | null;
  compulsory_expiry_date: string | null;
  insurance_start_date: string | null;
  insurance_expiry_date: string | null;
  registration_date: string | null;
  registration_expiry_date: string | null;
  laos_expiry_date: string | null;
  insurance_premium: number | null;
  compulsory_insurance_premium: number | null;
  vehicle_tax: number | null;
  additional_premium: number | null;
  total_recorded_cost: number | null;
  record_status: string;
  verification_status: VerificationStatus;
  verified_at: string | null;
  source: string | null;
  source_row: number | null;
  original_insurance_expiry: string | null;
  import_review_notes: string | null;
  notes: string | null;
  insurance_requirement?: InsuranceRequirement | null;
  insurance_requirement_reason?: string | null;
  insurance_status: InsuranceStatus;
  days_to_insurance_expiry: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type InsuranceDocumentRecord = {
  id: string;
  insurance_record_id: string;
  document_type: string;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AssetCategory =
  | "six_wheel_truck"
  | "other_commercial_vehicle"
  | "pickup"
  | "passenger_company_car"
  | "trailer"
  | "insurance_only_asset"
  | "unknown";

export type DataQualitySeverity = "critical" | "warning" | "information";

export type DataQualityFinding = {
  code: string;
  severity: DataQualitySeverity;
  label: string;
  detail: string;
};

export type IntelligenceContext = {
  records: InsuranceAssetRecord[];
  documents: InsuranceDocumentRecord[];
};

export type InsuranceSummary = {
  fleet: {
    total: number;
    verified: number;
    awaitingReview: number;
    operational: number;
    trailers: number;
    passengerCars: number;
    pickups: number;
    insuranceOnly: number;
    unknown: number;
    insuranceNotRequired: number;
  };
  insurance: {
    currentlyInsured: number;
    expired: number;
    expiringWithin30: number;
    expiringWithin60: number;
    missingDates: number;
    compulsoryConfirmed: number;
    compulsoryUnknown: number;
    missingRequiredDocuments: number;
  };
  financial: {
    premiumTotal: number | null;
    compulsoryTotal: number | null;
    vehicleTaxTotal: number | null;
    additionalPremiumTotal: number | null;
    totalSpend: number | null;
    insuredValueTotal: number | null;
    averagePremium: number | null;
    averageInsuredValue: number | null;
    premiumToValuePercent: number | null;
    premiumCount: number;
    insuredValueCount: number;
    pairedValueCount: number;
  };
  quality: {
    critical: number;
    warning: number;
    information: number;
    affectedAssets: number;
  };
};

const CATEGORY_REGISTRATIONS: Record<AssetCategory, string[]> = {
  six_wheel_truck: [
    "61-2835",
    "62-1085",
    "62-4337",
    "64-0359",
    "64-5954",
    "700-6659",
    "701-5145",
    "74-8969"
  ],
  other_commercial_vehicle: [
    "61-6672",
    "63-3543",
    "64-5956",
    "64-8665",
    "68-7154",
    "700-4145",
    "701-1654",
    "78-6996",
    "79-2945",
    "79-5318"
  ],
  pickup: ["3ฒน-9565", "ฒอ8453"],
  passenger_company_car: ["4กข-98", "6กค-782", "ญค-280", "ญม3824"],
  trailer: [
    "63-0096",
    "64-2699",
    "64-8664",
    "65-6919",
    "65-6991",
    "77-5902",
    "77-8513"
  ],
  insurance_only_asset: ["4ฒล-4565", "61-2836"],
  unknown: ["700-6956", "ภอ6656", "สินค้า"]
};

const OPERATIONAL_REGISTRATIONS = [
  "3ฒน-9565",
  "61-2835",
  "61-6672",
  "62-1085",
  "62-4337",
  "63-3543",
  "64-0359",
  "64-5954",
  "64-5956",
  "64-8665",
  "68-7154",
  "700-4145",
  "700-6659",
  "701-1654",
  "701-5145",
  "74-8969",
  "78-6996",
  "79-2945",
  "79-5318",
  "ฒอ8453"
];

const PRESENTATION_SEPARATORS = /[\s\-‐‑‒–—−]+/gu;
const DESCRIPTION_POLICY_PATTERN = /^(หางหัวลาก|trailer|พ่วง|รถพ่วง|หัวลาก)$/iu;
const INSURANCE_ONLY_FINDING_CODES = new Set([
  "missing_insurer",
  "missing_policy",
  "missing_class",
  "missing_repair",
  "missing_expiry",
  "missing_insured_value",
  "missing_premium",
  "invalid_policy_dates",
  "expired_insurance",
  "insurance_due_30",
  "insurance_due_60",
  "compulsory_unknown",
  "compulsory_expired",
  "description_in_policy",
  "duplicate_policy",
  "insured_value_invalid",
  "premium_invalid",
  "premium_value_ratio",
  "premium_outlier",
  "missing_main_document",
  "missing_compulsory_document"
]);

export function normalizeInsuranceRegistration(value: string | null | undefined) {
  return (value ?? "").normalize("NFC").trim().replace(PRESENTATION_SEPARATORS, "");
}

const CATEGORY_LOOKUP = new Map<string, AssetCategory>();
for (const [category, registrations] of Object.entries(CATEGORY_REGISTRATIONS)) {
  for (const registration of registrations) {
    CATEGORY_LOOKUP.set(
      normalizeInsuranceRegistration(registration),
      category as AssetCategory
    );
  }
}

const OPERATIONAL_LOOKUP = new Set(
  OPERATIONAL_REGISTRATIONS.map(normalizeInsuranceRegistration)
);

export function getAssetCategory(record: InsuranceAssetRecord): AssetCategory {
  if (
    /^(trailer|พ่วง|รถพ่วง|หางพ่วง|หางหัวลาก)$/iu.test(record.vehicle_make?.trim() ?? "") ||
    (record.insurance_requirement === "not_required" && /^(trailer|รถพ่วง)$/iu.test(record.insurance_requirement_reason?.trim() ?? ""))
  ) {
    return "trailer";
  }
  return (
    CATEGORY_LOOKUP.get(normalizeInsuranceRegistration(record.vehicle_registration)) ??
    "unknown"
  );
}

export function isOperationalAsset(record: InsuranceAssetRecord) {
  return OPERATIONAL_LOOKUP.has(
    normalizeInsuranceRegistration(record.vehicle_registration)
  );
}

export function insuranceRequirement(record: InsuranceAssetRecord): InsuranceRequirement {
  return record.insurance_requirement === "required" ||
    record.insurance_requirement === "not_required"
    ? record.insurance_requirement
    : "unknown";
}

export function isInsuranceNotRequired(record: InsuranceAssetRecord) {
  return insuranceRequirement(record) === "not_required";
}

export function categoryLabel(category: AssetCategory, language: "en" | "th") {
  const labels: Record<AssetCategory, { en: string; th: string }> = {
    six_wheel_truck: { en: "Six-wheel truck", th: "รถบรรทุก 6 ล้อ" },
    other_commercial_vehicle: {
      en: "Other commercial vehicle",
      th: "รถเพื่อการพาณิชย์อื่น"
    },
    pickup: { en: "Pickup", th: "รถกระบะ" },
    passenger_company_car: {
      en: "Passenger / company car",
      th: "รถยนต์นั่ง / รถบริษัท"
    },
    trailer: { en: "Trailer", th: "รถพ่วง" },
    insurance_only_asset: {
      en: "Insurance-only asset",
      th: "ทรัพย์สินเฉพาะประกัน"
    },
    unknown: { en: "Unknown", th: "ไม่ทราบประเภท" }
  };
  return labels[category][language];
}

export function isSeparateCompulsoryConfirmed(record: InsuranceAssetRecord) {
  return Boolean(
    record.compulsory_policy_number &&
      (record.compulsory_start_date || record.compulsory_expiry_date)
  );
}

export function isCompulsoryConfirmed(record: InsuranceAssetRecord) {
  return record.compulsory_included === true || isSeparateCompulsoryConfirmed(record);
}

function hasDocument(
  documents: InsuranceDocumentRecord[],
  recordId: string,
  type: string
) {
  return documents.some(
    (document) =>
      document.insurance_record_id === recordId && document.document_type === type
  );
}

function dayDifference(date: string | null, now = new Date()) {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.ceil((parsed.getTime() - today.getTime()) / 86400000);
}

function nonBlank(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function buildDataQualityFindings(
  record: InsuranceAssetRecord,
  context: IntelligenceContext
): DataQualityFinding[] {
  const findings: DataQualityFinding[] = [];
  const category = getAssetCategory(record);
  const trailer = category === "trailer";
  const add = (
    code: string,
    severity: DataQualitySeverity,
    label: string,
    detail: string
  ) => findings.push({ code, severity, label, detail });

  const missingText: Array<[
    string,
    string,
    string | null | undefined,
    DataQualitySeverity
  ]> = [
    ["missing_insurer", "Missing insurer", record.insurer_en || record.insurer_th, "warning"],
    ["missing_policy", "Missing policy number", record.policy_number, "warning"],
    ["missing_class", "Missing insurance class", record.insurance_class, "warning"],
    ["missing_repair", "Missing repair type", record.repair_type, "warning"],
    ["missing_make", "Missing make", record.vehicle_make, trailer ? "information" : "warning"],
    ["missing_model", "Model not separately recorded", null, "information"],
    ["missing_chassis", "Missing chassis", record.chassis_number, trailer ? "information" : "warning"]
  ];

  for (const [code, label, value, severity] of missingText) {
    if (!nonBlank(value)) add(code, severity, label, "Not recorded in the legacy Insurance record.");
  }
  if (record.vehicle_year == null) {
    add(
      "missing_year",
      trailer ? "information" : "warning",
      "Missing year",
      "Vehicle year is not recorded."
    );
  }
  if (!record.insurance_expiry_date) {
    add("missing_expiry", "warning", "Missing insurance expiry date", "No current main insurance expiry date is recorded.");
  }
  if (record.insured_value == null) {
    add("missing_insured_value", "warning", "Missing insured value", "No confirmed insured value is recorded.");
  }
  if (record.insurance_premium == null) {
    add("missing_premium", "warning", "Missing premium", "No confirmed main insurance premium is recorded.");
  }

  if (
    record.insurance_start_date &&
    record.insurance_expiry_date &&
    record.insurance_start_date > record.insurance_expiry_date
  ) {
    add("invalid_policy_dates", "critical", "Invalid policy date order", "Policy start is later than policy expiry.");
  }

  const insuranceDays = dayDifference(record.insurance_expiry_date);
  if (insuranceDays != null && insuranceDays < 0) {
    add("expired_insurance", "critical", "Insurance expired", "The recorded main policy expiry is in the past.");
  } else if (insuranceDays != null && insuranceDays <= 30) {
    add("insurance_due_30", "warning", "Insurance expires within 30 days", `${insuranceDays} day(s) remain.`);
  } else if (insuranceDays != null && insuranceDays <= 60) {
    add("insurance_due_60", "information", "Insurance expires within 60 days", `${insuranceDays} day(s) remain.`);
  }

  if (!isCompulsoryConfirmed(record)) {
    add("compulsory_unknown", "warning", "Compulsory status unknown", "Neither included compulsory cover nor a separate evidenced policy is confirmed.");
  }
  const compulsoryDays = dayDifference(record.compulsory_expiry_date);
  if (compulsoryDays != null && compulsoryDays < 0) {
    add("compulsory_expired", "critical", "Compulsory insurance expired", "The recorded compulsory expiry is in the past.");
  }

  const taxDays = dayDifference(record.registration_expiry_date);
  if (taxDays != null && taxDays < 0) {
    add("vehicle_tax_expired", "critical", "Vehicle tax expired", "The recorded vehicle tax/registration expiry is in the past.");
  } else if (taxDays != null && taxDays <= 30) {
    add("vehicle_tax_due_30", "warning", "Vehicle tax expires within 30 days", `${taxDays} day(s) remain.`);
  }

  const normalized = normalizeInsuranceRegistration(record.vehicle_registration);
  if (
    context.records.some(
      (candidate) =>
        candidate.id !== record.id &&
        normalizeInsuranceRegistration(candidate.vehicle_registration) === normalized
    )
  ) {
    add("duplicate_registration", "critical", "Duplicate normalized registration", "Another current record resolves to the same separator-insensitive registration.");
  }
  if (
    record.chassis_number &&
    context.records.some(
      (candidate) =>
        candidate.id !== record.id &&
        candidate.chassis_number?.trim().toLocaleUpperCase() ===
          record.chassis_number?.trim().toLocaleUpperCase()
    )
  ) {
    add("duplicate_chassis", "critical", "Duplicate chassis", "Another current record contains the same chassis number.");
  }

  if (record.policy_number) {
    if (DESCRIPTION_POLICY_PATTERN.test(record.policy_number.trim())) {
      add(
        "description_in_policy",
        "warning",
        "Policy number requires review",
        "Existing value appears to be an asset/trailer description. Preserve it as source evidence; do not treat it as a genuine policy number."
      );
    } else if (
      context.records.some(
        (candidate) =>
          candidate.id !== record.id &&
          candidate.policy_number?.trim().toLocaleUpperCase() ===
            record.policy_number?.trim().toLocaleUpperCase()
      )
    ) {
      add("duplicate_policy", "warning", "Suspicious duplicate policy number", "Another current asset has the same policy number.");
    }
  }

  if (record.insured_value != null && record.insured_value <= 0) {
    add("insured_value_invalid", "critical", "Insured value anomaly", "Insured value is zero or negative.");
  }
  if (record.insurance_premium != null && record.insurance_premium < 0) {
    add("premium_invalid", "critical", "Premium anomaly", "Premium is negative.");
  }
  if (
    record.insured_value != null &&
    record.insured_value > 0 &&
    record.insurance_premium != null &&
    record.insurance_premium / record.insured_value > 0.2
  ) {
    add("premium_value_ratio", "warning", "Premium/value anomaly", "Premium exceeds 20% of the recorded insured value.");
  }

  const categoryPremiums = context.records
    .filter(
      (candidate) =>
        getAssetCategory(candidate) === category &&
        candidate.insurance_premium != null &&
        candidate.insurance_premium > 0
    )
    .map((candidate) => candidate.insurance_premium as number);
  const categoryMedian = median(categoryPremiums);
  if (
    categoryMedian != null &&
    categoryPremiums.length >= 4 &&
    record.insurance_premium != null &&
    record.insurance_premium > categoryMedian * 3
  ) {
    add("premium_outlier", "information", "Premium statistical outlier", "Premium is more than three times the median for its derived category; review before comparison.");
  }

  if (record.policy_number && !hasDocument(context.documents, record.id, "insurance")) {
    add("missing_main_document", "warning", "Main policy document missing", "A policy value is recorded but no main insurance document is attached.");
  }
  if (
    isSeparateCompulsoryConfirmed(record) &&
    !hasDocument(context.documents, record.id, "compulsory")
  ) {
    add("missing_compulsory_document", "warning", "Compulsory document missing", "A separate compulsory policy is recorded but no compulsory document is attached.");
  }

  return isInsuranceNotRequired(record)
    ? findings.filter((finding) => !INSURANCE_ONLY_FINDING_CODES.has(finding.code))
    : findings;
}

export function isAwaitingInsuranceReview(
  record: InsuranceAssetRecord,
  context: IntelligenceContext
) {
  if (record.verification_status === "verified") return false;
  if (!isInsuranceNotRequired(record)) return true;
  return buildDataQualityFindings(record, context).some(
    (finding) => finding.severity === "critical" || finding.severity === "warning"
  );
}

function sumRecorded(records: InsuranceAssetRecord[], field: keyof InsuranceAssetRecord) {
  const values = recordedNumbers(records, field);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function recordedNumbers(records: InsuranceAssetRecord[], field: keyof InsuranceAssetRecord) {
  return records.flatMap((record) => {
    const value = record[field];
    return typeof value === "number" && Number.isFinite(value) ? [value] : [];
  });
}

export function summarizeInsurance(
  context: IntelligenceContext,
  options: { includeUnverifiedFinancial?: boolean } = {}
): InsuranceSummary {
  const { records, documents } = context;
  const verifiedRecords = records.filter((record) => record.verification_status === "verified");
  const eligibleFinancialRecords = records.filter((record) => !isInsuranceNotRequired(record));
  const financialRecords = options.includeUnverifiedFinancial
    ? eligibleFinancialRecords
    : eligibleFinancialRecords.filter((record) => record.verification_status === "verified");
  const insuranceRequiredRecords = records.filter((record) => !isInsuranceNotRequired(record));
  const premiums = recordedNumbers(financialRecords, "insurance_premium");
  const insuredValues = recordedNumbers(financialRecords, "insured_value");
  const paired = financialRecords.filter(
    (record) =>
      record.insurance_premium != null &&
      record.insured_value != null &&
      record.insured_value > 0
  );
  const pairedPremium = paired.reduce((sum, record) => sum + (record.insurance_premium ?? 0), 0);
  const pairedValue = paired.reduce((sum, record) => sum + (record.insured_value ?? 0), 0);
  const allFindings = records.flatMap((record) =>
    buildDataQualityFindings(record, context).map((finding) => ({ record, finding }))
  );
  const missingRequiredDocuments = insuranceRequiredRecords.filter((record) => {
    const missingMain = Boolean(record.policy_number) && !hasDocument(documents, record.id, "insurance");
    const missingCompulsory =
      isSeparateCompulsoryConfirmed(record) &&
      !hasDocument(documents, record.id, "compulsory");
    return missingMain || missingCompulsory;
  }).length;

  const financial = {
    premiumTotal: sumRecorded(financialRecords, "insurance_premium"),
    compulsoryTotal: sumRecorded(financialRecords, "compulsory_insurance_premium"),
    vehicleTaxTotal: sumRecorded(financialRecords, "vehicle_tax"),
    additionalPremiumTotal: sumRecorded(financialRecords, "additional_premium"),
    insuredValueTotal: sumRecorded(financialRecords, "insured_value")
  };

  return {
    fleet: {
      total: records.length,
      verified: verifiedRecords.length,
      awaitingReview: records.filter((record) => isAwaitingInsuranceReview(record, context)).length,
      operational: records.filter(isOperationalAsset).length,
      trailers: records.filter((record) => getAssetCategory(record) === "trailer").length,
      passengerCars: records.filter((record) => getAssetCategory(record) === "passenger_company_car").length,
      pickups: records.filter((record) => getAssetCategory(record) === "pickup").length,
      insuranceOnly: records.filter((record) => getAssetCategory(record) === "insurance_only_asset").length,
      unknown: records.filter((record) => getAssetCategory(record) === "unknown").length,
      insuranceNotRequired: records.filter(isInsuranceNotRequired).length
    },
    insurance: {
      currentlyInsured: insuranceRequiredRecords.filter((record) => {
        const days = dayDifference(record.insurance_expiry_date);
        return days != null && days >= 0;
      }).length,
      expired: insuranceRequiredRecords.filter((record) => {
        const days = dayDifference(record.insurance_expiry_date);
        return days != null && days < 0;
      }).length,
      expiringWithin30: insuranceRequiredRecords.filter((record) => {
        const days = dayDifference(record.insurance_expiry_date);
        return days != null && days >= 0 && days <= 30;
      }).length,
      expiringWithin60: insuranceRequiredRecords.filter((record) => {
        const days = dayDifference(record.insurance_expiry_date);
        return days != null && days >= 0 && days <= 60;
      }).length,
      missingDates: insuranceRequiredRecords.filter((record) => !record.insurance_expiry_date).length,
      compulsoryConfirmed: insuranceRequiredRecords.filter(isCompulsoryConfirmed).length,
      compulsoryUnknown: insuranceRequiredRecords.filter((record) => !isCompulsoryConfirmed(record)).length,
      missingRequiredDocuments
    },
    financial: {
      ...financial,
      totalSpend: [
        financial.premiumTotal,
        financial.compulsoryTotal,
        financial.vehicleTaxTotal,
        financial.additionalPremiumTotal
      ].some((value) => value != null)
        ? (financial.premiumTotal ?? 0) +
          (financial.compulsoryTotal ?? 0) +
          (financial.vehicleTaxTotal ?? 0) +
          (financial.additionalPremiumTotal ?? 0)
        : null,
      averagePremium: premiums.length
        ? (financial.premiumTotal ?? 0) / premiums.length
        : null,
      averageInsuredValue: insuredValues.length
        ? (financial.insuredValueTotal ?? 0) / insuredValues.length
        : null,
      premiumToValuePercent:
        pairedValue > 0 ? (pairedPremium / pairedValue) * 100 : null,
      premiumCount: premiums.length,
      insuredValueCount: insuredValues.length,
      pairedValueCount: paired.length
    },
    quality: {
      critical: allFindings.filter(({ finding }) => finding.severity === "critical").length,
      warning: allFindings.filter(({ finding }) => finding.severity === "warning").length,
      information: allFindings.filter(({ finding }) => finding.severity === "information").length,
      affectedAssets: new Set(allFindings.map(({ record }) => record.id)).size
    }
  };
}

export type RenewalBand = "urgent" | "upcoming_60" | "upcoming_90" | "later" | "unknown" | "not_required";

export function renewalBand(record: InsuranceAssetRecord): RenewalBand {
  if (isInsuranceNotRequired(record)) return "not_required";
  const days = dayDifference(record.insurance_expiry_date);
  if (days == null) return "unknown";
  if (days <= 30) return "urgent";
  if (days <= 60) return "upcoming_60";
  if (days <= 90) return "upcoming_90";
  return "later";
}

export function insuranceHistoryStatus(record: InsuranceAssetRecord) {
  if (isInsuranceNotRequired(record)) return "NOT_REQUIRED" as const;
  const startDays = dayDifference(record.insurance_start_date);
  const expiryDays = dayDifference(record.insurance_expiry_date);
  if (startDays != null && startDays > 0) return "FUTURE" as const;
  if (expiryDays == null) return "UNKNOWN" as const;
  if (expiryDays < 0) return "EXPIRED" as const;
  return "CURRENT" as const;
}

export function annualInsuranceCost(record: InsuranceAssetRecord) {
  const values = [
    record.insurance_premium,
    record.compulsory_insurance_premium,
    record.additional_premium
  ];
  const recorded = values.filter((value): value is number => value != null);
  return recorded.length ? recorded.reduce((sum, value) => sum + value, 0) : null;
}

export function premiumToInsuredValue(record: InsuranceAssetRecord) {
  if (
    record.insurance_premium == null ||
    record.insured_value == null ||
    record.insured_value <= 0
  ) {
    return null;
  }
  return (record.insurance_premium / record.insured_value) * 100;
}

export function matchesInsuranceSearch(record: InsuranceAssetRecord, query: string) {
  const raw = query.normalize("NFC").trim().toLocaleLowerCase();
  if (!raw) return true;
  const normalizedQuery = normalizeInsuranceRegistration(raw).toLocaleLowerCase();
  const normalizedRegistration = normalizeInsuranceRegistration(
    record.vehicle_registration
  ).toLocaleLowerCase();
  if (normalizedQuery && normalizedRegistration.includes(normalizedQuery)) return true;
  return [
    record.vehicle_registration,
    record.chassis_number,
    record.vehicle_make,
    record.insurer_en,
    record.insurer_th,
    record.policy_number
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.normalize("NFC").toLocaleLowerCase().includes(raw));
}

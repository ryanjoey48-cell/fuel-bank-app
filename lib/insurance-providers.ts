export type InsuranceProvider = {
  id: string;
  canonicalName: string;
  thaiName: string;
  aliases: string[];
};

const PUNCTUATION = /[.,()\[\]{}'"/\\_-]+/gu;
const WHITESPACE = /\s+/gu;

export function normalizeInsurerAlias(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en")
    .replace(/&/gu, " and ")
    .replace(PUNCTUATION, " ")
    .replace(WHITESPACE, " ")
    .trim();
}

export const INSURANCE_PROVIDERS: InsuranceProvider[] = [
  {
    id: "aioi-bangkok",
    canonicalName: "Aioi Bangkok Insurance Public Company Limited",
    thaiName: "บริษัท ไอโออิ กรุงเทพ ประกันภัย จำกัด (มหาชน)",
    aliases: [
      "Aioi Bangkok Insurance Public Company Limited",
      "Aioi Bangkok Insurance",
      "Aioi Bangkok",
      "Aioi Bangkok Insurance PCL",
      "Aioi Bangkok Insurance Public Co., Ltd.",
      "ไอโออิ",
      "บริษัท ไอโออิ กรุงเทพ ประกันภัย จำกัด (มหาชน)"
    ]
  },
  {
    id: "viriyah",
    canonicalName: "The Viriyah Insurance Public Company Limited",
    thaiName: "บริษัท วิริยะประกันภัย จำกัด (มหาชน)",
    aliases: [
      "The Viriyah Insurance Public Company Limited",
      "Viriyah Insurance Public Company Limited",
      "Viriyah Insurance PCL",
      "The Viriyah Insurance",
      "บริษัท วิริยะประกันภัย จำกัด (มหาชน)",
      "วิริยะประกันภัย"
    ]
  },
  {
    id: "tokio-marine-safety-thailand",
    canonicalName: "Tokio Marine Safety Insurance (Thailand) PCL",
    thaiName: "บริษัท โตเกียวมารีนเซฟตี้ประกันภัย (ประเทศไทย) จำกัด (มหาชน)",
    aliases: [
      "Tokio Marine Safety Insurance (Thailand) PCL",
      "Tokio Marine Safety Insurance Thailand Public Company Limited",
      "Tokio Marine Safety Insurance Thailand PCL",
      "Tokio Marine Safety Insurance",
      "โตเกียวมารีน",
      "บริษัท โตเกียวมารีนเซฟตี้ประกันภัย (ประเทศไทย) จำกัด (มหาชน)"
    ]
  },
  {
    id: "navakij",
    canonicalName: "The Navakij Insurance Public Company Limited",
    thaiName: "บริษัท นวกิจประกันภัย จำกัด (มหาชน)",
    aliases: [
      "The Navakij Insurance Public Company Limited",
      "Navakij Insurance Public Company Limited",
      "Navakij Insurance PCL",
      "The Navakij Insurance",
      "บริษัท นวกิจประกันภัย จำกัด (มหาชน)",
      "นวกิจประกันภัย"
    ]
  }
];

const PROVIDER_BY_ALIAS = new Map<string, InsuranceProvider>();
for (const provider of INSURANCE_PROVIDERS) {
  for (const alias of provider.aliases) {
    PROVIDER_BY_ALIAS.set(normalizeInsurerAlias(alias), provider);
  }
}

export function resolveInsuranceProvider(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const provider = PROVIDER_BY_ALIAS.get(normalizeInsurerAlias(value));
    if (provider) return provider;
  }
  return null;
}

export function canonicalInsurerName(
  insurerEn: string | null | undefined,
  insurerTh: string | null | undefined,
  language: "en" | "th" = "en"
) {
  const provider = resolveInsuranceProvider(insurerEn, insurerTh);
  if (provider) return language === "th" ? provider.thaiName : provider.canonicalName;
  return language === "th" ? insurerTh || insurerEn || "" : insurerEn || insurerTh || "";
}

export function insurerGroupingKey(
  insurerEn: string | null | undefined,
  insurerTh: string | null | undefined
) {
  const provider = resolveInsuranceProvider(insurerEn, insurerTh);
  if (provider) return `provider:${provider.id}`;
  const fallback = normalizeInsurerAlias(insurerEn || insurerTh);
  return fallback ? `raw:${fallback}` : "";
}

export function canonicalInsurerOptions(language: "en" | "th") {
  return INSURANCE_PROVIDERS.map((provider) =>
    language === "th" ? provider.thaiName : provider.canonicalName
  );
}

export type InsurerSpendGroup = {
  key: string;
  name: string;
  recordCount: number;
  premiumTotal: number;
  percentage: number;
  rawNames: string[];
};

export function groupInsurerPremiums(
  records: Array<{
    insurer_en?: string | null;
    insurer_th?: string | null;
    insurance_premium?: number | null;
  }>,
  language: "en" | "th" = "en"
): InsurerSpendGroup[] {
  const groups = new Map<string, Omit<InsurerSpendGroup, "percentage" | "rawNames"> & { rawNames: Set<string> }>();
  for (const record of records) {
    const key = insurerGroupingKey(record.insurer_en, record.insurer_th);
    if (!key) continue;
    const current = groups.get(key) ?? {
      key,
      name: canonicalInsurerName(record.insurer_en, record.insurer_th, language),
      recordCount: 0,
      premiumTotal: 0,
      rawNames: new Set<string>()
    };
    current.recordCount += 1;
    if (record.insurance_premium != null && Number.isFinite(record.insurance_premium)) {
      current.premiumTotal += record.insurance_premium;
    }
    if (record.insurer_en?.trim()) current.rawNames.add(record.insurer_en.trim());
    if (record.insurer_th?.trim()) current.rawNames.add(record.insurer_th.trim());
    groups.set(key, current);
  }
  const total = Array.from(groups.values()).reduce((sum, group) => sum + group.premiumTotal, 0);
  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      rawNames: Array.from(group.rawNames).sort(),
      percentage: total > 0 ? (group.premiumTotal / total) * 100 : 0
    }))
    .sort((a, b) => b.premiumTotal - a.premiumTotal || a.name.localeCompare(b.name));
}

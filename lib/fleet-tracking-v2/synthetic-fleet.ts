export type GpsTrust = "verified" | "unverified" | "missing" | "stale" | "offline";
export type MotionState = "moving" | "stopped" | "offline" | "unknown";
export type TrackerConnectivity = "connected" | "disconnected" | "unknown";

export type SyntheticVehicle = {
  id: string;
  registration: string;
  sampleTag: "SIMULATED";
  trackerConnectivity: TrackerConnectivity;
  locationNameEn: string;
  locationNameTh: string;
  latitude: number | null;
  longitude: number | null;
  speedKph: number | null;
  engineOn: boolean | null;
  reportedAt: string | null;
  gpsTrust: GpsTrust;
  gpsQuality: "gps" | "wifi" | "unknown" | "none";
  scenario: string;
};

/** Frozen clock so the prototype and tests do not invent live GPS times. */
export const FLEET_TRACKING_V2_SYNTHETIC_NOW = "2026-10-25T00:20:00.000Z";

const now = FLEET_TRACKING_V2_SYNTHETIC_NOW;
const minutesAgo = (minutes: number) => new Date(Date.parse(now) - minutes * 60_000).toISOString();

const DEPOT: [number, number] = [13.7275, 100.7485];

/** Synthetic telemetry fixtures use EES registration labels from the local fleet reference inventory. IDs and every reading remain synthetic and unlinked. */
export const SYNTHETIC_FLEET: SyntheticVehicle[] = [
  {
    id: "test-01",
    registration: "3ฒน-9565",
    sampleTag: "SIMULATED",
    trackerConnectivity: "connected",
    locationNameEn: "Lat Krabang depot (sample)",
    locationNameTh: "เดโปลาดกระบัง (ตัวอย่าง)",
    latitude: DEPOT[0],
    longitude: DEPOT[1],
    speedKph: 0,
    engineOn: false,
    reportedAt: minutesAgo(2),
    gpsTrust: "verified",
    gpsQuality: "gps",
    scenario: "depot-overlap"
  },
  {
    id: "test-02",
    registration: "61-2835",
    sampleTag: "SIMULATED",
    trackerConnectivity: "connected",
    locationNameEn: "Lat Krabang depot (sample)",
    locationNameTh: "เดโปลาดกระบัง (ตัวอย่าง)",
    latitude: DEPOT[0],
    longitude: DEPOT[1],
    speedKph: 0,
    engineOn: false,
    reportedAt: minutesAgo(3),
    gpsTrust: "verified",
    gpsQuality: "gps",
    scenario: "depot-overlap"
  },
  {
    id: "test-03",
    registration: "61-6672",
    sampleTag: "SIMULATED",
    trackerConnectivity: "connected",
    locationNameEn: "Lat Krabang depot (sample)",
    locationNameTh: "เดโปลาดกระบัง (ตัวอย่าง)",
    latitude: DEPOT[0],
    longitude: DEPOT[1],
    speedKph: 0,
    engineOn: true,
    reportedAt: minutesAgo(1),
    gpsTrust: "verified",
    gpsQuality: "gps",
    scenario: "depot-overlap"
  },
  {
    id: "test-04",
    registration: "62-1085",
    sampleTag: "SIMULATED",
    trackerConnectivity: "connected",
    locationNameEn: "Lat Krabang depot (sample)",
    locationNameTh: "เดโปลาดกระบัง (ตัวอย่าง)",
    latitude: DEPOT[0],
    longitude: DEPOT[1],
    speedKph: 6,
    engineOn: true,
    reportedAt: minutesAgo(1),
    gpsTrust: "verified",
    gpsQuality: "gps",
    scenario: "depot-overlap"
  },
  {
    id: "test-05",
    registration: "62-4337",
    sampleTag: "SIMULATED",
    trackerConnectivity: "connected",
    locationNameEn: "Rama 9, Bangkok (sample)",
    locationNameTh: "พระราม 9 กรุงเทพฯ (ตัวอย่าง)",
    latitude: 13.7436,
    longitude: 100.5621,
    speedKph: 62,
    engineOn: true,
    reportedAt: minutesAgo(1),
    gpsTrust: "verified",
    gpsQuality: "gps",
    scenario: "spread"
  },
  {
    id: "test-06",
    registration: "63-3543",
    sampleTag: "SIMULATED",
    trackerConnectivity: "connected",
    locationNameEn: "Silom, Bangkok (sample)",
    locationNameTh: "สีลม กรุงเทพฯ (ตัวอย่าง)",
    latitude: 13.7262,
    longitude: 100.53,
    speedKph: 0,
    engineOn: false,
    reportedAt: minutesAgo(4),
    gpsTrust: "verified",
    gpsQuality: "gps",
    scenario: "spread"
  },
  {
    id: "test-07",
    registration: "64-0359",
    sampleTag: "SIMULATED",
    trackerConnectivity: "connected",
    locationNameEn: "Nonthaburi (sample)",
    locationNameTh: "นนทบุรี (ตัวอย่าง)",
    latitude: 13.8591,
    longitude: 100.5217,
    speedKph: 48,
    engineOn: true,
    reportedAt: minutesAgo(2),
    gpsTrust: "verified",
    gpsQuality: "gps",
    scenario: "spread"
  },
  {
    id: "test-08",
    registration: "64-5954",
    sampleTag: "SIMULATED",
    trackerConnectivity: "connected",
    locationNameEn: "Pathum Thani (sample)",
    locationNameTh: "ปทุมธานี (ตัวอย่าง)",
    latitude: 14.0208,
    longitude: 100.525,
    speedKph: 0,
    engineOn: false,
    reportedAt: minutesAgo(6),
    gpsTrust: "verified",
    gpsQuality: "gps",
    scenario: "spread"
  },
  {
    id: "test-09",
    registration: "64-5956",
    sampleTag: "SIMULATED",
    trackerConnectivity: "connected",
    locationNameEn: "Samut Prakan (sample)",
    locationNameTh: "สมุทรปราการ (ตัวอย่าง)",
    latitude: 13.599,
    longitude: 100.5998,
    speedKph: 55,
    engineOn: true,
    reportedAt: minutesAgo(2),
    gpsTrust: "verified",
    gpsQuality: "gps",
    scenario: "spread"
  },
  {
    id: "test-10",
    registration: "64-8665",
    sampleTag: "SIMULATED",
    trackerConnectivity: "connected",
    locationNameEn: "Chonburi (sample)",
    locationNameTh: "ชลบุรี (ตัวอย่าง)",
    latitude: 13.3611,
    longitude: 100.9847,
    speedKph: 70,
    engineOn: true,
    reportedAt: minutesAgo(3),
    gpsTrust: "verified",
    gpsQuality: "gps",
    scenario: "spread"
  },
  {
    id: "test-11",
    registration: "68-7154",
    sampleTag: "SIMULATED",
    trackerConnectivity: "connected",
    locationNameEn: "Laem Chabang (sample)",
    locationNameTh: "แหลมฉบัง (ตัวอย่าง)",
    latitude: 13.081,
    longitude: 100.883,
    speedKph: 0,
    engineOn: false,
    reportedAt: minutesAgo(5),
    gpsTrust: "verified",
    gpsQuality: "gps",
    scenario: "spread"
  },
  {
    id: "test-12",
    registration: "700-4145",
    sampleTag: "SIMULATED",
    trackerConnectivity: "connected",
    locationNameEn: "Rayong (sample)",
    locationNameTh: "ระยอง (ตัวอย่าง)",
    latitude: 12.6833,
    longitude: 101.2833,
    speedKph: 64,
    engineOn: true,
    reportedAt: minutesAgo(2),
    gpsTrust: "verified",
    gpsQuality: "gps",
    scenario: "spread"
  },
  {
    id: "test-13",
    registration: "701-5145",
    sampleTag: "SIMULATED",
    trackerConnectivity: "connected",
    locationNameEn: "Ayutthaya (sample)",
    locationNameTh: "พระนครศรีอยุธยา (ตัวอย่าง)",
    latitude: 14.3692,
    longitude: 100.5877,
    speedKph: 0,
    engineOn: false,
    reportedAt: minutesAgo(8),
    gpsTrust: "verified",
    gpsQuality: "gps",
    scenario: "spread"
  },
  {
    id: "test-14",
    registration: "74-8969",
    sampleTag: "SIMULATED",
    trackerConnectivity: "connected",
    locationNameEn: "Saraburi (sample)",
    locationNameTh: "สระบุรี (ตัวอย่าง)",
    latitude: 14.5289,
    longitude: 100.9108,
    speedKph: 51,
    engineOn: true,
    reportedAt: minutesAgo(3),
    gpsTrust: "verified",
    gpsQuality: "gps",
    scenario: "spread"
  },
  {
    id: "test-15",
    registration: "78-6996",
    sampleTag: "SIMULATED",
    trackerConnectivity: "connected",
    locationNameEn: "Nakhon Pathom (sample)",
    locationNameTh: "นครปฐม (ตัวอย่าง)",
    latitude: 13.8196,
    longitude: 100.0643,
    speedKph: 0,
    engineOn: true,
    reportedAt: minutesAgo(4),
    gpsTrust: "verified",
    gpsQuality: "gps",
    scenario: "spread"
  },
  {
    id: "test-16",
    registration: "79-2945",
    sampleTag: "SIMULATED",
    trackerConnectivity: "connected",
    locationNameEn: "Chachoengsao (sample)",
    locationNameTh: "ฉะเชิงเทรา (ตัวอย่าง)",
    latitude: 13.6884,
    longitude: 101.0779,
    speedKph: 43,
    engineOn: true,
    reportedAt: minutesAgo(2),
    gpsTrust: "verified",
    gpsQuality: "gps",
    scenario: "spread"
  },
  {
    id: "test-17",
    registration: "79-5318",
    sampleTag: "SIMULATED",
    trackerConnectivity: "connected",
    locationNameEn: "Chiang Mai (sample, outside usual area)",
    locationNameTh: "เชียงใหม่ (ตัวอย่าง นอกพื้นที่ปกติ)",
    latitude: 18.7883,
    longitude: 98.9853,
    speedKph: 0,
    engineOn: false,
    reportedAt: minutesAgo(7),
    gpsTrust: "verified",
    gpsQuality: "gps",
    scenario: "outside-operating-area"
  },
  {
    id: "test-18",
    registration: "ฒอ8453",
    sampleTag: "SIMULATED",
    trackerConnectivity: "unknown",
    locationNameEn: "No GPS position",
    locationNameTh: "ไม่มีพิกัด GPS",
    latitude: null,
    longitude: null,
    speedKph: null,
    engineOn: null,
    reportedAt: null,
    gpsTrust: "missing",
    gpsQuality: "none",
    scenario: "missing-gps"
  },
  {
    id: "test-19",
    registration: "700-6659",
    sampleTag: "SIMULATED",
    trackerConnectivity: "connected",
    locationNameEn: "Reported Wi-Fi position (not trusted)",
    locationNameTh: "พิกัด Wi-Fi ที่รายงาน (ไม่ยืนยัน)",
    latitude: 13.7563,
    longitude: 100.5018,
    speedKph: 12,
    engineOn: true,
    reportedAt: minutesAgo(1),
    gpsTrust: "unverified",
    gpsQuality: "wifi",
    scenario: "unverified-wifi"
  },
  {
    id: "test-20",
    registration: "701-1654",
    sampleTag: "SIMULATED",
    trackerConnectivity: "connected",
    locationNameEn: "Bangna (sample, stale report)",
    locationNameTh: "บางนา (ตัวอย่าง รายงานเก่า)",
    latitude: 13.6682,
    longitude: 100.6428,
    speedKph: 38,
    engineOn: true,
    reportedAt: minutesAgo(480),
    gpsTrust: "stale",
    gpsQuality: "gps",
    scenario: "stale-report"
  },
  {
    id: "test-21",
    registration: "4กข-98",
    sampleTag: "SIMULATED",
    trackerConnectivity: "disconnected",
    locationNameEn: "GPS offline",
    locationNameTh: "GPS ออฟไลน์",
    latitude: 13.71,
    longitude: 100.52,
    speedKph: null,
    engineOn: null,
    reportedAt: minutesAgo(90),
    gpsTrust: "offline",
    gpsQuality: "unknown",
    scenario: "offline"
  }
];

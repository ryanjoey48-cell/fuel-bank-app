"use client";

import clsx from "clsx";
import Image from "next/image";
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  ChevronDown,
  Clock3,
  FileText,
  Info,
  Printer,
  RefreshCw,
  Route,
  Truck,
  Users
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  buildBookingBusinessInsights,
  type BookingCountShare,
  type BookingInsightsPeriod,
  type BookingInsightsPeriodKey,
  type BookingInsightsResult,
  type BookingReadinessMetric,
  type CanonicalVehicleType,
  type ReadinessKey
} from "@/lib/booking-insights";
import type { Language } from "@/lib/translations";
import { formatDate } from "@/lib/utils";
import type { BookingDiaryEntry, Driver, TripJourney, Vehicle } from "@/types/database";

type BookingBusinessInsightsProps = {
  bookings: BookingDiaryEntry[];
  tripsByBookingId: Map<string, TripJourney>;
  vehicles: Vehicle[];
  drivers: Driver[];
  language: Language;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
};

const copyByLanguage = {
  en: {
    title: "Business Insights",
    subtitle: "A read-only management view of planned work in Booking Diary.",
    managerView: "Manager Overview",
    detailView: "Detailed Analysis",
    refresh: "Refresh",
    refreshing: "Refreshing...",
    print: "Print",
    printManager: "Print Manager Summary",
    printFull: "Print Full Report",
    period: "Reporting period",
    last7: "Latest 7 days",
    last30: "Latest 30 days",
    last90: "Latest 90 days",
    all: "All records",
    custom: "Custom dates",
    startDate: "Start date",
    endDate: "End date",
    selectedPeriod: "Selected period",
    latestRecord: "Latest Booking Diary information",
    freshnessHelp: "The selected period ends on the latest available record, not today's date.",
    businessOverview: "Business overview",
    plannedBookings: "Planned bookings",
    plannedHelper: (count: number) => `${count.toLocaleString()} planned jobs are recorded in this period.`,
    periodChange: "Change from previous period",
    repeatWork: "Repeat-route work",
    repeatHelper: (percent: number) => `${percent}% of bookings use routes active on multiple dates.`,
    busiestDay: "Busiest operational day",
    busiestDayHelper: (day: string, average: number) => `${day} averages ${average} bookings per occurrence.`,
    requestedVehicle: "Most requested vehicle",
    vehicleHelper: (vehicle: string, percent: number) => `${vehicle} represents ${percent}% of recorded demand.`,
    peakPickup: "Peak pickup-time period",
    pickupHelper: (band: string, percent: number) => `${percent}% of timed pickups take place during ${band}.`,
    comparisonUnavailable: "A complete preceding period is not available.",
    noPreviousBookings: "No bookings were recorded in the previous comparable period.",
    allHistoryComparison: "Comparison is not used for all-history reports.",
    upcoming: "Upcoming workload",
    upcomingHelp: "Calculated from the current Bangkok date, independently of the reporting-period selector.",
    next7: "Next 7 days",
    next14: "Next 14 days",
    busiestUpcoming: "Busiest upcoming date",
    vehiclesRequired: "Vehicles required",
    withoutDriver: "Without driver",
    withoutPickupTime: "Without pickup time",
    upcomingRoutes: "Top upcoming routes",
    upcomingClients: "Top upcoming clients",
    noUpcoming: "No upcoming bookings are currently recorded in Booking Diary.",
    whatToDo: "What we should do",
    actionCapacity: (vehicle: string, day: string, average: number) => `Prepare ${vehicle} availability on ${day}. This day averages ${average} bookings in the selected period.`,
    actionDispatch: (band: string, count: number, percent: number) => `Plan dispatch coverage for ${band}. This window contains ${count} timed pickups (${percent}%).`,
    actionRoutes: (percent: number, count: number) => `Standardise the most-used routes. Repeat operating routes cover ${count} bookings (${percent}%).`,
    noOperationalAction: "There is not enough recorded activity to generate three reliable operational actions.",
    customerActivity: "Client activity",
    customerHelp: "Client activity uses only the canonical Client Name linked to each Booking Diary record.",
    customer: "Client",
    bookings: "Bookings",
    share: "Share",
    commonRoute: "Most common route",
    vehicle: "Vehicle",
    recentBooking: "Most recent booking",
    change: "Change",
    newlyActive: "Newly active",
    increasing: "Booking activity increased",
    reduced: "Booking activity lower than the previous period",
    noRecentActivity: "Regular clients without activity in the latest 30 recorded days",
    noCustomerData: "No Booking Diary records in this view have a linked Client Name.",
    clientCoverage: "Client-name coverage",
    topUpcomingClient: "Top upcoming client",
    topSixWheelClient: "Top 6-wheel client",
    topFiveClientCoverage: (percent: number) => `The top five clients account for ${percent}% of selected bookings.`,
    clientDetails: "Detailed client activity",
    firstBooking: "First booking",
    activeDatesClient: "Active booking dates",
    commonWeekday: "Common weekday",
    peakTime: "Peak pickup time",
    captureSinceLaunch: "Created since client capture launched",
    clientRecommendations: "Client actions",
    routes: "Recurring routes",
    routesHelp: "A recurring route must appear on at least two separate dates. Reverse routes remain separate.",
    topFiveCoverage: (percent: number) => `The top five recurring routes cover ${percent}% of selected bookings.`,
    activeDates: "Active dates",
    latest: "Most recent",
    averageGap: "Average gap",
    distance: "Average distance",
    opportunity: "New and growing route opportunities",
    opportunityHelp: "Manager Overview shows the three strongest patterns; the complete list is in Detailed Analysis.",
    status: "Status",
    watch: "Watch",
    growing: "Growing",
    strongPattern: "Strong pattern",
    firstRecorded: "First recorded",
    oneOffs: "One-off newly observed routes",
    operationalPatterns: "Operational patterns",
    weeklyTrend: "Weekly workload trend",
    weeklyTotal: "Weekly total",
    activeDayAverage: "Average per active day",
    previousWeek: "Previous week",
    highestWeek: "Highest-volume week",
    weekdayDemand: "Demand by weekday",
    weekdayAverage: "Avg / occurrence",
    pickupDemand: "Demand by pickup-time period",
    pickupSample: (count: number) => `Based on ${count.toLocaleString()} bookings with a recorded pickup time.`,
    vehicleDemand: "Demand by vehicle type",
    improveInfo: "Improve our information",
    improveInfoHelp: "The three most useful recording improvements for better planning.",
    missingPickup: "Missing pickup times",
    missingPickupWhy: "Makes dispatch-hour planning less accurate.",
    unclassifiedVehicles: "Unclassified vehicle labels",
    unclassifiedWhy: "Makes vehicle-demand planning less accurate.",
    missingMaps: "Missing Google Maps or distance information",
    missingMapsWhy: "Prevents reliable distance and route-cost comparisons.",
    affected: "affected",
    tripSetup: "Booking Diary → Trip Journey linking has not started yet.",
    tripStatus: (linked: number, total: number) => `${linked} of ${total} measurable bookings linked`,
    linkingStarted: "Linking workflow start date",
    notFailure: "This is a data-linkage status, not an operational failure.",
    detailIntro: "Full route tables, data readiness, one-offs, and reporting definitions.",
    readiness: "Complete data readiness",
    overall: "Overall selected period",
    recent: "Recent records",
    historical: "Historical records",
    records: "records",
    methodology: "Methodology and limitations",
    noData: "No booking records are available for this period.",
    unavailable: "Not available",
    unclassified: "Unclassified",
    days: "days",
    basedOn: (count: number) => `Based on ${count} records`,
    showAll: "Show all",
    showLess: "Show less",
    generated: "Generated",
    managerReport: "Manager Summary",
    fullReport: "Full Business Insights Report",
    weekdayLabels: {
      Monday: "Monday", Tuesday: "Tuesday", Wednesday: "Wednesday", Thursday: "Thursday",
      Friday: "Friday", Saturday: "Saturday", Sunday: "Sunday"
    },
    vehicleLabels: {
      FOUR_WHEEL_TRUCK: "4-wheel truck",
      SIX_WHEEL_TRUCK: "6-wheel truck",
      SIX_PLUS_SIX_WHEELER: "6+6-wheel truck",
      EIGHTEEN_WHEELER: "18-wheel truck / trailer",
      UNCLASSIFIED: "Unclassified"
    },
    readinessLabels: {
      client: "Linked Client Name",
      google: "Google Maps-verified routes",
      distance: "Available distance estimates",
      vehicle_recorded: "Vehicle value recorded",
      vehicle_recognized: "Standard vehicle type recognized",
      driver: "Driver assignments",
      trip: "Eligible bookings linked to Trip Journey"
    },
    methodologyItems: [
      "Booking Diary represents planned work; Trip Journey represents actual journeys and remains separate.",
      "Latest-period reports end on the latest Booking Diary record. Upcoming workload always uses the current Bangkok date.",
      "Route and vehicle grouping is reporting-only. Original Supabase values are not modified.",
      "Repeat routes require bookings on at least two separate dates; reverse routes are counted separately.",
      "Client activity uses only the canonical Client Name relation. Pickup, drop-off, and notes are never interpreted as client names.",
      "Trip Journey coverage uses only the explicit Booking Diary foreign key and never auto-links historical records."
    ]
  },
  th: {
    title: "ข้อมูลเชิงลึกทางธุรกิจ",
    subtitle: "มุมมองผู้บริหารแบบอ่านอย่างเดียวจากงานที่วางแผนไว้ในสมุดจองงาน",
    managerView: "ภาพรวมผู้บริหาร",
    detailView: "การวิเคราะห์โดยละเอียด",
    refresh: "รีเฟรช",
    refreshing: "กำลังรีเฟรช...",
    print: "พิมพ์",
    printManager: "พิมพ์สรุปผู้บริหาร",
    printFull: "พิมพ์รายงานฉบับเต็ม",
    period: "ช่วงรายงาน",
    last7: "7 วันล่าสุด",
    last30: "30 วันล่าสุด",
    last90: "90 วันล่าสุด",
    all: "ข้อมูลทั้งหมด",
    custom: "กำหนดวันที่",
    startDate: "วันที่เริ่มต้น",
    endDate: "วันที่สิ้นสุด",
    selectedPeriod: "ช่วงที่เลือก",
    latestRecord: "ข้อมูลสมุดจองงานล่าสุด",
    freshnessHelp: "ช่วงรายงานสิ้นสุดที่ข้อมูลล่าสุด ไม่ใช่วันที่วันนี้",
    businessOverview: "ภาพรวมธุรกิจ",
    plannedBookings: "งานจองที่วางแผนไว้",
    plannedHelper: (count: number) => `มีงานที่วางแผนไว้ ${count.toLocaleString()} งานในช่วงนี้`,
    periodChange: "เปลี่ยนแปลงจากช่วงก่อนหน้า",
    repeatWork: "งานเส้นทางที่เกิดซ้ำ",
    repeatHelper: (percent: number) => `${percent}% ของงานใช้เส้นทางที่เกิดขึ้นมากกว่าหนึ่งวัน`,
    busiestDay: "วันปฏิบัติงานที่ยุ่งที่สุด",
    busiestDayHelper: (day: string, average: number) => `${day} มีงานเฉลี่ย ${average} งานต่อครั้ง`,
    requestedVehicle: "รถที่มีความต้องการสูงสุด",
    vehicleHelper: (vehicle: string, percent: number) => `${vehicle} คิดเป็น ${percent}% ของความต้องการที่บันทึกไว้`,
    peakPickup: "ช่วงเวลารับสินค้าที่สูงสุด",
    pickupHelper: (band: string, percent: number) => `${percent}% ของงานที่มีเวลาอยู่ในช่วง ${band}`,
    comparisonUnavailable: "ไม่มีข้อมูลช่วงก่อนหน้าที่ครบถ้วนสำหรับเปรียบเทียบ",
    noPreviousBookings: "ไม่มีงานในช่วงก่อนหน้าที่เทียบเคียงกัน",
    allHistoryComparison: "ไม่เปรียบเทียบสำหรับรายงานข้อมูลทั้งหมด",
    upcoming: "งานที่กำลังจะมาถึง",
    upcomingHelp: "คำนวณจากวันที่ปัจจุบันในกรุงเทพฯ โดยไม่ขึ้นกับตัวเลือกช่วงรายงาน",
    next7: "7 วันข้างหน้า",
    next14: "14 วันข้างหน้า",
    busiestUpcoming: "วันที่จะยุ่งที่สุด",
    vehiclesRequired: "รถที่ต้องใช้",
    withoutDriver: "ยังไม่มีคนขับ",
    withoutPickupTime: "ยังไม่มีเวลารับ",
    upcomingRoutes: "เส้นทางงานข้างหน้าหลัก",
    upcomingClients: "ลูกค้าที่มีงานข้างหน้าสูงสุด",
    noUpcoming: "ขณะนี้ไม่มีงานในอนาคตบันทึกไว้ในสมุดจองงาน",
    whatToDo: "สิ่งที่ควรทำ",
    actionCapacity: (vehicle: string, day: string, average: number) => `เตรียมความพร้อมของ${vehicle}ในวัน${day} เพราะมีงานเฉลี่ย ${average} งานในช่วงที่เลือก`,
    actionDispatch: (band: string, count: number, percent: number) => `วางกำลังจัดส่งในช่วง ${band} เพราะมีงานที่ระบุเวลา ${count} งาน (${percent}%)`,
    actionRoutes: (percent: number, count: number) => `จัดมาตรฐานเส้นทางที่ใช้บ่อย เพราะครอบคลุม ${count} งาน (${percent}%)`,
    noOperationalAction: "ข้อมูลกิจกรรมยังไม่เพียงพอสำหรับสร้างคำแนะนำที่เชื่อถือได้ครบสามข้อ",
    customerActivity: "กิจกรรมลูกค้า",
    customerHelp: "กิจกรรมลูกค้าใช้เฉพาะ Client Name ที่เชื่อมกับรายการ Booking Diary",
    customer: "ลูกค้า",
    bookings: "งาน",
    share: "สัดส่วน",
    commonRoute: "เส้นทางที่ใช้บ่อย",
    vehicle: "รถ",
    recentBooking: "งานล่าสุด",
    change: "เปลี่ยนแปลง",
    newlyActive: "เริ่มมีงานใหม่",
    increasing: "กิจกรรมการจองเพิ่มขึ้น",
    reduced: "กิจกรรมการจองต่ำกว่าช่วงก่อนหน้า",
    noRecentActivity: "ลูกค้าประจำที่ไม่มีงานใน 30 วันล่าสุดของข้อมูล",
    noCustomerData: "ไม่มีรายการในมุมมองนี้ที่เชื่อมกับชื่อลูกค้า",
    clientCoverage: "ความครบถ้วนของชื่อลูกค้า",
    topUpcomingClient: "ลูกค้าที่มีงานข้างหน้าสูงสุด",
    topSixWheelClient: "ลูกค้าที่ใช้รถ 6 ล้อสูงสุด",
    topFiveClientCoverage: (percent: number) => `ลูกค้า 5 อันดับแรกคิดเป็น ${percent}% ของงานที่เลือก`,
    clientDetails: "รายละเอียดกิจกรรมลูกค้า",
    firstBooking: "งานแรก",
    activeDatesClient: "วันที่มีงาน",
    commonWeekday: "วันประจำ",
    peakTime: "ช่วงเวลารับของสูงสุด",
    captureSinceLaunch: "รายการที่สร้างหลังเริ่มระบบชื่อลูกค้า",
    clientRecommendations: "สิ่งที่ควรทำกับลูกค้า",
    routes: "เส้นทางที่เกิดซ้ำ",
    routesHelp: "เส้นทางที่เกิดซ้ำต้องปรากฏอย่างน้อยสองวันที่ต่างกัน และแยกเส้นทางย้อนกลับ",
    topFiveCoverage: (percent: number) => `ห้าเส้นทางหลักครอบคลุม ${percent}% ของงานในช่วงที่เลือก`,
    activeDates: "จำนวนวันที่มีงาน",
    latest: "ล่าสุด",
    averageGap: "ระยะห่างเฉลี่ย",
    distance: "ระยะทางเฉลี่ย",
    opportunity: "โอกาสจากเส้นทางใหม่และกำลังเติบโต",
    opportunityHelp: "ภาพรวมแสดงสามรูปแบบที่ชัดที่สุด รายการทั้งหมดอยู่ในการวิเคราะห์โดยละเอียด",
    status: "สถานะ",
    watch: "เฝ้าดู",
    growing: "กำลังเติบโต",
    strongPattern: "รูปแบบชัดเจน",
    firstRecorded: "พบครั้งแรก",
    oneOffs: "เส้นทางใหม่ที่พบครั้งเดียว",
    operationalPatterns: "รูปแบบการปฏิบัติงาน",
    weeklyTrend: "แนวโน้มงานรายสัปดาห์",
    weeklyTotal: "งานต่อสัปดาห์",
    activeDayAverage: "เฉลี่ยต่อวันที่มีงาน",
    previousWeek: "เทียบสัปดาห์ก่อน",
    highestWeek: "สัปดาห์ที่มีงานสูงสุด",
    weekdayDemand: "ความต้องการตามวัน",
    weekdayAverage: "เฉลี่ยต่อครั้ง",
    pickupDemand: "ความต้องการตามช่วงเวลารับ",
    pickupSample: (count: number) => `อ้างอิงจาก ${count.toLocaleString()} งานที่บันทึกเวลารับสินค้า`,
    vehicleDemand: "ความต้องการตามประเภทรถ",
    improveInfo: "ปรับปรุงข้อมูลของเรา",
    improveInfoHelp: "สามเรื่องสำคัญที่จะช่วยให้วางแผนได้แม่นยำขึ้น",
    missingPickup: "เวลารับสินค้าที่ขาดหาย",
    missingPickupWhy: "ทำให้การวางแผนกำลังจัดส่งตามเวลาแม่นยำน้อยลง",
    unclassifiedVehicles: "ชื่อประเภทรถที่ยังจัดกลุ่มไม่ได้",
    unclassifiedWhy: "ทำให้การวางแผนความต้องการรถแม่นยำน้อยลง",
    missingMaps: "ข้อมูล Google Maps หรือระยะทางที่ขาดหาย",
    missingMapsWhy: "ทำให้ยังเปรียบเทียบระยะทางและต้นทุนเส้นทางไม่ได้อย่างน่าเชื่อถือ",
    affected: "รายการที่ได้รับผลกระทบ",
    tripSetup: "ยังไม่ได้เริ่มเชื่อมสมุดจองงาน → Trip Journey",
    tripStatus: (linked: number, total: number) => `เชื่อมแล้ว ${linked} จาก ${total} งานที่วัดผลได้`,
    linkingStarted: "วันที่เริ่มขั้นตอนการเชื่อม",
    notFailure: "นี่คือสถานะการเชื่อมข้อมูล ไม่ใช่ความล้มเหลวในการปฏิบัติงาน",
    detailIntro: "ตารางเส้นทางเต็ม ความพร้อมของข้อมูล งานครั้งเดียว และคำอธิบายการคำนวณ",
    readiness: "ความพร้อมของข้อมูลทั้งหมด",
    overall: "ช่วงที่เลือกทั้งหมด",
    recent: "ข้อมูลล่าสุด",
    historical: "ข้อมูลย้อนหลัง",
    records: "รายการ",
    methodology: "วิธีคำนวณและข้อจำกัด",
    noData: "ไม่มีรายการจองในช่วงนี้",
    unavailable: "ไม่มีข้อมูล",
    unclassified: "ยังจัดกลุ่มไม่ได้",
    days: "วัน",
    basedOn: (count: number) => `อ้างอิงจาก ${count} รายการ`,
    showAll: "แสดงทั้งหมด",
    showLess: "แสดงน้อยลง",
    generated: "สร้างเมื่อ",
    managerReport: "สรุปสำหรับผู้บริหาร",
    fullReport: "รายงานข้อมูลเชิงลึกฉบับเต็ม",
    weekdayLabels: {
      Monday: "จันทร์", Tuesday: "อังคาร", Wednesday: "พุธ", Thursday: "พฤหัสบดี",
      Friday: "ศุกร์", Saturday: "เสาร์", Sunday: "อาทิตย์"
    },
    vehicleLabels: {
      FOUR_WHEEL_TRUCK: "รถ 4 ล้อ",
      SIX_WHEEL_TRUCK: "รถ 6 ล้อ",
      SIX_PLUS_SIX_WHEELER: "รถ 6+6 ล้อ",
      EIGHTEEN_WHEELER: "รถ 18 ล้อ / รถพ่วง",
      UNCLASSIFIED: "ยังจัดกลุ่มไม่ได้"
    },
    readinessLabels: {
      client: "เชื่อมโยงชื่อลูกค้า",
      google: "เส้นทางที่ยืนยันด้วย Google Maps",
      distance: "ข้อมูลระยะทาง",
      vehicle_recorded: "บันทึกข้อมูลรถ",
      vehicle_recognized: "จัดกลุ่มประเภทรถได้",
      driver: "ระบุคนขับ",
      trip: "เชื่อมงานที่วัดผลได้กับ Trip Journey"
    },
    methodologyItems: [
      "สมุดจองงานแสดงงานที่วางแผนไว้ ส่วน Trip Journey แสดงการเดินทางจริงและยังเป็นขั้นตอนแยกกัน",
      "รายงานช่วงล่าสุดสิ้นสุดที่ข้อมูลล่าสุด ส่วนงานที่กำลังจะมาถึงใช้วันที่ปัจจุบันในกรุงเทพฯ เสมอ",
      "การจัดกลุ่มเส้นทางและรถใช้เพื่อรายงานเท่านั้น โดยไม่แก้ไขข้อมูลเดิมใน Supabase",
      "เส้นทางที่เกิดซ้ำต้องมีงานอย่างน้อยสองวันที่ต่างกัน และนับเส้นทางย้อนกลับแยกกัน",
      "กิจกรรมลูกค้าใช้เฉพาะความสัมพันธ์ Client Name เท่านั้น และจะไม่ตีความจุดรับ จุดส่ง หรือหมายเหตุเป็นชื่อลูกค้า",
      "ความครอบคลุม Trip Journey ใช้เฉพาะ foreign key ที่ชัดเจนและไม่เชื่อมข้อมูลย้อนหลังอัตโนมัติ"
    ]
  }
} as const;

const periodOptions: Array<{ key: BookingInsightsPeriodKey; labelKey: "last7" | "last30" | "last90" | "all" | "custom" }> = [
  { key: "7d", labelKey: "last7" },
  { key: "30d", labelKey: "last30" },
  { key: "90d", labelKey: "last90" },
  { key: "all", labelKey: "all" },
  { key: "custom", labelKey: "custom" }
];

type InsightView = "manager" | "detail";
type PrintMode = "manager" | "full";
type DetailSection = "clients" | "routes" | "opportunities" | "readiness" | "methodology";

function bangkokTodayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

function percentText(value: number | null) {
  return value === null ? "-" : `${value}%`;
}

function rangeText(start: string | null, end: string | null, language: Language, fallback: string) {
  return start && end ? `${formatDate(start, language)} - ${formatDate(end, language)}` : fallback;
}

function vehicleLabel(type: CanonicalVehicleType, language: "en" | "th") {
  return copyByLanguage[language].vehicleLabels[type];
}

function weekdayLabel(value: string | null, language: "en" | "th") {
  if (!value) return copyByLanguage[language].unavailable;
  return copyByLanguage[language].weekdayLabels[value as keyof typeof copyByLanguage.en.weekdayLabels] ?? value;
}

function metricFor(insights: BookingInsightsResult, key: ReadinessKey) {
  return insights.readinessCohorts[0].metrics.find((metric) => metric.key === key);
}

function opportunityLabel(status: BookingInsightsResult["newRecurringRouteOpportunities"][number]["status"], language: "en" | "th") {
  const copy = copyByLanguage[language];
  return status === "strong_pattern" ? copy.strongPattern : status === "growing" ? copy.growing : copy.watch;
}

function comparisonText(insights: BookingInsightsResult, language: "en" | "th") {
  const copy = copyByLanguage[language];
  if (insights.comparisonStatus === "available") {
    const change = insights.summary.bookingChangePercent ?? 0;
    return `${change > 0 ? "+" : ""}${change}%`;
  }
  if (insights.comparisonStatus === "no_previous_data") return copy.noPreviousBookings;
  if (insights.comparisonStatus === "incomplete_history") return copy.comparisonUnavailable;
  return copy.allHistoryComparison;
}

function operationalRecommendations(insights: BookingInsightsResult, language: "en" | "th") {
  const copy = copyByLanguage[language];
  const actions: string[] = [];
  const topVehicle = insights.summary.mostRequestedVehicleType;
  if (topVehicle !== "UNCLASSIFIED" && insights.summary.busiestWeekday && insights.summary.busiestWeekdayAverage !== null) {
    actions.push(copy.actionCapacity(
      vehicleLabel(topVehicle, language),
      weekdayLabel(insights.summary.busiestWeekday, language),
      insights.summary.busiestWeekdayAverage
    ));
  }
  const peak = insights.pickupTimeDemand[0];
  if (peak) actions.push(copy.actionDispatch(peak.label, peak.count, peak.percent));
  const repeatCount = Math.round(insights.selectedBookings.length * insights.summary.repeatRoutePercent / 100);
  if (repeatCount > 0) actions.push(copy.actionRoutes(insights.summary.repeatRoutePercent, repeatCount));
  return actions.slice(0, 3);
}

export function BookingBusinessInsights({
  bookings,
  tripsByBookingId,
  vehicles,
  drivers,
  language,
  loading,
  refreshing,
  onRefresh
}: BookingBusinessInsightsProps) {
  const languageKey = language === "th" ? "th" : "en";
  const copy = copyByLanguage[languageKey];
  const [view, setView] = useState<InsightView>("manager");
  const [periodKey, setPeriodKey] = useState<BookingInsightsPeriodKey>("30d");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [printMode, setPrintMode] = useState<PrintMode>("manager");
  const [generatedAt, setGeneratedAt] = useState("");
  const [detailSections, setDetailSections] = useState<Record<DetailSection, boolean>>({
    clients: true,
    routes: true,
    opportunities: false,
    readiness: false,
    methodology: false
  });

  useEffect(() => {
    const savedView = window.sessionStorage.getItem("booking-insights:view");
    if (savedView === "manager" || savedView === "detail") setView(savedView);
    const savedSections = window.sessionStorage.getItem("booking-insights:detail-sections");
    if (savedSections) {
      try {
        setDetailSections((current) => ({ ...current, ...JSON.parse(savedSections) }));
      } catch {
        window.sessionStorage.removeItem("booking-insights:detail-sections");
      }
    }
    setGeneratedAt(new Intl.DateTimeFormat(languageKey === "th" ? "th-TH" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Bangkok"
    }).format(new Date()));
  }, [languageKey]);

  const selectView = (next: InsightView) => {
    setView(next);
    window.sessionStorage.setItem("booking-insights:view", next);
  };

  const toggleDetail = (key: DetailSection) => {
    setDetailSections((current) => {
      const next = { ...current, [key]: !current[key] };
      window.sessionStorage.setItem("booking-insights:detail-sections", JSON.stringify(next));
      return next;
    });
  };

  const period = useMemo<BookingInsightsPeriod>(() => ({
    key: periodKey,
    startDate: periodKey === "custom" ? customStartDate || null : null,
    endDate: periodKey === "custom" ? customEndDate || null : null
  }), [customEndDate, customStartDate, periodKey]);

  const insights = useMemo(
    () => buildBookingBusinessInsights(bookings, tripsByBookingId, vehicles, drivers, period, bangkokTodayKey()),
    [bookings, drivers, period, tripsByBookingId, vehicles]
  );
  const selectedRange = rangeText(insights.selectedPeriod.startDate, insights.selectedPeriod.endDate, language, copy.all);
  const actions = useMemo(() => operationalRecommendations(insights, languageKey), [insights, languageKey]);
  const printReport = (mode: PrintMode) => {
    setPrintMode(mode);
    window.setTimeout(() => window.print(), 0);
  };

  return (
    <section className={clsx("booking-insights-report", `print-mode-${printMode}`)}>
      <div className="booking-insights-screen grid gap-3">
        <header className="booking-insights-toolbar surface-card-soft">
          <div className="min-w-0">
            <p className="badge-muted w-fit">{copy.title}</p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">{selectedRange}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">{copy.subtitle}</p>
          </div>
          <div className="booking-insights-view-switch" role="tablist" aria-label={copy.title}>
            <button type="button" role="tab" aria-selected={view === "manager"} onClick={() => selectView("manager")}>{copy.managerView}</button>
            <button type="button" role="tab" aria-selected={view === "detail"} onClick={() => selectView("detail")}>{copy.detailView}</button>
          </div>
          <div className="booking-insights-toolbar-period">
            <label className="form-field">
              <span className="form-label">{copy.period}</span>
              <select value={periodKey} onChange={(event) => setPeriodKey(event.target.value as BookingInsightsPeriodKey)} className="booking-filter-control">
                {periodOptions.map((option) => <option key={option.key} value={option.key}>{copy[option.labelKey]}</option>)}
              </select>
            </label>
            {periodKey === "custom" ? <>
              <label className="form-field"><span className="form-label">{copy.startDate}</span><input type="date" value={customStartDate} onChange={(event) => setCustomStartDate(event.target.value)} className="booking-filter-control" /></label>
              <label className="form-field"><span className="form-label">{copy.endDate}</span><input type="date" value={customEndDate} onChange={(event) => setCustomEndDate(event.target.value)} className="booking-filter-control" /></label>
            </> : null}
          </div>
          <div className="booking-insights-actions">
            <button type="button" onClick={onRefresh} disabled={refreshing} className="btn-secondary gap-2">
              <RefreshCw className={clsx("h-4 w-4", refreshing && "animate-spin")} />
              <span>{refreshing ? copy.refreshing : copy.refresh}</span>
            </button>
            <details className="booking-insights-print-menu">
              <summary className="btn-primary gap-2"><Printer className="h-4 w-4" />{copy.print}<ChevronDown className="h-3.5 w-3.5" /></summary>
              <div><button type="button" onClick={() => printReport("manager")}>{copy.printManager}</button><button type="button" onClick={() => printReport("full")}>{copy.printFull}</button></div>
            </details>
          </div>
        </header>

        {loading ? <p className="loading-inline">{copy.refreshing}</p> : insights.selectedBookings.length === 0 ? (
          <div className="premium-empty-state"><FileText className="h-8 w-8 text-brand-700" /><h3 className="mt-3 text-lg font-semibold text-slate-950">{copy.noData}</h3></div>
        ) : <>
          <div className="booking-insights-freshness">
            <span><strong>{copy.selectedPeriod}:</strong> {selectedRange}</span>
            <span><strong>{copy.latestRecord}:</strong> {insights.latestAvailableDate ? formatDate(insights.latestAvailableDate, language) : copy.unavailable}</span>
            <small>{copy.freshnessHelp}</small>
          </div>

          {view === "manager" ? (
            <ManagerOverview insights={insights} language={languageKey} actions={actions} />
          ) : (
            <DetailedAnalysis insights={insights} language={languageKey} sections={detailSections} onToggle={toggleDetail} />
          )}
        </>}
      </div>

      {!loading && insights.selectedBookings.length > 0 ? (
        <PrintReport insights={insights} language={languageKey} period={selectedRange} actions={actions} generatedAt={generatedAt} full={printMode === "full"} />
      ) : null}
    </section>
  );
}

function ManagerOverview({ insights, language, actions }: { insights: BookingInsightsResult; language: "en" | "th"; actions: string[] }) {
  const copy = copyByLanguage[language];
  const topVehicle = insights.vehicleDemand[0];
  const peakPickup = insights.pickupTimeDemand[0];
  return <div className="grid gap-3">
    <section className="booking-insights-section is-purple">
      <SectionHeading icon={BarChart3} title={copy.businessOverview} />
      <div className="booking-insights-overview-grid">
        <OverviewMetric label={copy.plannedBookings} value={insights.summary.totalBookings.toLocaleString()} helper={copy.plannedHelper(insights.summary.totalBookings)} />
        <OverviewMetric label={copy.periodChange} value={comparisonText(insights, language)} helper={insights.previousPeriod ? rangeText(insights.previousPeriod.startDate, insights.previousPeriod.endDate, language, "") : copy.comparisonUnavailable} tone={(insights.summary.bookingChangePercent ?? 0) >= 0 ? "green" : "amber"} />
        <OverviewMetric label={copy.repeatWork} value={percentText(insights.summary.repeatRoutePercent)} helper={copy.repeatHelper(insights.summary.repeatRoutePercent)} />
        <OverviewMetric label={copy.busiestDay} value={weekdayLabel(insights.summary.busiestWeekday, language)} helper={copy.busiestDayHelper(weekdayLabel(insights.summary.busiestWeekday, language), insights.summary.busiestWeekdayAverage ?? 0)} />
        <OverviewMetric label={copy.requestedVehicle} value={vehicleLabel(insights.summary.mostRequestedVehicleType, language)} helper={copy.vehicleHelper(vehicleLabel(insights.summary.mostRequestedVehicleType, language), topVehicle?.percent ?? 0)} />
        <OverviewMetric label={copy.peakPickup} value={peakPickup?.label ?? copy.unavailable} helper={peakPickup ? copy.pickupHelper(peakPickup.label, peakPickup.percent) : copy.pickupSample(0)} />
      </div>
    </section>

    <UpcomingSection insights={insights} language={language} />

    <section className="booking-insights-section is-green">
      <SectionHeading icon={AlertCircle} title={copy.whatToDo} />
      {actions.length ? <ol className="booking-insights-decision-list">{actions.map((action) => <li key={action}>{action}</li>)}</ol> : <p className="booking-insights-empty-copy">{copy.noOperationalAction}</p>}
    </section>

    <div className="booking-insights-manager-columns">
      <CustomerSection insights={insights} language={language} />
      <ManagerRoutes insights={insights} language={language} />
    </div>

    <OperationalPatterns insights={insights} language={language} />
    <ImproveInformation insights={insights} language={language} />
  </div>;
}

function UpcomingSection({ insights, language }: { insights: BookingInsightsResult; language: "en" | "th" }) {
  const copy = copyByLanguage[language];
  const upcoming = insights.upcomingWorkload;
  return <section className="booking-insights-section is-green">
    <SectionHeading icon={CalendarDays} title={copy.upcoming} helper={copy.upcomingHelp} />
    {upcoming.next14Bookings === 0 ? <p className="booking-insights-empty-copy">{copy.noUpcoming}</p> : <>
      <div className="booking-insights-upcoming-metrics">
        <MiniMetric label={copy.next7} value={upcoming.next7Bookings.toLocaleString()} />
        <MiniMetric label={copy.next14} value={upcoming.next14Bookings.toLocaleString()} />
        <MiniMetric label={copy.busiestUpcoming} value={upcoming.busiestDate ? `${formatDate(upcoming.busiestDate, language)} (${upcoming.busiestDateBookings})` : copy.unavailable} />
        <MiniMetric label={copy.withoutDriver} value={upcoming.missingDriverBookings.toLocaleString()} tone={upcoming.missingDriverBookings ? "amber" : "green"} />
        <MiniMetric label={copy.withoutPickupTime} value={upcoming.missingPickupTimeBookings.toLocaleString()} tone={upcoming.missingPickupTimeBookings ? "amber" : "green"} />
      </div>
      <div className="booking-insights-upcoming-columns">
        <div><h4>{copy.vehiclesRequired}</h4><CompactBars rows={upcoming.vehicleDemand.slice(0, 5).map((item) => ({ label: vehicleLabel(item.type, language), count: item.count, percent: item.percent }))} /></div>
        <div><h4>{copy.upcomingRoutes}</h4><ul className="booking-insights-compact-list">{upcoming.topRoutes.slice(0, 5).map((route) => <li key={route.routeKey}><RouteName route={route.friendlyName} /><strong>{route.bookings}</strong></li>)}</ul></div>
        <div><h4>{copy.upcomingClients}</h4><ul className="booking-insights-compact-list">{upcoming.topClients.map((client) => <li key={client.key}><span className="truncate" title={client.name}>{client.name}</span><strong>{client.next14Bookings}</strong></li>)}</ul></div>
      </div>
    </>}
  </section>;
}

function CustomerSection({ insights, language }: { insights: BookingInsightsResult; language: "en" | "th" }) {
  const copy = copyByLanguage[language];
  const coverage = insights.clientCoverage.createdSinceLaunch;
  const recommendations = [
    ...insights.increasingCustomers.slice(0, 1).map((client) => language === "th"
      ? `${client.name}: งานเพิ่ม ${client.bookingDifference ?? 0} งาน ควรยืนยันกำลังรถสำหรับรอบถัดไป`
      : `${client.name}: up ${client.bookingDifference ?? 0} bookings; confirm vehicle capacity for the next cycle.`),
    ...insights.newlyActiveCustomers.slice(0, 1).map((client) => language === "th"
      ? `${client.name}: เริ่มมี ${client.bookings} งาน ควรติดตามโอกาสงานต่อเนื่อง`
      : `${client.name}: ${client.bookings} new bookings; follow up on repeat-work potential.`),
    ...insights.regularCustomersWithoutRecentActivity.slice(0, 1).map((client) => language === "th"
      ? `${client.name}: งานล่าสุด ${formatDate(client.latestBookingDate, language)} ควรตรวจสอบแผนงานรอบใหม่`
      : `${client.name}: last booked ${formatDate(client.latestBookingDate, language)}; check the next work plan.`)
  ].slice(0, 3);
  return <section className="booking-insights-section">
    <SectionHeading icon={Users} title={copy.customerActivity} helper={copy.customerHelp} />
    {!insights.customerDataAvailable ? <p className="booking-insights-empty-copy">{copy.noCustomerData}</p> : <>
      <div className="booking-insights-upcoming-metrics mb-3">
        <MiniMetric label={copy.clientCoverage} value={percentText(coverage.percent)} tone={coverage.percent !== null && coverage.percent >= 80 ? "green" : "amber"} />
        <MiniMetric label={copy.topUpcomingClient} value={insights.summary.topUpcomingClient ?? copy.unavailable} />
        <MiniMetric label={copy.topSixWheelClient} value={insights.summary.topSixWheelClient ?? copy.unavailable} />
        <MiniMetric label={copy.share} value={percentText(insights.summary.topFiveClientSharePercent)} />
      </div>
      <p className="booking-insights-helper mb-3">{copy.topFiveClientCoverage(insights.summary.topFiveClientSharePercent)} {copy.captureSinceLaunch}: {coverage.captured}/{coverage.total}.</p>
      <div className="table-scroll"><table className="booking-insights-manager-table"><thead><tr><th>{copy.customer}</th><th>{copy.bookings}</th><th>{copy.share}</th><th>{copy.commonRoute}</th><th>{copy.vehicle}</th><th>{copy.recentBooking}</th><th>{copy.change}</th></tr></thead><tbody>
        {insights.customerActivity.slice(0, 5).map((customer) => <tr key={customer.key}><td><strong>{customer.name}</strong></td><td>{customer.bookings}</td><td>{percentText(customer.sharePercent)}</td><td><RouteName route={customer.mostCommonRoute ?? copy.unavailable} /></td><td>{vehicleLabel(customer.mostRequestedVehicleType, language)}</td><td>{formatDate(customer.latestBookingDate, language)}</td><td>{customer.changePercent === null ? "-" : `${customer.changePercent > 0 ? "+" : ""}${customer.changePercent}%`}</td></tr>)}
      </tbody></table></div>
      <div className="booking-insights-customer-signals">
        <span>{copy.newlyActive}: <strong>{insights.newlyActiveCustomers.length}</strong></span>
        <span>{copy.increasing}: <strong>{insights.increasingCustomers.length}</strong></span>
        <span>{copy.reduced}: <strong>{insights.reducedCustomers.length}</strong></span>
        <span>{copy.noRecentActivity}: <strong>{insights.regularCustomersWithoutRecentActivity.length}</strong></span>
      </div>
      {recommendations.length ? <div className="mt-3"><h4 className="booking-insights-subheading">{copy.clientRecommendations}</h4><ol className="booking-insights-decision-list mt-2">{recommendations.map((recommendation) => <li key={recommendation}>{recommendation}</li>)}</ol></div> : null}
    </>}
  </section>;
}

function ManagerRoutes({ insights, language }: { insights: BookingInsightsResult; language: "en" | "th" }) {
  const copy = copyByLanguage[language];
  return <section className="booking-insights-section">
    <SectionHeading icon={Route} title={copy.routes} helper={copy.topFiveCoverage(insights.summary.topFiveRouteSharePercent)} />
    <div className="table-scroll"><table className="booking-insights-manager-table"><thead><tr><th>{copy.routes}</th><th>{copy.bookings}</th><th>{copy.activeDates}</th><th>{copy.vehicle}</th><th>{copy.latest}</th></tr></thead><tbody>
      {insights.commonRoutes.slice(0, 5).map((route) => <tr key={route.routeKey}><td><RouteName route={route.friendlyName} /></td><td>{route.bookings}</td><td>{route.activeBookingDates}</td><td>{vehicleLabel(route.mostRequestedVehicleType, language)}</td><td>{formatDate(route.latestBookingDate, language)}</td></tr>)}
    </tbody></table></div>
    <h4 className="booking-insights-subheading">{copy.opportunity}</h4>
    <p className="booking-insights-helper">{copy.opportunityHelp}</p>
    <div className="booking-insights-opportunity-cards">{insights.newRecurringRouteOpportunities.slice(0, 3).map((route) => <article key={route.routeKey}>
      <span className={clsx("booking-insights-status", route.status === "strong_pattern" ? "is-green" : "is-amber")}>{opportunityLabel(route.status, language)}</span>
      <RouteName route={route.friendlyName} />
      <small>{route.bookings} {copy.bookings} · {route.activeBookingDates} {copy.activeDates.toLocaleLowerCase()} · {formatDate(route.latestBookingDate, language)}</small>
    </article>)}</div>
  </section>;
}

function OperationalPatterns({ insights, language }: { insights: BookingInsightsResult; language: "en" | "th" }) {
  const copy = copyByLanguage[language];
  const weeklyMax = Math.max(1, ...insights.weeklyWorkload.map((week) => week.bookings));
  return <section className="booking-insights-section is-slate">
    <SectionHeading icon={Clock3} title={copy.operationalPatterns} />
    <div className="booking-insights-pattern-grid">
      <div className="booking-insights-chart-block"><h4>{copy.weeklyTrend}</h4><div className="mt-3 grid gap-2">{insights.weeklyWorkload.map((week) => <div key={week.weekStartDate} className="booking-insights-bar-row"><span title={`${formatDate(week.weekStartDate, language)} - ${formatDate(week.weekEndDate, language)}`}>{formatDate(week.weekStartDate, language)}</span><div className="booking-insights-bar-track"><div style={{ width: `${week.bookings ? Math.max(4, week.bookings / weeklyMax * 100) : 0}%` }} /></div><strong>{week.bookings}</strong></div>)}</div><p className="booking-insights-helper mt-2">{copy.highestWeek}: {insights.highestVolumeWeek ? `${formatDate(insights.highestVolumeWeek.weekStartDate, language)} (${insights.highestVolumeWeek.bookings})` : copy.unavailable}</p></div>
      <div className="booking-insights-chart-block"><h4>{copy.weekdayDemand}</h4><div className="mt-3 grid gap-2">{insights.weekdayDemand.slice(0, 7).map((day) => <div key={day.label} className="booking-insights-pattern-row"><span>{weekdayLabel(day.label, language)}</span><strong>{day.count}</strong><small>{day.averagePerOccurrence} {copy.weekdayAverage.toLocaleLowerCase()}</small></div>)}</div></div>
      <ChartBlock title={copy.pickupDemand} helper={copy.pickupSample(insights.validPickupTimeBookings)} rows={insights.pickupTimeDemand} />
      <ChartBlock title={copy.vehicleDemand} rows={insights.vehicleDemand.slice(0, 5).map((item) => ({ label: vehicleLabel(item.type, language), count: item.count, percent: item.percent }))} />
    </div>
  </section>;
}

function ImproveInformation({ insights, language }: { insights: BookingInsightsResult; language: "en" | "th" }) {
  const copy = copyByLanguage[language];
  const total = insights.summary.totalBookings;
  const unclassified = insights.unclassifiedVehicleValues.reduce((sum, item) => sum + item.count, 0);
  const google = metricFor(insights, "google");
  const distance = metricFor(insights, "distance");
  const mapsMissing = Math.max((google?.total ?? total) - (google?.count ?? 0), (distance?.total ?? total) - (distance?.count ?? 0));
  const issue = (title: string, why: string, count: number) => <article><Info className="h-4 w-4" /><div><strong>{title}</strong><p>{count.toLocaleString()} ({total ? Math.round(count / total * 1000) / 10 : 0}%) {copy.affected}</p><small>{why}</small></div></article>;
  return <section className="booking-insights-section is-amber">
    <SectionHeading icon={Info} title={copy.improveInfo} helper={copy.improveInfoHelp} />
    <div className="booking-insights-quality-grid">
      {issue(copy.missingPickup, copy.missingPickupWhy, insights.missingPickupTimeBookings)}
      {issue(copy.unclassifiedVehicles, copy.unclassifiedWhy, unclassified)}
      {issue(copy.missingMaps, copy.missingMapsWhy, mapsMissing)}
    </div>
    <div className="booking-insights-trip-setup"><Truck className="h-5 w-5" /><div><strong>{copy.tripSetup}</strong><p>{copy.tripStatus(insights.tripCoverage.linkedEligibleBookings, insights.tripCoverage.eligibleBookings)} · {copy.linkingStarted}: {formatDate(insights.tripCoverage.workflowStartDate, language)}</p><small>{copy.notFailure}</small></div></div>
  </section>;
}

function DetailedAnalysis({ insights, language, sections, onToggle }: {
  insights: BookingInsightsResult;
  language: "en" | "th";
  sections: Record<DetailSection, boolean>;
  onToggle: (key: DetailSection) => void;
}) {
  const copy = copyByLanguage[language];
  return <div className="grid gap-3">
    <div className="booking-insights-detail-intro"><BarChart3 className="h-5 w-5" /><div><strong>{copy.detailView}</strong><p>{copy.detailIntro}</p></div></div>
    <DetailAccordion title={copy.clientDetails} open={sections.clients} onToggle={() => onToggle("clients")}><ClientDetailsTable insights={insights} language={language} /></DetailAccordion>
    <DetailAccordion title={copy.routes} open={sections.routes} onToggle={() => onToggle("routes")}><FullRoutesTable insights={insights} language={language} /></DetailAccordion>
    <DetailAccordion title={copy.opportunity} open={sections.opportunities} onToggle={() => onToggle("opportunities")}><OpportunitiesTable insights={insights} language={language} /></DetailAccordion>
    <DetailAccordion title={copy.readiness} open={sections.readiness} onToggle={() => onToggle("readiness")}><ReadinessSection insights={insights} language={language} /></DetailAccordion>
    <DetailAccordion title={copy.methodology} open={sections.methodology} onToggle={() => onToggle("methodology")}><MethodologySection language={language} /></DetailAccordion>
  </div>;
}

function ClientDetailsTable({ insights, language }: { insights: BookingInsightsResult; language: "en" | "th" }) {
  const copy = copyByLanguage[language];
  const [sort, setSort] = useState<"bookings" | "latest" | "name">("bookings");
  const [showAll, setShowAll] = useState(false);
  const rows = [...insights.customerActivity].sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "latest") return b.latestBookingDate.localeCompare(a.latestBookingDate);
    return b.bookings - a.bookings || a.name.localeCompare(b.name);
  });
  const header = (label: string, key: typeof sort) => <button type="button" className="font-semibold" onClick={() => setSort(key)}>{label}{sort === key ? " ↓" : ""}</button>;
  return <div className="booking-insights-accordion-body">
    <div className="table-scroll"><table className="booking-insights-manager-table"><thead><tr>
      <th>{header(copy.customer, "name")}</th><th>{header(copy.bookings, "bookings")}</th><th>{copy.share}</th><th>{copy.activeDatesClient}</th><th>{copy.commonRoute}</th><th>{copy.vehicle}</th><th>{copy.commonWeekday}</th><th>{copy.peakTime}</th><th>{copy.firstBooking}</th><th>{header(copy.recentBooking, "latest")}</th><th>{copy.change}</th>
    </tr></thead><tbody>{rows.slice(0, showAll ? rows.length : 5).map((client) => <tr key={client.key}>
      <td><strong>{client.name}</strong></td><td>{client.bookings}</td><td>{percentText(client.sharePercent)}</td><td>{client.activeBookingDates}</td><td><RouteName route={client.mostCommonRoute ?? copy.unavailable} /></td><td>{vehicleLabel(client.mostRequestedVehicleType, language)}</td><td>{weekdayLabel(client.mostCommonWeekday, language)}</td><td>{client.peakPickupTimeBand ?? "-"}</td><td>{formatDate(client.firstBookingDate, language)}</td><td>{formatDate(client.latestBookingDate, language)}</td><td>{client.changePercent === null ? "-" : `${client.changePercent > 0 ? "+" : ""}${client.changePercent}%`}</td>
    </tr>)}</tbody></table></div>
    {rows.length > 5 ? <button type="button" className="btn-secondary mt-3 min-h-[38px] rounded-[0.75rem] px-3 text-xs" onClick={() => setShowAll((value) => !value)}>{showAll ? copy.showLess : copy.showAll}</button> : null}
  </div>;
}

function DetailAccordion({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return <section className="booking-insights-accordion surface-card-soft"><button type="button" className="booking-insights-accordion-trigger" onClick={onToggle} aria-expanded={open}><span>{title}</span><ChevronDown className={clsx("h-5 w-5 transition-transform", open && "rotate-180")} /></button>{open ? <div className="booking-insights-accordion-content">{children}</div> : null}</section>;
}

function FullRoutesTable({ insights, language }: { insights: BookingInsightsResult; language: "en" | "th" }) {
  const copy = copyByLanguage[language];
  const hasUsefulDistance = (metricFor(insights, "distance")?.percent ?? 0) >= 40;
  return <div className="booking-insights-accordion-body"><p className="booking-insights-helper mb-3">{copy.routesHelp}</p><div className="table-scroll"><table className="booking-insights-route-table"><thead><tr><th>{copy.routes}</th><th>{copy.bookings}</th><th>{copy.share}</th><th>{copy.activeDates}</th><th>{copy.averageGap}</th><th>{copy.latest}</th><th>{copy.vehicle}</th>{hasUsefulDistance ? <th>{copy.distance}</th> : null}</tr></thead><tbody>
    {insights.commonRoutes.map((route) => <tr key={route.routeKey}><td><RouteName route={route.friendlyName} /></td><td>{route.bookings}</td><td>{percentText(route.sharePercent)}</td><td>{route.activeBookingDates}</td><td>{route.averageGapDays === null ? "-" : `${route.averageGapDays} ${copy.days}`}</td><td>{formatDate(route.latestBookingDate, language)}</td><td>{vehicleLabel(route.mostRequestedVehicleType, language)}</td>{hasUsefulDistance ? <td>{route.averageDistanceKm === null ? copy.unavailable : `${route.averageDistanceKm} km (${copy.basedOn(route.distanceRecordCount)})`}</td> : null}</tr>)}
  </tbody></table></div></div>;
}

function OpportunitiesTable({ insights, language }: { insights: BookingInsightsResult; language: "en" | "th" }) {
  const copy = copyByLanguage[language];
  return <div className="booking-insights-accordion-body"><div className="table-scroll"><table className="booking-insights-opportunity-table"><thead><tr><th>{copy.routes}</th><th>{copy.status}</th><th>{copy.bookings}</th><th>{copy.activeDates}</th><th>{copy.firstRecorded}</th><th>{copy.latest}</th><th>{copy.vehicle}</th></tr></thead><tbody>
    {insights.newRecurringRouteOpportunities.map((route) => <tr key={route.routeKey}><td><RouteName route={route.friendlyName} /></td><td><span className={clsx("booking-insights-status", route.status === "strong_pattern" ? "is-green" : "is-amber")}>{opportunityLabel(route.status, language)}</span></td><td>{route.bookings}</td><td>{route.activeBookingDates}</td><td>{formatDate(route.firstRecordedDate, language)}</td><td>{formatDate(route.latestBookingDate, language)}</td><td>{vehicleLabel(route.mostRequestedVehicleType, language)}</td></tr>)}
  </tbody></table></div><details className="booking-insights-one-off mt-4"><summary>{copy.oneOffs} ({insights.oneOffNewRoutes.length})</summary><ul>{insights.oneOffNewRoutes.slice(0, 30).map((route) => <li key={route.routeKey}><RouteName route={route.friendlyName} /> · {formatDate(route.firstRecordedDate, language)}</li>)}</ul></details></div>;
}

function ReadinessSection({ insights, language }: { insights: BookingInsightsResult; language: "en" | "th" }) {
  const copy = copyByLanguage[language];
  return <div className="booking-insights-accordion-body"><div className="booking-insights-readiness-grid">{insights.readinessCohorts.map((cohort) => <article key={cohort.key} className="booking-insights-readiness-cohort"><h4>{cohort.key === "overall" ? copy.overall : cohort.key === "recent" ? copy.recent : copy.historical}</h4><p>{cohort.bookingCount} {copy.records}</p><div className="mt-3 grid gap-3">{cohort.metrics.map((metric) => <ReadinessRow key={metric.key} metric={metric} language={language} />)}</div></article>)}</div><div className="booking-insights-trip-setup mt-4"><Truck className="h-5 w-5" /><div><strong>{copy.tripSetup}</strong><p>{copy.tripStatus(insights.tripCoverage.linkedEligibleBookings, insights.tripCoverage.eligibleBookings)} · {copy.linkingStarted}: {formatDate(insights.tripCoverage.workflowStartDate, language)}</p><small>{copy.notFailure}</small></div></div></div>;
}

function ReadinessRow({ metric, language }: { metric: BookingReadinessMetric; language: "en" | "th" }) {
  const copy = copyByLanguage[language];
  const tone = metric.percent !== null && metric.percent >= 80 ? "green" : "amber";
  return <div><div className="mb-1 flex items-start justify-between gap-3 text-xs"><span className="font-semibold text-slate-800">{copy.readinessLabels[metric.key]}</span><span className={`booking-insights-status is-${tone}`}>{metric.count}/{metric.total} {percentText(metric.percent)}</span></div><div className="booking-insights-readiness-track"><div className={`is-${tone}`} style={{ width: `${Math.max(0, Math.min(100, metric.percent ?? 0))}%` }} /></div></div>;
}

function MethodologySection({ language }: { language: "en" | "th" }) {
  const copy = copyByLanguage[language];
  return <aside className="booking-insights-note"><ul>{copy.methodologyItems.map((item) => <li key={item}>{item}</li>)}</ul></aside>;
}

function SectionHeading({ icon: Icon, title, helper }: { icon: typeof BarChart3; title: string; helper?: string }) {
  return <div className="booking-insights-section-heading"><div className="app-icon-tile h-9 w-9"><Icon className="h-4 w-4" /></div><div><h3>{title}</h3>{helper ? <p>{helper}</p> : null}</div></div>;
}

function OverviewMetric({ label, value, helper, tone = "purple" }: { label: string; value: string; helper: string; tone?: "purple" | "green" | "amber" }) {
  return <article className={`booking-insights-overview-metric is-${tone}`}><span>{label}</span><strong>{value}</strong><p>{helper}</p></article>;
}

function MiniMetric({ label, value, tone = "purple" }: { label: string; value: string; tone?: "purple" | "green" | "amber" }) {
  return <div className={`booking-insights-mini-metric is-${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function RouteName({ route }: { route: string }) {
  return <span className="booking-insights-route-name" title={route}>{route}</span>;
}

function CompactBars({ rows }: { rows: BookingCountShare[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return <div className="mt-3 grid gap-2">{rows.map((row) => <div key={row.label} className="booking-insights-bar-row"><span title={row.label}>{row.label}</span><div className="booking-insights-bar-track"><div style={{ width: `${row.count ? Math.max(4, row.count / max * 100) : 0}%` }} /></div><strong>{row.count}</strong></div>)}</div>;
}

function ChartBlock({ title, helper, rows }: { title: string; helper?: string; rows: BookingCountShare[] }) {
  return <div className="booking-insights-chart-block"><h4>{title}</h4>{helper ? <p className="booking-insights-helper mt-1">{helper}</p> : null}<CompactBars rows={rows} /></div>;
}

function PrintReport({ insights, language, period, actions, generatedAt, full }: {
  insights: BookingInsightsResult;
  language: "en" | "th";
  period: string;
  actions: string[];
  generatedAt: string;
  full: boolean;
}) {
  const copy = copyByLanguage[language];
  return <div className="booking-insights-print-report" aria-hidden="true">
    <section className="booking-insights-print-page">
      <PrintHeader title={copy.managerReport} period={period} latest={insights.latestAvailableDate ? formatDate(insights.latestAvailableDate, language) : copy.unavailable} generatedAt={generatedAt} language={language} />
      <div className="booking-insights-print-kpis">
        <MiniMetric label={copy.plannedBookings} value={insights.summary.totalBookings.toLocaleString()} />
        <MiniMetric label={copy.periodChange} value={comparisonText(insights, language)} />
        <MiniMetric label={copy.repeatWork} value={percentText(insights.summary.repeatRoutePercent)} />
        <MiniMetric label={copy.busiestDay} value={weekdayLabel(insights.summary.busiestWeekday, language)} />
        <MiniMetric label={copy.requestedVehicle} value={vehicleLabel(insights.summary.mostRequestedVehicleType, language)} />
        <MiniMetric label={copy.peakPickup} value={insights.summary.peakPickupTimeBand ?? copy.unavailable} />
      </div>
      <div className="booking-insights-print-columns booking-insights-print-columns-three">
        <section><h3>{copy.upcoming}</h3>{insights.upcomingWorkload.next14Bookings ? <ul><li>{copy.next7}: {insights.upcomingWorkload.next7Bookings}</li><li>{copy.next14}: {insights.upcomingWorkload.next14Bookings}</li><li>{copy.withoutDriver}: {insights.upcomingWorkload.missingDriverBookings}</li><li>{copy.withoutPickupTime}: {insights.upcomingWorkload.missingPickupTimeBookings}</li></ul> : <p>{copy.noUpcoming}</p>}</section>
        <section><h3>{copy.whatToDo}</h3><ol>{actions.map((action) => <li key={action}>{action}</li>)}</ol></section>
        <section><h3>{copy.improveInfo}</h3><p>{copy.missingPickup}: {insights.missingPickupTimeBookings}</p><p>{copy.unclassifiedVehicles}: {insights.unclassifiedVehicleValues.reduce((sum, item) => sum + item.count, 0)}</p><p>{copy.tripStatus(insights.tripCoverage.linkedEligibleBookings, insights.tripCoverage.eligibleBookings)}</p></section>
      </div>
      <div className="booking-insights-print-columns">
        <section><h3>{copy.customerActivity}</h3>{insights.customerDataAvailable ? <ol>{insights.customerActivity.slice(0, 5).map((customer) => <li key={customer.key}>{customer.name}: {customer.bookings} ({percentText(customer.sharePercent)})</li>)}</ol> : <p>{copy.noCustomerData}</p>}</section>
        <section><h3>{copy.opportunity}</h3><ol>{insights.newRecurringRouteOpportunities.slice(0, 3).map((route) => <li key={route.routeKey}>{route.friendlyName} · {opportunityLabel(route.status, language)} · {route.bookings}</li>)}</ol></section>
      </div>
      <section><h3>{copy.routes}</h3><table><thead><tr><th>{copy.routes}</th><th>{copy.bookings}</th><th>{copy.activeDates}</th><th>{copy.vehicle}</th><th>{copy.latest}</th></tr></thead><tbody>{insights.commonRoutes.slice(0, 5).map((route) => <tr key={route.routeKey}><td>{route.friendlyName}</td><td>{route.bookings}</td><td>{route.activeBookingDates}</td><td>{vehicleLabel(route.mostRequestedVehicleType, language)}</td><td>{formatDate(route.latestBookingDate, language)}</td></tr>)}</tbody></table></section>
      <footer>{copy.methodologyItems[0]}</footer>
    </section>
    {full ? <section className="booking-insights-print-page booking-insights-print-full-page">
      <PrintHeader title={copy.fullReport} period={period} latest={insights.latestAvailableDate ? formatDate(insights.latestAvailableDate, language) : copy.unavailable} generatedAt={generatedAt} language={language} />
      <section><h3>{copy.operationalPatterns}</h3><table><thead><tr><th>{copy.weeklyTrend}</th><th>{copy.weeklyTotal}</th><th>{copy.activeDayAverage}</th><th>{copy.previousWeek}</th></tr></thead><tbody>{insights.weeklyWorkload.map((week) => <tr key={week.weekStartDate}><td>{formatDate(week.weekStartDate, language)} - {formatDate(week.weekEndDate, language)}</td><td>{week.bookings}</td><td>{week.averagePerActiveDay}</td><td>{percentText(week.changePercent)}</td></tr>)}</tbody></table></section>
      <section><h3>{copy.opportunity}</h3><table><thead><tr><th>{copy.routes}</th><th>{copy.status}</th><th>{copy.bookings}</th><th>{copy.activeDates}</th><th>{copy.latest}</th></tr></thead><tbody>{insights.newRecurringRouteOpportunities.map((route) => <tr key={route.routeKey}><td>{route.friendlyName}</td><td>{opportunityLabel(route.status, language)}</td><td>{route.bookings}</td><td>{route.activeBookingDates}</td><td>{formatDate(route.latestBookingDate, language)}</td></tr>)}</tbody></table></section>
      <section className="booking-insights-print-methodology"><h3>{copy.methodology}</h3><ul>{copy.methodologyItems.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <footer>{copy.notFailure}</footer>
    </section> : null}
  </div>;
}

function PrintHeader({ title, period, latest, generatedAt, language }: { title: string; period: string; latest: string; generatedAt: string; language: "en" | "th" }) {
  const copy = copyByLanguage[language];
  return <header className="booking-insights-print-header"><Image src="/logo.png" alt="Expert Express Sender Co., Ltd." width={48} height={48} priority /><div><p>Expert Express Sender Co., Ltd. · Booking Diary</p><h1>{title}</h1><span>{copy.selectedPeriod}: {period} · {copy.latestRecord}: {latest} · {copy.generated}: {generatedAt}</span></div></header>;
}

"use client";

import { Bell, MapPin, RefreshCw, Truck, BellRing } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/lib/language-provider";
import { supabase } from "@/lib/supabase";
import { useAccountAccess } from "@/lib/use-account-access";
import { reviewEesLocationReadiness, type DirectoryLocationForReview, type ConfirmedDestinationPin, type LocationReviewItem } from "@/lib/fleet-location-readiness";
import { ForthLocationsBulkPanel, type ForthImportItem, type ForthImportSummary } from "@/components/forth-locations-bulk-panel";

type Visit = { event_key: string; visit_key: string; vehicle_key: string; event_type: "arrival" | "departure";
  vehicle_registration: string | null; location_id: string; occurred_at: string; duration_seconds: number | null;
  review_status: string; booking_id: string | null; booking_match_status: string };
type AtLocation = { vehicle_key: string; phase: string; location_id: string; arrival_at: string;
  last_source_at: string | null; uncertain_reason: string | null };
type Run = { started_at: string; finished_at: string | null; status: string; returned_count: number | null; processed_count: number | null; error_code: string | null };
type Notice = { id: string; category: string; severity: string; title_en: string; title_th: string;
  body_en: string; body_th: string; href: string; created_at: string; read_at: string | null; acknowledged_at: string | null };
type PushAttempt = { id: number; attempted_at: string; status: string; http_status: number | null; error_code: string | null };
type Preferences = Record<"arrivals" | "departures" | "extended_visits" | "tracker_incidents" | "gps_incidents" | "speed_alerts", boolean>;
type BookingProposal = { status: "no_match" | "review_candidate" | "ambiguous";
  candidates: { bookingId: string; side: "pickup" | "dropoff"; distanceMeters: number }[] };
type Zone = { location_id: string; radius_meters: number; entry_dwell_seconds: number;
  exit_dwell_seconds: number; hysteresis_meters: number; active: boolean; updated_at: string };
type ZoneHistory = { id: number; location_id: string; reason: string; changed_at: string; actor_user_id: string };
type PilotReadiness = {
  environmentLabel: string; blockers: string[]; eligiblePilotGeofences: number; pilotReady: boolean;
  items: { key: string; labelEn: string; labelTh: string; count: number | null; ready: boolean; blocker: string | null }[];
  activationChecklist: { step: number; en: string; th: string; done: boolean }[];
};
const categories: { key: keyof Preferences; en: string; th: string }[] = [
  { key: "arrivals", en: "Arrivals", th: "รถถึงสถานที่" },
  { key: "departures", en: "Departures", th: "รถออกจากสถานที่" },
  { key: "extended_visits", en: "Extended visits", th: "จอดนาน" },
  { key: "tracker_incidents", en: "Tracker incidents", th: "ปัญหาเครื่องติดตาม" },
  { key: "gps_incidents", en: "GPS incidents", th: "ปัญหา GPS" },
  { key: "speed_alerts", en: "Verified speed alerts", th: "แจ้งเตือนความเร็วที่ยืนยัน" }
];
const initialPrefs = Object.fromEntries(categories.map(({ key }) => [key, false])) as Preferences;

function formatTime(value: string | null, language: "en" | "th") {
  if (!value) return "—";
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short"
  }).format(ms) : "—";
}

function publicKeyBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export function FleetOperationsPage() {
  const { language } = useLanguage();
  const { can } = useAccountAccess();
  const th = language === "th";
  const [events, setEvents] = useState<Visit[]>([]);
  const [atLocations, setAtLocations] = useState<AtLocation[]>([]);
  const [uncertainVisits, setUncertainVisits] = useState<AtLocation[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [lastRun, setLastRun] = useState<Run | null>(null);
  const [bookingProposals, setBookingProposals] = useState<Record<string, BookingProposal>>({});
  const [bookingReviewIncomplete, setBookingReviewIncomplete] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>(initialPrefs);
  const [quietStart, setQuietStart] = useState("");
  const [quietEnd, setQuietEnd] = useState("");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [deviceCount, setDeviceCount] = useState(0);
  const [currentSubscriptionId, setCurrentSubscriptionId] = useState<string | null>(null);
  const [serverTestEnabled, setServerTestEnabled] = useState(false);
  const [pushAttempts, setPushAttempts] = useState<PushAttempt[]>([]);
  const [locationReviews, setLocationReviews] = useState<LocationReviewItem[]>([]);
  const [readyLocations, setReadyLocations] = useState<DirectoryLocationForReview[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [zoneHistory, setZoneHistory] = useState<ZoneHistory[]>([]);
  const [zoneLocationId, setZoneLocationId] = useState("");
  const [zoneRadius, setZoneRadius] = useState(150);
  const [zoneEntry, setZoneEntry] = useState(60);
  const [zoneExit, setZoneExit] = useState(60);
  const [zoneHysteresis, setZoneHysteresis] = useState(25);
  const [zoneActive, setZoneActive] = useState(false);
  const [zoneReason, setZoneReason] = useState("");
  const [locationSearch, setLocationSearch] = useState("");
  const [pinStorageReady, setPinStorageReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [storagePending, setStoragePending] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [forthSummary, setForthSummary] = useState<ForthImportSummary | null>(null);
  const [forthItems, setForthItems] = useState<ForthImportItem[]>([]);
  const [forthGroups, setForthGroups] = useState<string[]>([]);
  const [forthFilter, setForthFilter] = useState("NEW_LOCATION");
  const [forthGroup, setForthGroup] = useState("");
  const [forthCategory, setForthCategory] = useState("");
  const [forthConfidence, setForthConfidence] = useState("");
  const [forthSearch, setForthSearch] = useState("");
  const [forthPage, setForthPage] = useState(1);
  const [inboxFilter, setInboxFilter] = useState<"all" | "unread" | "test">("all");
  const [forthTotalFiltered, setForthTotalFiltered] = useState(0);
  const [forthDiameterNote, setForthDiameterNote] = useState("");
  const [pilotReadiness, setPilotReadiness] = useState<PilotReadiness | null>(null);
  const [reviewReason, setReviewReason] = useState("");

  const request = useCallback(async (path: string, init?: RequestInit, token?: string) => {
    const accessToken = token ?? (await supabase.auth.getSession()).data.session?.access_token;
    if (!accessToken) throw new Error(th ? "กรุณาเข้าสู่ระบบอีกครั้ง" : "Sign in again to continue.");
    const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`, ...init?.headers }, cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(response.status === 503 ? "storage_pending" : payload.error || "Request failed.");
    return payload;
  }, [th]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error(th ? "กรุณาเข้าสู่ระบบอีกครั้ง" : "Sign in again to continue.");
      const forthQuery = new URLSearchParams({ classification: forthFilter, limit: "50", page: String(forthPage) });
      if (forthGroup) forthQuery.set("group", forthGroup);
      if (forthCategory) forthQuery.set("category", forthCategory);
      if (forthConfidence) forthQuery.set("confidence", forthConfidence);
      if (forthSearch.trim()) forthQuery.set("q", forthSearch.trim());
      const [eventResult, inboxResult, prefResult, deviceResult, locationResult, pinResult, pushTestResult, zoneResult, forthResult, pilotResult] = await Promise.allSettled([
        request("/api/fleet-operations/events", undefined, session.access_token), request("/api/fleet-operations/inbox", undefined, session.access_token),
        request("/api/fleet-operations/preferences", undefined, session.access_token), request("/api/fleet-operations/subscriptions", undefined, session.access_token),
        request("/api/locations", undefined, session.access_token), request("/api/locations/map-pins", undefined, session.access_token),
        request("/api/fleet-operations/test-push", undefined, session.access_token), request("/api/fleet-operations/zones", undefined, session.access_token),
        request(`/api/fleet-operations/forth-import?${forthQuery}`, undefined, session.access_token),
        request("/api/fleet-operations/pilot-readiness", undefined, session.access_token)
      ]);
      const results = [eventResult, inboxResult, prefResult, deviceResult, locationResult, pinResult, pushTestResult, zoneResult];
      setStoragePending(results.some((result) => result.status === "rejected" && result.reason instanceof Error && result.reason.message === "storage_pending"));
      const otherError = [...results, forthResult, pilotResult].find((result) => result.status === "rejected" && !(result.reason instanceof Error && result.reason.message === "storage_pending"));
      setMessage(otherError?.status === "rejected" ? String(otherError.reason) : "");
      if (eventResult.status === "fulfilled") {
        const eventData = eventResult.value;
        setEvents(eventData.events ?? []);
        setAtLocations(eventData.atLocations ?? []);
        setUncertainVisits(eventData.uncertainVisits ?? []);
        setLastRun(eventData.lastRun ?? null);
        setBookingProposals(eventData.bookingProposals ?? {});
        setBookingReviewIncomplete(Boolean(eventData.bookingReviewIncomplete));
      }
      if (inboxResult.status === "fulfilled") setNotices(inboxResult.value.notifications ?? []);
      if (pushTestResult.status === "fulfilled") setPushAttempts(pushTestResult.value.attempts ?? []);
      if (zoneResult.status === "fulfilled") {
        setZones(zoneResult.value.zones ?? []);
        setZoneHistory(zoneResult.value.history ?? []);
      }
      if (prefResult.status === "fulfilled") {
        setPreferences({ ...initialPrefs, ...prefResult.value.preferences });
        setQuietStart(prefResult.value.preferences?.quiet_start?.slice(0, 5) ?? "");
        setQuietEnd(prefResult.value.preferences?.quiet_end?.slice(0, 5) ?? "");
      }
      if (deviceResult.status === "fulfilled") {
        setPublicKey(deviceResult.value.vapidPublicKey ?? null);
        setDeviceCount(deviceResult.value.activeDevices ?? 0);
        setServerTestEnabled(Boolean(deviceResult.value.serverTestEnabled));
      }
      if (forthResult.status === "fulfilled") {
        setForthSummary(forthResult.value.summary ?? null);
        setForthItems(forthResult.value.items ?? []);
        setForthGroups(forthResult.value.groups ?? []);
        setForthTotalFiltered(forthResult.value.totalFiltered ?? 0);
        setForthDiameterNote(forthResult.value.diameterNote ?? "");
      }
      if (pilotResult.status === "fulfilled") setPilotReadiness(pilotResult.value);
      if (locationResult.status === "fulfilled") {
        const locations = (locationResult.value.locations ?? []) as DirectoryLocationForReview[];
        setNames(Object.fromEntries(locations.map((location) =>
          [location.id, th ? location.thai_name || location.company_name : location.company_name])));
        if (pinResult.status === "fulfilled") {
          setPinStorageReady(pinResult.value.storageReady !== false);
          if (pinResult.value.storageReady !== false) setLocationReviews(reviewEesLocationReadiness(locations,
            (pinResult.value.pins ?? []) as ConfirmedDestinationPin[]));
          if (pinResult.value.storageReady !== false) {
            const confirmed = new Set(((pinResult.value.pins ?? []) as ConfirmedDestinationPin[])
              .filter((pin) => pin.pin_type === "destination" && pin.pin_status === "manual_confirmed" &&
                Number.isFinite(pin.latitude) && Math.abs(pin.latitude) <= 90 && Number.isFinite(pin.longitude) && Math.abs(pin.longitude) <= 180)
              .map((pin) => pin.location_id));
            setReadyLocations(locations.filter((location) => location.verification_status === "verified" && confirmed.has(location.id)));
          }
        }
      }
    } catch (error) {
      setStoragePending(error instanceof Error && error.message === "storage_pending");
      setMessage(error instanceof Error && error.message !== "storage_pending" ? error.message : "");
    } finally { setLoading(false); }
  }, [forthFilter, forthGroup, forthCategory, forthConfidence, forthPage, forthSearch, request, th]);
  useEffect(() => { void refresh(); }, [refresh]);

  const visibleNotices = useMemo(() => {
    return notices.filter((notice) => {
      const title = `${notice.title_en} ${notice.title_th}`;
      const isTest = /\[TEST\]/i.test(title) || notice.category === "test";
      if (inboxFilter === "test") return isTest;
      if (inboxFilter === "unread") return !notice.acknowledged_at && !notice.read_at;
      return true;
    });
  }, [notices, inboxFilter]);

  async function approveForthImport(item: ForthImportItem, forceDuplicate = false) {
    setBusy(true);
    try {
      const data = await request("/api/fleet-operations/forth-import", {
        method: "POST",
        body: JSON.stringify({
          forthLocationId: item.forthLocationId,
          action: "create_directory_draft",
          forceDuplicate
        })
      });
      setMessage(th
        ? `สร้างร่างสถานที่ EES แล้ว · ${data.location?.company_name ?? item.name ?? item.forthLocationId}`
        : `EES Directory draft created · ${data.location?.company_name ?? item.name ?? item.forthLocationId}`);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function linkForthImport(item: ForthImportItem, eesLocationId: string) {
    setBusy(true);
    try {
      await request("/api/fleet-operations/forth-import", {
        method: "POST",
        body: JSON.stringify({
          forthLocationId: item.forthLocationId,
          action: "link_existing",
          eesLocationId
        })
      });
      setMessage(th ? "เชื่อมรหัส Forth กับสถานที่ EES แล้ว โดยไม่เขียนทับพิกัด" : "Forth ID linked to EES without overwriting coordinates.");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function bulkForthImport(action: "approve_drafts" | "skip" | "defer", ids: string[]) {
    setBusy(true);
    try {
      const data = await request("/api/fleet-operations/forth-import/bulk", {
        method: "POST",
        body: JSON.stringify({ action, forthLocationIds: ids, confirm: true })
      });
      const summary = data.summary ?? {};
      setMessage(th
        ? `ดำเนินการกลุ่มแล้ว · สร้าง ${summary.created ?? 0} · ข้าม/มีอยู่แล้ว ${(summary.alreadyImported ?? 0) + (summary.rejected ?? 0)} · ล้มเหลว ${summary.failed ?? 0}`
        : `Bulk finished · created ${summary.created ?? 0} · skipped/existing ${(summary.alreadyImported ?? 0) + (summary.rejected ?? 0)} · failed ${summary.failed ?? 0}`);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function reviewVisit(eventKey: string, action: "confirm" | "mark_review" | "match_booking" | "reject_booking_match", bookingId?: string) {
    if (reviewReason.trim().length < 5) {
      setMessage(th ? "ระบุเหตุผลการตรวจอย่างน้อย 5 ตัวอักษร" : "Enter an audit reason of at least 5 characters.");
      return;
    }
    setBusy(true);
    try {
      await request("/api/fleet-operations/events/review", {
        method: "PATCH",
        body: JSON.stringify({
          eventKey,
          action,
          bookingId,
          reason: reviewReason.trim(),
          requestId: crypto.randomUUID(),
          idempotencyKey: `${eventKey}:${action}:${bookingId ?? ""}:${reviewReason.trim()}`
        })
      });
      setReviewReason("");
      await refresh();
      setMessage(th ? "บันทึกการตรวจเหตุการณ์แล้ว" : "Visit review saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  const visible = useMemo(() => events.filter((event) => {
    const term = search.trim().toLocaleLowerCase();
    return !term || `${event.vehicle_registration ?? ""} ${names[event.location_id] ?? ""} ${event.event_type}`.toLocaleLowerCase().includes(term);
  }), [events, names, search]);
  const visibleLocationReviews = useMemo(() => locationReviews.filter((item) =>
    !locationSearch.trim() || `${item.name} ${item.province ?? ""}`.toLocaleLowerCase().includes(locationSearch.trim().toLocaleLowerCase())
  ).slice(0, 30), [locationReviews, locationSearch]);

  async function updatePreference(key: keyof Preferences) {
    setBusy(true);
    try {
      const data = await request("/api/fleet-operations/preferences", { method: "PATCH", body: JSON.stringify({ [key]: !preferences[key] }) });
      setPreferences({ ...initialPrefs, ...data.preferences });
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function saveQuietHours() {
    if (Boolean(quietStart) !== Boolean(quietEnd)) {
      setMessage(th ? "กำหนดเวลาเริ่มและสิ้นสุดทั้งสองช่อง" : "Choose both quiet-hours times or clear both.");
      return;
    }
    setBusy(true);
    try {
      const data = await request("/api/fleet-operations/preferences", { method: "PATCH", body: JSON.stringify({
        quiet_start: quietStart || null, quiet_end: quietEnd || null
      }) });
      setQuietStart(data.preferences.quiet_start?.slice(0, 5) ?? "");
      setQuietEnd(data.preferences.quiet_end?.slice(0, 5) ?? "");
      setMessage(th ? "บันทึกเวลาปิดเสียงแล้ว" : "Quiet hours saved in Bangkok time.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function subscribe() {
    setBusy(true);
    try {
      if (!publicKey) throw new Error(th ? "ยังไม่ได้ตั้งค่ากุญแจ Web Push" : "Web Push keys are not configured yet.");
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        throw new Error(th ? "อุปกรณ์นี้ยังไม่รองรับ Web Push" : "This device does not support Web Push.");
      }
      if (Notification.permission !== "granted" && await Notification.requestPermission() !== "granted") {
        throw new Error(th ? "ยังไม่ได้อนุญาตการแจ้งเตือน" : "Notification permission was not granted.");
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription() ??
        await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKeyBytes(publicKey) });
      const stored = await request("/api/fleet-operations/subscriptions", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
      setCurrentSubscriptionId(stored.subscriptionId ?? null);
      setDeviceCount((count) => Math.max(1, count));
      setMessage(th ? "ลงทะเบียนอุปกรณ์แล้ว" : "This device is registered. Live fleet alerts remain disabled until approved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function removeDevice() {
    setBusy(true);
    try {
      const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (subscription) {
        await request("/api/fleet-operations/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) });
        await subscription.unsubscribe();
      }
      setDeviceCount((count) => Math.max(0, count - 1));
      setCurrentSubscriptionId(null);
      setMessage(th ? "นำอุปกรณ์นี้ออกแล้ว" : "This device was removed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function testOnDevice() {
    try {
      if (!("Notification" in window) || !("serviceWorker" in navigator)) throw new Error("Notifications unavailable.");
      if (Notification.permission !== "granted" && await Notification.requestPermission() !== "granted") return;
      await (await navigator.serviceWorker.ready).showNotification(th ? "[TEST] ทดสอบการแจ้งเตือน EES" : "[TEST] EES notification test", {
        body: th ? "[TEST] ทดสอบบนอุปกรณ์เท่านั้น ไม่ใช่การแจ้งเตือนรถจริง" : "[TEST] Device-only test. Not a live fleet arrival/departure alert.",
        icon: "/icon-192.png", tag: "ees-fleet-test-not-operational", data: { href: "/fleet-events?testPush=1" }
      });
      setMessage(th ? "แสดงการทดสอบบนอุปกรณ์แล้ว — ยังไม่ใช่การแจ้งเตือนปฏิบัติการ" : "On-device TEST notification shown — not an operational fleet alert.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  async function testServerPush() {
    if (!currentSubscriptionId) return;
    setBusy(true);
    try {
      const result = await request("/api/fleet-operations/test-push", { method: "POST",
        body: JSON.stringify({ subscriptionId: currentSubscriptionId }) });
      setMessage(result.status === "delivered"
        ? (th
          ? "[TEST] เซิร์ฟเวอร์รับคำสั่งส่งแล้ว — ต้องยืนยันว่า iPhone แสดงการแจ้งเตือนจริง (อย่าถือว่าส่งสำเร็จแค่เพราะผู้ให้บริการรับคำขอ)"
          : "[TEST] Server accepted the push request — confirm the iPhone actually displayed it (provider accept ≠ device receipt).")
        : (th ? "[TEST] ส่งการทดสอบไม่สำเร็จ ตรวจสถานะการส่ง" : "[TEST] Server push test failed. Check delivery status."));
      const history = await request("/api/fleet-operations/test-push");
      setPushAttempts(history.attempts ?? []);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function acknowledge(id: string) {
    try {
      const data = await request("/api/fleet-operations/inbox", { method: "PATCH", body: JSON.stringify({ id, action: "acknowledge" }) });
      setNotices((current) => current.map((notice) => notice.id === id ? { ...notice,
        acknowledged_at: data.notification.acknowledged_at, read_at: data.notification.read_at } : notice));
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  function chooseZone(locationId: string) {
    setZoneLocationId(locationId);
    const existing = zones.find((zone) => zone.location_id === locationId);
    setZoneRadius(existing?.radius_meters ?? 150);
    setZoneEntry(existing?.entry_dwell_seconds ?? 60);
    setZoneExit(existing?.exit_dwell_seconds ?? 60);
    setZoneHysteresis(existing?.hysteresis_meters ?? 25);
    setZoneActive(existing?.active ?? false);
  }

  async function saveZone() {
    setBusy(true);
    try {
      await request("/api/fleet-operations/zones", { method: "PUT", body: JSON.stringify({
        locationId: zoneLocationId, radiusMeters: zoneRadius, entryDwellSeconds: zoneEntry,
        exitDwellSeconds: zoneExit, hysteresisMeters: zoneHysteresis, active: zoneActive, reason: zoneReason
      }) });
      setZoneReason("");
      await refresh();
      setMessage(th ? "บันทึกโซนพร้อมประวัติการเปลี่ยนแปลงแล้ว" : "Geofence saved with an audit record.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-[1560px] px-4 pb-12 pt-5 text-slate-900 sm:px-7">
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-violet-200 pb-5">
      <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-700">EES · {th ? "ปฏิบัติการกองรถ" : "Fleet operations"}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{th ? "เหตุการณ์สถานที่" : "Location events"}</h1>
        <p className="mt-1 text-sm text-slate-600">{th ? "การเข้าถึงและออกจากสถานที่พร้อมหลักฐาน GPS ที่ยืนยัน" : "Arrival and departure evidence from verified GPS positions."}</p></div>
      <div className="flex items-center gap-2"><Link href="/fleet-tracking" className="btn-secondary">{th ? "กลับไปแผนที่" : "Live map"}</Link>
        <button type="button" className="btn-secondary" onClick={() => void refresh()}><RefreshCw className="h-4 w-4" />{th ? "รีเฟรช" : "Refresh"}</button></div>
    </div>

    {storagePending ? <section className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-950" role="status">
      <strong>{th ? "รอการอนุมัติฐานข้อมูล" : "Database approval pending"}</strong>
      <p className="mt-1 text-sm">{th ? "ยังไม่ติดตั้งตารางเหตุการณ์และการแจ้งเตือน จึงยังไม่บันทึกการเข้าออกหรือส่งแจ้งเตือน" :
        "Event and notification storage has not been installed. No arrivals, departures or push alerts are being recorded yet."}</p>
    </section> : null}
    {message ? <p className="mt-4 rounded-lg bg-violet-50 p-3 text-sm text-violet-900" role="status">{message}</p> : null}
    <div className="mt-5 flex flex-wrap gap-2 text-sm">
      <span className="rounded-full bg-violet-100 px-3 py-1.5 font-semibold text-violet-900">{th ? "อยู่ที่สถานที่" : "At locations"} · {atLocations.length}</span>
      <span className="rounded-full bg-amber-100 px-3 py-1.5 font-semibold text-amber-900">{th ? "สถานะไม่แน่ชัด" : "Position uncertain"} · {uncertainVisits.length}</span>
      <span className="rounded-full bg-slate-100 px-3 py-1.5 font-semibold">{th ? "เข้าล่าสุด" : "Recent arrivals"} · {events.filter((event) => event.event_type === "arrival").length}</span>
      <span className="rounded-full bg-slate-100 px-3 py-1.5 font-semibold">{th ? "ออกล่าสุด" : "Recent departures"} · {events.filter((event) => event.event_type === "departure").length}</span>
      <span className="rounded-full bg-amber-100 px-3 py-1.5 font-semibold text-amber-900">{th ? "รอตรวจในรายการล่าสุด" : "Recent needs review"} · {events.filter((event) => event.review_status === "needs_review" || event.booking_match_status === "ambiguous").length}</span>
    </div>
    <p className="mt-3 text-xs text-slate-500">{th ? "รอบตรวจล่าสุด" : "Last monitor run"}: {lastRun ? `${formatTime(lastRun.finished_at || lastRun.started_at, language)} · ${lastRun.status}` : th ? "ยังไม่มี" : "none"}</p>
    {bookingReviewIncomplete ? <p className="mt-2 text-xs text-amber-800" role="status">{th ? "ข้อมูล Booking Diary สำหรับการจับคู่อาจไม่ครบ กรุณาตรวจด้วยตนเอง" : "Booking Diary candidates could not be checked completely; review bookings manually."}</p> : null}

    <ForthLocationsBulkPanel
      th={th}
      busy={busy}
      forthSummary={forthSummary}
      forthItems={forthItems}
      forthGroups={forthGroups}
      forthFilter={forthFilter}
      forthGroup={forthGroup}
      forthCategory={forthCategory}
      forthConfidence={forthConfidence}
      forthSearch={forthSearch}
      forthPage={forthPage}
      forthTotalFiltered={forthTotalFiltered}
      forthDiameterNote={forthDiameterNote}
      pilotReadiness={pilotReadiness}
      onFilterChange={(value) => { setForthPage(1); setForthFilter(value); }}
      onGroupChange={(value) => { setForthPage(1); setForthGroup(value); }}
      onCategoryChange={(value) => { setForthPage(1); setForthCategory(value); }}
      onConfidenceChange={(value) => { setForthPage(1); setForthConfidence(value); }}
      onSearchChange={(value) => { setForthPage(1); setForthSearch(value); }}
      onPageChange={setForthPage}
      onApproveOne={approveForthImport}
      onLinkOne={linkForthImport}
      onBulk={bulkForthImport}
    />

    <details className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer font-bold text-violet-900">{th ? "ความพร้อมของสถานที่ EES" : "EES location readiness"} · {pinStorageReady ? locationReviews.length : (th ? "รอตารางหมุด" : "pin storage pending")}</summary>
      <p className="mt-2 text-xs text-slate-600">{th ? "รายชื่อและหมุดที่ยังต้องตรวจสอบในไดเรกทอรีหลัก ไม่มีการสร้างพิกัดอัตโนมัติ" :
        "Review Directory records and confirmed pins in the EES master. No coordinates are inferred from addresses or map links."}</p>
      {pinStorageReady ? <><input className="mt-3 min-h-10 w-full max-w-sm rounded-lg border border-slate-300 px-3 text-sm" value={locationSearch} onChange={(event) => setLocationSearch(event.target.value)} placeholder={th ? "ค้นหาสถานที่" : "Search locations"} aria-label={th ? "ค้นหาสถานที่" : "Search locations"} />
        <div className="mt-2 max-h-72 overflow-y-auto divide-y divide-slate-100">{visibleLocationReviews.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><div><strong>{item.name}</strong><span className="ml-2 text-xs text-slate-500">{item.province}</span><p className="text-xs text-amber-800">{item.reasons.map((reason) => reason === "record_unverified" ? (th ? "รายการยังไม่ยืนยัน" : "Record unverified") : reason === "pin_missing" ? (th ? "ยังไม่มีหมุดพิกัดที่ยืนยัน" : "Confirmed pin missing") : (th ? "อาจซ้ำ" : "Possible duplicate")).join(" · ")}</p></div><Link href={`/locations?focus=${encodeURIComponent(item.id)}`} className="font-semibold text-violet-700">{th ? "ตรวจสอบ" : "Review"}</Link></div>)}</div>
        {locationReviews.length > 30 ? <p className="mt-2 text-xs text-slate-500">{th ? "แสดง 30 รายการแรก ใช้ค้นหาเพื่อดูรายการอื่น" : "Showing 30 results. Search to find other locations."}</p> : null}</> : null}
    </details>

    <details className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer font-bold text-violet-900">{th ? "โซนติดตามที่อนุมัติ" : "Approved monitoring zones"} · {zones.filter((zone) => zone.active).length} {th ? "เปิด" : "active"}</summary>
      <p className="mt-2 text-xs text-slate-600">{th ? "โซนจะตรวจสอบได้เฉพาะรายการ EES ที่ยืนยันและมีหมุดปลายทางที่ยืนยัน" :
        "Only verified EES Directory records with confirmed destination pins can be activated."}</p>
      {zones.length ? <div className="mt-3 flex flex-wrap gap-2 text-xs">{zones.map((zone) => <span key={zone.location_id} className={`rounded-full px-3 py-1.5 ${zone.active ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-600"}`}>{names[zone.location_id] || zone.location_id} · {zone.radius_meters} m · {zone.active ? (th ? "เปิด" : "active") : (th ? "ปิด" : "inactive")}</span>)}</div> : null}
      {zoneHistory.length ? <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-600"><strong>{th ? "ประวัติการตั้งค่า" : "Recent zone changes"}</strong>{zoneHistory.slice(0, 5).map((entry) => <p key={entry.id} className="mt-1">{formatTime(entry.changed_at, language)} · {names[entry.location_id] || entry.location_id} · {entry.reason}</p>)}</div> : null}
      {can("admin:user_management") ? <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-3">
        <label className="sm:col-span-3">{th ? "สถานที่ EES ที่พร้อม" : "Ready EES location"}<select className="mt-1 block min-h-10 w-full rounded-lg border border-slate-300 px-3" value={zoneLocationId} onChange={(event) => chooseZone(event.target.value)}><option value="">{th ? "เลือกสถานที่" : "Select a location"}</option>{readyLocations.map((location) => <option key={location.id} value={location.id}>{th ? location.thai_name || location.company_name : location.company_name}</option>)}</select></label>
        {([ ["zoneRadius", zoneRadius, setZoneRadius, th ? "รัศมี (เมตร)" : "Radius (m)"], ["zoneEntry", zoneEntry, setZoneEntry, th ? "รอยืนยันเข้า (วินาที)" : "Entry dwell (s)"], ["zoneExit", zoneExit, setZoneExit, th ? "รอยืนยันออก (วินาที)" : "Exit dwell (s)"], ["zoneHysteresis", zoneHysteresis, setZoneHysteresis, th ? "ระยะกันสัญญาณแกว่ง (เมตร)" : "Hysteresis (m)"] ] as const).map(([key, value, setter, label]) => <label key={key}>{label}<input type="number" min={0} value={value} onChange={(event) => setter(Number(event.target.value))} className="mt-1 block min-h-10 w-full rounded-lg border border-slate-300 px-3" /></label>)}
        <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={zoneActive} onChange={(event) => setZoneActive(event.target.checked)} className="h-4 w-4 accent-violet-700" />{th ? "เปิดการตรวจจับโซนนี้" : "Activate this monitoring zone"}</label>
        <label className="sm:col-span-3">{th ? "เหตุผลการเปลี่ยนแปลง" : "Audit reason"}<input value={zoneReason} onChange={(event) => setZoneReason(event.target.value)} maxLength={500} className="mt-1 block min-h-10 w-full rounded-lg border border-slate-300 px-3" placeholder={th ? "ระบุเหตุผลอย่างน้อย 5 ตัวอักษร" : "At least 5 characters"} /></label>
        <button type="button" className="btn-primary w-fit" disabled={busy || storagePending || !zoneLocationId || zoneReason.trim().length < 5} onClick={() => void saveZone()}>{th ? "บันทึกโซน" : "Save zone"}</button>
      </div> : null}
    </details>

    {atLocations.length ? <section className="mt-5 rounded-xl border border-violet-200 bg-violet-50/60 p-4"><h2 className="font-bold text-violet-950">{th ? "ยืนยันว่าอยู่ที่สถานที่" : "Confirmed at locations"}</h2>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{atLocations.map((state) => <div key={state.vehicle_key} className="rounded-lg bg-white px-3 py-2 text-sm"><strong>{events.find((event) => event.vehicle_key === state.vehicle_key)?.vehicle_registration || state.vehicle_key}</strong><p className="text-slate-600">{names[state.location_id] || state.location_id}</p><p className="text-xs text-slate-500">{th ? "เข้าถึง" : "Arrived"} {formatTime(state.arrival_at, language)}</p></div>)}</div>
    </section> : null}

    <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-lg font-bold"><Truck className="h-5 w-5 text-violet-700" />{th ? "ไทม์ไลน์รถ" : "Vehicle timeline"}</h2>
          <input className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={th ? "ค้นหาทะเบียนหรือสถานที่" : "Search plate or location"} aria-label={th ? "ค้นหาทะเบียนหรือสถานที่" : "Search plate or location"} /></div>
        {loading ? <p className="py-8 text-sm text-slate-500">{th ? "กำลังโหลด" : "Loading"}</p> : visible.length ?
          <div className="mt-4 divide-y divide-slate-100">{visible.map((event) => <article key={event.event_key} id={event.event_key} className="flex flex-wrap justify-between gap-3 py-3">
            <div><p className="font-bold">{event.vehicle_registration || (th ? "ไม่ทราบทะเบียน" : "Registration unavailable")} <span className="ml-2 text-sm font-medium text-violet-700">{event.event_type === "arrival" ? (th ? "เข้าถึง" : "Arrived") : (th ? "ออกจาก" : "Departed")}</span></p>
              <p className="mt-1 flex items-center gap-1 text-sm text-slate-700"><MapPin className="h-4 w-4" />{names[event.location_id] || event.location_id}</p>
              <p className="mt-1 text-xs text-slate-500">{th ? "GPS ยืนยัน · ไม่ใช่หลักฐานโหลดสินค้า" : "Verified GPS · not loading confirmation"}{event.booking_match_status !== "unmatched" ? ` · ${event.booking_match_status}` : ""}</p></div>
            {bookingProposals[event.event_key]?.status === "review_candidate" ? <p className="w-full text-xs font-semibold text-amber-800">{th ? "อาจตรงกับ Booking Diary 1 งาน · ต้องตรวจโดยเจ้าหน้าที่" : "One possible Booking Diary job · office review required"}</p> : null}
            {bookingProposals[event.event_key]?.status === "ambiguous" ? <p className="w-full text-xs font-semibold text-amber-800">{th ? "ตรงได้หลายงาน · ยังไม่จับคู่อัตโนมัติ" : "Multiple possible jobs · left unmatched"}</p> : null}
            <div className="text-right text-sm"><p className="font-semibold">{formatTime(event.occurred_at, language)}</p><p className="mt-1 text-xs text-slate-500">{event.duration_seconds != null ? `${Math.floor(event.duration_seconds / 60)} ${th ? "นาที" : "min on site"}` : event.review_status}</p></div>
            <div className="w-full flex flex-wrap items-end gap-2 border-t border-slate-50 pt-2">
              <label className="text-xs grow">{th ? "เหตุผลการตรวจ" : "Review reason"}<input className="mt-1 block min-h-9 w-full rounded-lg border border-slate-300 px-2 text-sm" value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} maxLength={500} /></label>
              <button type="button" className="btn-secondary" disabled={busy || storagePending} onClick={() => void reviewVisit(event.event_key, "confirm")}>{th ? "ยืนยันเหตุการณ์" : "Confirm event"}</button>
              <button type="button" className="btn-secondary" disabled={busy || storagePending} onClick={() => void reviewVisit(event.event_key, "mark_review")}>{th ? "ทำเครื่องหมายตรวจ" : "Needs review"}</button>
              {bookingProposals[event.event_key]?.status === "review_candidate" && bookingProposals[event.event_key]?.candidates[0] ? <button type="button" className="btn-primary" disabled={busy || storagePending} onClick={() => void reviewVisit(event.event_key, "match_booking", bookingProposals[event.event_key].candidates[0].bookingId)}>{th ? "ยืนยันจับคู่ Booking" : "Confirm booking match"}</button> : null}
              {event.booking_match_status === "candidate" || bookingProposals[event.event_key]?.status === "review_candidate" || bookingProposals[event.event_key]?.status === "ambiguous" ? <button type="button" className="btn-secondary" disabled={busy || storagePending} onClick={() => void reviewVisit(event.event_key, "reject_booking_match")}>{th ? "ปฏิเสธการจับคู่" : "Reject booking match"}</button> : null}
            </div>
          </article>)}</div> : <p className="py-8 text-sm text-slate-500">{storagePending ? (th ? "รอฐานข้อมูล" : "Waiting for approved storage") : (th ? "ยังไม่มีเหตุการณ์ที่ยืนยัน" : "No confirmed visit events yet.")}</p>}
      </section>

      <div className="space-y-5"><section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 font-bold"><BellRing className="h-5 w-5 text-violet-700" />{th ? "การแจ้งเตือน iPhone" : "iPhone notifications"}</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-5 text-slate-600">
          <li>{th ? "เปิด EES ด้วย Safari บน HTTPS (เว็บไซต์หลัก)" : "Open EES in Safari over HTTPS (main website)."}</li>
          <li>{th ? "Share → Add to Home Screen" : "Share → Add to Home Screen."}</li>
          <li>{th ? "เปิดจากไอคอนหน้าจอโฮม แล้วลงชื่อเข้าใช้" : "Open from the Home Screen icon and sign in."}</li>
          <li>{th ? "อนุญาตการแจ้งเตือน แล้วกดลงทะเบียนอุปกรณ์" : "Allow notifications, then register this device."}</li>
        </ol>
        <p className="mt-2 text-xs text-slate-500">
          {th ? "สถานะอุปกรณ์" : "Device status"}: {deviceCount > 0 ? (th ? `ลงทะเบียนแล้ว (${deviceCount})` : `Registered (${deviceCount})`) : (th ? "ยังไม่ลงทะเบียน" : "Not registered")}
          {currentSubscriptionId ? (th ? " · อุปกรณ์นี้พร้อม" : " · this device ready") : ""}
          {publicKey ? "" : (th ? " · ยังไม่มี VAPID" : " · VAPID not configured")}
        </p>
        <div className="mt-3 flex flex-wrap gap-2"><button className="btn-primary" type="button" disabled={busy || storagePending || !publicKey} onClick={() => void subscribe()}>{th ? "ลงทะเบียนอุปกรณ์" : "Register device"}</button>
          <button className="btn-secondary" type="button" disabled={busy || storagePending} onClick={() => void removeDevice()}>{th ? "นำอุปกรณ์นี้ออก" : "Remove this device"}</button>
          <button className="btn-secondary" type="button" onClick={() => void testOnDevice()}>{th ? "ทดสอบบนอุปกรณ์ [TEST]" : "Local device test [TEST]"}</button></div>
        <button className="btn-secondary mt-2" type="button" disabled={busy || !serverTestEnabled || !currentSubscriptionId} onClick={() => void testServerPush()}>{th ? "ส่ง Push ทดสอบจากเซิร์ฟเวอร์ [TEST]" : "Send server push test [TEST]"}</button>
        <p className="mt-3 text-xs text-amber-800">{th ? "ข้อความ [TEST] แยกจากการแจ้งเตือนปฏิบัติการจริง การแจ้งเตือนรถจริงยังปิดอยู่จนกว่าจะได้รับอนุมัติ" : "[TEST] messages are separate from operational alerts. Live fleet push stays disabled until authorised."}</p>
        {pushAttempts.length ? <div className="mt-3 border-t border-slate-100 pt-3 text-xs"><strong>{th ? "การทดสอบล่าสุด" : "Recent server tests"}</strong>{pushAttempts.slice(0, 3).map((attempt) => <p key={attempt.id} className="mt-1 text-slate-600">{formatTime(attempt.attempted_at, language)} · {attempt.status}{attempt.http_status ? ` · HTTP ${attempt.http_status}` : ""}</p>)}</div> : null}
        <div className="mt-4 border-t border-slate-100 pt-3"><h3 className="text-sm font-bold">{th ? "หมวดที่ต้องการรับ" : "Notification preferences"}</h3>
          {categories.map(({ key, en, th: thai }) => <label key={key} className="mt-2 flex items-center justify-between gap-2 text-sm"><span>{th ? thai : en}</span>
            <input type="checkbox" checked={preferences[key]} disabled={busy || storagePending} onChange={() => void updatePreference(key)} className="h-4 w-4 accent-violet-700" /></label>)}
          <div className="mt-4 border-t border-slate-100 pt-3"><p className="text-xs font-semibold">{th ? "เวลาปิดเสียง · เวลาไทย" : "Quiet hours · Bangkok time"}</p>
            <div className="mt-2 flex flex-wrap items-end gap-2"><label className="text-xs">{th ? "เริ่ม" : "From"}<input type="time" value={quietStart} onChange={(event) => setQuietStart(event.target.value)} className="mt-1 block min-h-10 rounded-lg border border-slate-300 px-2" /></label>
              <label className="text-xs">{th ? "สิ้นสุด" : "To"}<input type="time" value={quietEnd} onChange={(event) => setQuietEnd(event.target.value)} className="mt-1 block min-h-10 rounded-lg border border-slate-300 px-2" /></label>
              <button type="button" className="btn-secondary" disabled={busy || storagePending} onClick={() => void saveQuietHours()}>{th ? "บันทึก" : "Save"}</button>
              <button type="button" className="text-xs font-semibold text-violet-700" onClick={() => { setQuietStart(""); setQuietEnd(""); }}>{th ? "ล้างเวลา" : "Clear times"}</button></div></div></div>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="flex items-center gap-2 font-bold"><Bell className="h-5 w-5 text-violet-700" />{th ? "กล่องแจ้งเตือน" : "Fleet inbox"}</h2>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {([
            ["all", th ? "ทั้งหมด" : "All"],
            ["unread", th ? "ยังไม่อ่าน" : "Unread"],
            ["test", th ? "เฉพาะ [TEST]" : "[TEST] only"]
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`rounded-full px-3 py-1.5 font-semibold ${inboxFilter === value ? "bg-violet-200 text-violet-950" : "bg-slate-100 text-slate-700"}`}
              onClick={() => setInboxFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {visibleNotices.length ? <div className="mt-3 space-y-3">{visibleNotices.map((notice) => {
          const isTest = /\[TEST\]/i.test(`${notice.title_en} ${notice.title_th}`) || notice.category === "test";
          return <article key={notice.id} className={`rounded-lg border p-3 text-sm ${notice.acknowledged_at ? "border-slate-200 bg-slate-50" : "border-violet-200 bg-violet-50/40"}`}>
          <div className="flex justify-between gap-2">
            <strong>{th ? notice.title_th : notice.title_en}</strong>
            <span className="text-xs text-slate-500">{notice.category}{isTest ? " · TEST" : " · ops"}</span>
          </div>
          <p className="mt-1 text-slate-600">{th ? notice.body_th : notice.body_en}</p>
          <p className="mt-1 text-xs text-slate-500">{formatTime(notice.created_at, language)}{notice.read_at ? (th ? " · อ่านแล้ว" : " · read") : (th ? " · ยังไม่อ่าน" : " · unread")}</p>
          <div className="mt-2 flex gap-3"><Link href={notice.href} className="font-semibold text-violet-700">{th ? "ดูเหตุการณ์" : "View event"}</Link>
            {!notice.acknowledged_at ? <button type="button" className="font-semibold text-violet-700" onClick={() => void acknowledge(notice.id)}>{th ? "รับทราบ / อ่านแล้ว" : "Acknowledge / mark read"}</button> : <span className="text-xs text-emerald-700">{th ? "รับทราบแล้ว" : "Acknowledged"}</span>}</div>
        </article>;
        })}</div> : <p className="mt-3 text-sm text-slate-500">{storagePending ? (th ? "รอฐานข้อมูลแจ้งเตือน" : "Notification storage pending") : (th ? "ยังไม่มีการแจ้งเตือนในตัวกรองนี้" : "No notifications in this filter.")}</p>}
      </section></div>
    </div>
  </main>;
}

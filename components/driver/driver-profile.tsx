"use client";

import { DriverDisclosure } from "./driver-disclosure";
import { DriverAvatar } from "./driver-ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useLanguage } from "@/lib/language-provider";
import type { DriverProfile } from "@/lib/driver-operations";

const copy = {
  en: {
    title: "Profile", official: "Official name", name: "Display name", phone: "Phone", email: "Email", driver: "Driver ID", vehicle: "Vehicle",
    language: "Language", save: "Save", photo: "Change photo", photoHelp: "JPEG, PNG or WebP · up to 5 MB", locked: "Official details are managed by the office.",
    password: "Change password", current: "Current password", new: "New password", confirm: "Confirm password",
    passwordHelp: "Use at least 12 characters. Other portal sessions will be signed out.", saved: "Saved successfully", error: "Unable to complete this request. Please retry or contact operations.",
    loading: "Loading…", retry: "Retry", mismatch: "Passwords must match and contain at least 12 characters.", working: "Saving…", edit: "Edit profile", personal: "Personal details", preferences: "Preferences", officialDetails: "Official details"
  },
  th: {
    title: "โปรไฟล์", official: "ชื่อทางการ", name: "ชื่อที่แสดง", phone: "โทรศัพท์", email: "อีเมล", driver: "รหัสคนขับ", vehicle: "รถ",
    language: "ภาษา", save: "บันทึก", photo: "เปลี่ยนรูป", photoHelp: "JPEG, PNG หรือ WebP · ไม่เกิน 5 MB", locked: "สำนักงานเป็นผู้ดูแลข้อมูลทางการ",
    password: "เปลี่ยนรหัสผ่าน", current: "รหัสผ่านปัจจุบัน", new: "รหัสผ่านใหม่", confirm: "ยืนยันรหัสผ่าน",
    passwordHelp: "อย่างน้อย 12 ตัวอักษร อุปกรณ์อื่นจะถูกออกจากระบบ", saved: "บันทึกสำเร็จ", error: "ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้งหรือติดต่อฝ่ายปฏิบัติการ",
    loading: "กำลังโหลด…", retry: "ลองอีกครั้ง", mismatch: "รหัสผ่านต้องตรงกันและมีอย่างน้อย 12 ตัวอักษร", working: "กำลังบันทึก…", edit: "แก้ไขโปรไฟล์", personal: "ข้อมูลส่วนตัว", preferences: "การตั้งค่า", officialDetails: "ข้อมูลทางการ"
  }
};

export function DriverProfilePage() {
  const router = useRouter();
  const { language, setLanguage } = useLanguage();
  const l = copy[language];
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState(false);
  const [message, setMessage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const applyProfile = useCallback((p: DriverProfile) => {
    setProfile(p); setName(p.displayName); setPhone(p.phone);
    window.dispatchEvent(new CustomEvent("ees-driver-profile-updated", { detail: p }));
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/driver/profile", { cache: "no-store" });
      if (!r.ok) throw new Error();
      const p = await r.json() as DriverProfile;
      applyProfile(p); setError(false); return true;
    } catch { setError(true); return false; }
  }, [applyProfile]);

  useEffect(() => { void load(); }, [load]);

  async function request(url: string, init: RequestInit) {
    setBusy(true); setError(false); setMessage(false);
    try {
      const r = await fetch(url, init);
      if (!r.ok) throw new Error();
      if (url.endsWith("/avatar")) applyProfile(await r.json() as DriverProfile);
      else if (!await load()) throw new Error();
      setMessage(true); router.refresh();
    } catch { setError(true); }
    finally { setBusy(false); setUploading(false); }
  }

  async function password(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = {
      currentPassword: String(data.get("currentPassword")),
      password: String(data.get("password")),
      confirmPassword: String(data.get("confirmPassword"))
    };
    if (body.password !== body.confirmPassword || body.password.length < 12) { setError(true); return; }
    await request("/api/driver/profile/password", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    form.reset();
  }

  const personalDetails = useRef<HTMLDetailsElement>(null);

  const field = "driver-field";

  return (
    <main className="driver-profile mx-auto max-w-3xl space-y-2 px-3 py-3 sm:px-4 sm:py-5">
      <h1 className="driver-page-title">{l.title}</h1>
      {error ? <div role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{l.error}<button onClick={() => void load()} className="ml-3 underline">{l.retry}</button></div> : null}
      {message ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{l.saved}</p> : null}
      {!profile ? <p>{l.loading}</p> : <>
        <section className="driver-surface p-3">
          <div className="flex items-center gap-3">
            <DriverAvatar src={profile.avatarUrl} name={profile.displayName} className="h-14 w-14 rounded-2xl text-lg" />
            <div className="min-w-0 flex-1">
              <p className="break-words text-xl font-bold text-[#152638]">{profile.displayName}</p>
              <p className="mt-0.5 break-words text-xs text-slate-500">{l.driver} {profile.driverId}</p><p className="mt-1 break-words text-sm font-semibold text-[#152638]">{l.vehicle} {profile.vehicle || "—"}</p>
              <button type="button" className="driver-accent mt-1 inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--driver-border)] bg-[#fcfbf8] px-3 text-xs font-semibold" onClick={() => {
                const details = personalDetails.current;
                if (!details) return;
                details.open = true;
                details.querySelector<HTMLInputElement>('input:not([type="file"])')?.focus();
              }}>{l.edit}</button>
            </div>
          </div>
        </section>

        <div className="driver-information-group driver-surface">
        <DriverDisclosure title={l.personal} detailsRef={personalDetails}>
        <form className="border-t border-slate-100 p-3 sm:p-4" onSubmit={(e) => {
          e.preventDefault();
          void request("/api/driver/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: name, phone }) });
        }}>
              <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-[var(--driver-border)] px-3 text-sm font-semibold text-[#152638] hover:bg-slate-50 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--driver-primary)]">
                {uploading ? (language === "th" ? "กำลังอัปโหลด…" : "Uploading…") : l.photo}
                <input aria-label={l.photo} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0]; event.target.value = "";
                    if (!file) return;
                    if (!file.size || file.size > 5242880 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError(true); setMessage(false); return; }
                    const body = new FormData(); body.append("avatar", file); setUploading(true);
                    void request("/api/driver/profile/avatar", { method: "POST", body });
                  }} />
              </label>
          <p className="mt-1 text-xs text-slate-500">{l.photoHelp}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="block text-sm font-semibold">{l.name}<input className={field} value={name} maxLength={100} required disabled={busy} onChange={(e) => setName(e.target.value)} /></label>
            <label className="block text-sm font-semibold">{l.phone}<input type="tel" className={field} value={phone} maxLength={30} disabled={busy} onChange={(e) => setPhone(e.target.value)} /></label>
          </div>
          <button className="mt-2 min-h-11 w-full rounded-lg driver-primary-action px-4 font-semibold text-white disabled:opacity-50" disabled={busy}>{busy ? l.working : l.save}</button>
        </form>
        </DriverDisclosure>

        <label className="flex min-h-11 items-center justify-between gap-3 bg-white px-4">
          <span className="text-sm font-semibold text-[#152638]">{l.language}</span>
          <select aria-label={l.language} className="min-h-11 max-w-[60%] cursor-pointer bg-transparent pl-2 text-right text-sm text-slate-500" value={language} onChange={(e) => setLanguage(e.target.value as "en" | "th")}>
            <option value="en">English</option><option value="th">ไทย</option>
          </select>
        </label>

        <DriverDisclosure title={l.officialDetails}><div className="border-t border-slate-100 px-4 pb-3">
          <dl className="mt-2 divide-y divide-slate-100 text-sm">
            {[[l.official, profile.officialName], [l.email, profile.email], [l.driver, profile.driverId], [l.vehicle, profile.vehicle || "—"]].map(([label, value]) =>
              <div key={label} className="flex justify-between gap-3 py-2"><dt className="text-slate-500">{label}</dt><dd className="max-w-[65%] break-all text-right font-semibold">{value}</dd></div>
            )}
          </dl>
          <p className="mt-2 text-xs leading-5 text-slate-500">{l.locked}</p>
        </div></DriverDisclosure>

        <DriverDisclosure title={l.password}><div className="border-t border-slate-100 px-4 pb-3">
          <form className="mt-2 space-y-2" onSubmit={(e) => void password(e)}>
            <p className="text-xs leading-5 text-slate-500">{l.passwordHelp}</p>
            {[["currentPassword", l.current, "current-password"], ["password", l.new, "new-password"], ["confirmPassword", l.confirm, "new-password"]].map(([key, label, autocomplete]) =>
              <label key={key} className="block text-sm font-semibold">{label}<input name={key} type="password" autoComplete={autocomplete} minLength={key === "currentPassword" ? 1 : 12} maxLength={128} required disabled={busy} className={field} /></label>
            )}
            <button className="btn-secondary min-h-11 w-full" disabled={busy}>{busy ? l.working : l.password}</button>
          </form>
        </div></DriverDisclosure>
        </div>
      </>}
    </main>
  );
}

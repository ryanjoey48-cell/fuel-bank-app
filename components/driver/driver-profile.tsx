"use client";

import { DriverDisclosure } from "./driver-disclosure";
import { DriverAvatar } from "./driver-ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useLanguage } from "@/lib/language-provider";
import type { DriverProfile } from "@/lib/driver-operations";

const copy = {
  en: {
    title: "Profile",
    official: "Official name",
    name: "Display name",
    phone: "Phone",
    email: "Email",
    driver: "Driver ID",
    vehicle: "Vehicle",
    language: "Language",
    save: "Save changes",
    photo: "Change photo",
    photoHelp: "JPEG, PNG or WebP · up to 5 MB",
    locked: "Official details are managed by the office.",
    password: "Change password",
    current: "Current password",
    new: "New password",
    confirm: "Confirm password",
    passwordHelp: "Use at least 12 characters. Other portal sessions will be signed out.",
    saved: "Saved successfully",
    error: "Unable to complete this request. Please retry or contact operations.",
    loading: "Loading…",
    retry: "Retry",
    mismatch: "Passwords must match and contain at least 12 characters.",
    working: "Saving…",
    edit: "Edit profile",
    cancel: "Cancel",
    personal: "Personal details",
    preferences: "Preferences",
    officialDetails: "Official details",
    photoUpdating: "Updating photo…",
  },
  th: {
    title: "โปรไฟล์",
    official: "ชื่อทางการ",
    name: "ชื่อที่แสดง",
    phone: "โทรศัพท์",
    email: "อีเมล",
    driver: "รหัสคนขับ",
    vehicle: "รถ",
    language: "ภาษา",
    save: "บันทึกการเปลี่ยนแปลง",
    photo: "เปลี่ยนรูป",
    photoHelp: "JPEG, PNG หรือ WebP · ไม่เกิน 5 MB",
    locked: "สำนักงานเป็นผู้ดูแลข้อมูลทางการ",
    password: "เปลี่ยนรหัสผ่าน",
    current: "รหัสผ่านปัจจุบัน",
    new: "รหัสผ่านใหม่",
    confirm: "ยืนยันรหัสผ่าน",
    passwordHelp: "อย่างน้อย 12 ตัวอักษร อุปกรณ์อื่นจะถูกออกจากระบบ",
    saved: "บันทึกสำเร็จ",
    error: "ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้งหรือติดต่อฝ่ายปฏิบัติการ",
    loading: "กำลังโหลด…",
    retry: "ลองอีกครั้ง",
    mismatch: "รหัสผ่านต้องตรงกันและมีอย่างน้อย 12 ตัวอักษร",
    working: "กำลังบันทึก…",
    edit: "แก้ไขโปรไฟล์",
    cancel: "ยกเลิก",
    personal: "ข้อมูลส่วนตัว",
    preferences: "การตั้งค่า",
    officialDetails: "ข้อมูลทางการ",
    photoUpdating: "กำลังอัปเดตรูป…",
  },
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
  const [editing, setEditing] = useState(false);

  const personalDetails = useRef<HTMLFormElement>(null);
  const field = "driver-field";

  const applyProfile = useCallback((p: DriverProfile) => {
    setProfile(p);
    setName(p.displayName);
    setPhone(p.phone);
    window.dispatchEvent(
      new CustomEvent("ees-driver-profile-updated", { detail: p }),
    );
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/driver/profile", { cache: "no-store" });
      if (!r.ok) throw new Error();
      const p = (await r.json()) as DriverProfile;
      applyProfile(p);
      setError(false);
      return true;
    } catch {
      setError(true);
      return false;
    }
  }, [applyProfile]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(false), 2200);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function request(
    url: string,
    init: RequestInit,
    options?: { closeEditor?: boolean },
  ) {
    setBusy(true);
    setError(false);
    setMessage(false);

    try {
      const r = await fetch(url, init);
      if (!r.ok) throw new Error();

      if (url.endsWith("/avatar")) {
        applyProfile((await r.json()) as DriverProfile);
      } else if (!(await load())) {
        throw new Error();
      }

      if (options?.closeEditor) setEditing(false);
      setMessage(true);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
      setUploading(false);
    }
  }

  async function password(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = {
      currentPassword: String(data.get("currentPassword")),
      password: String(data.get("password")),
      confirmPassword: String(data.get("confirmPassword")),
    };

    if (
      body.password !== body.confirmPassword ||
      body.password.length < 12
    ) {
      setError(true);
      return;
    }

    await request("/api/driver/profile/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    form.reset();
  }

  function openEditor() {
    setEditing(true);
    requestAnimationFrame(() => {
      personalDetails.current?.querySelector<HTMLInputElement>(
        'input:not([type="file"])',
      )?.focus();
    });
  }

  function cancelEditor() {
    if (profile) {
      setName(profile.displayName);
      setPhone(profile.phone);
    }
    setEditing(false);
    setError(false);
  }

  return (
    <main className="driver-profile mx-auto max-w-3xl space-y-3 px-3 py-3 sm:px-4 sm:py-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="driver-page-title">{l.title}</h1>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-[var(--driver-border)] bg-[var(--driver-surface-soft)] px-3 py-2.5 text-sm text-[var(--driver-text-muted)]"
        >
          {l.error}
          <button
            onClick={() => void load()}
            className="ml-3 font-semibold underline"
          >
            {l.retry}
          </button>
        </div>
      ) : null}

      {message ? (
        <div
          role="status"
          className="driver-profile-toast fixed left-1/2 z-[70] -translate-x-1/2 rounded-full border border-[var(--driver-border)] bg-[var(--driver-surface-soft)] px-4 py-2 text-sm font-semibold text-[var(--driver-text-muted)] shadow-sm"
        >
          ✓ {l.saved}
        </div>
      ) : null}

      {!profile ? (
        <div className="driver-surface p-5 text-sm text-[var(--driver-text-muted)]">
          {l.loading}
        </div>
      ) : (
        <>
          <section className="driver-surface overflow-hidden">
            <div className="flex items-center gap-3 p-3">
              <DriverAvatar
                src={profile.avatarUrl}
                name={profile.displayName}
                className="h-14 w-14 rounded-2xl text-lg"
              />

              <div className="min-w-0 flex-1">
                <p className="break-words text-xl font-bold text-[var(--driver-text)]">
                  {profile.displayName}
                </p>

                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--driver-text-muted)]">
                  <span>
                    {l.driver}{" "}
                    <strong className="font-semibold text-[var(--driver-text)]">
                      {profile.driverId}
                    </strong>
                  </span>
                  <span>
                    {l.vehicle}{" "}
                    <strong className="font-semibold text-[var(--driver-text)]">
                      {profile.vehicle || "—"}
                    </strong>
                  </span>
                </div>
              {!editing ? (
                <button
                  type="button"
                  className="mt-2 min-h-11 rounded-lg border border-[var(--driver-border)] bg-[var(--driver-surface)] px-3 text-xs font-semibold text-[var(--driver-text)]"
                  onClick={openEditor}
                >
                  {l.edit}
                </button>
              ) : null}
              </div>
            </div>

            {editing ? (
              <form
                ref={personalDetails}
                className="border-t border-[var(--driver-border)] bg-[var(--driver-surface)] p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void request(
                    "/api/driver/profile",
                    {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        displayName: name,
                        phone,
                      }),
                    },
                    { closeEditor: true },
                  );
                }}
              >
                <div className="flex items-center gap-3 rounded-xl bg-[var(--driver-surface)] p-3">
                  <DriverAvatar
                    src={profile.avatarUrl}
                    name={profile.displayName}
                    className="h-12 w-12 rounded-xl text-base"
                  />

                  <div className="min-w-0 flex-1">
                    <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-[var(--driver-border)] bg-[var(--driver-surface-soft)] px-3 text-sm font-semibold text-[var(--driver-text)] hover:bg-[var(--driver-surface-soft)] focus-within:outline focus-within:outline-2 focus-within:outline-[var(--driver-primary)]">
                      {uploading ? l.photoUpdating : l.photo}
                      <input
                        aria-label={l.photo}
                        className="sr-only"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={busy}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (!file) return;

                          if (
                            !file.size ||
                            file.size > 5242880 ||
                            ![
                              "image/jpeg",
                              "image/png",
                              "image/webp",
                            ].includes(file.type)
                          ) {
                            setError(true);
                            setMessage(false);
                            return;
                          }

                          const body = new FormData();
                          body.append("avatar", file);
                          setUploading(true);

                          void request("/api/driver/profile/avatar", {
                            method: "POST",
                            body,
                          });
                        }}
                      />
                    </label>
                    <p className="mt-1 text-[11px] leading-4 text-[var(--driver-text-muted)]">
                      {l.photoHelp}
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-semibold text-[var(--driver-text)]">
                    {l.name}
                    <input
                      className={field}
                      value={name}
                      maxLength={100}
                      required
                      disabled={busy}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>

                  <label className="block text-sm font-semibold text-[var(--driver-text)]">
                    {l.phone}
                    <input
                      type="tel"
                      className={field}
                      value={phone}
                      maxLength={30}
                      disabled={busy}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </label>
                </div>

                <div className="mt-3 grid grid-cols-[0.8fr_1.2fr] gap-2">
                  <button
                    type="button"
                    onClick={cancelEditor}
                    disabled={busy}
                    className="min-h-11 rounded-xl border border-[var(--driver-border)] bg-[var(--driver-surface-soft)] px-4 text-sm font-bold text-[var(--driver-text)] disabled:opacity-50"
                  >
                    {l.cancel}
                  </button>

                  <button
                    className="driver-primary-action min-h-11 rounded-xl px-4 text-sm font-bold text-white disabled:opacity-50"
                    disabled={busy}
                  >
                    {busy ? l.working : l.save}
                  </button>
                </div>
              </form>
            ) : null}
          </section>

          <div className="driver-information-group driver-surface overflow-hidden">
            <label className="flex min-h-12 items-center justify-between gap-3 bg-[var(--driver-surface-soft)] px-4">
              <span className="text-sm font-semibold text-[var(--driver-text)]">
                {l.language}
              </span>
              <select
                aria-label={l.language}
                className="min-h-11 max-w-[60%] cursor-pointer bg-transparent pl-2 text-right text-sm font-medium text-[var(--driver-text-muted)]"
                value={language}
                onChange={(e) => setLanguage(e.target.value as "en" | "th")}
              >
                <option value="en">English</option>
                <option value="th">ไทย</option>
              </select>
            </label>

            <DriverDisclosure title={l.officialDetails}>
              <div className="border-t border-[var(--driver-border)] px-4 pb-3">
                <dl className="mt-1 divide-y divide-[var(--driver-border)] text-sm">
                  {[
                    [l.official, profile.officialName],
                    [l.email, profile.email],
                    [l.driver, profile.driverId],
                    [l.vehicle, profile.vehicle || "—"],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="flex justify-between gap-3 py-2.5"
                    >
                      <dt className="text-[var(--driver-text-muted)]">{label}</dt>
                      <dd className="max-w-[65%] break-all text-right font-semibold text-[var(--driver-text)]">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-xs leading-5 text-[var(--driver-text-muted)]">
                  {l.locked}
                </p>
              </div>
            </DriverDisclosure>

            <DriverDisclosure title={l.password}>
              <div className="border-t border-[var(--driver-border)] px-4 pb-3">
                <form
                  className="mt-2 space-y-2.5"
                  onSubmit={(e) => void password(e)}
                >
                  <p className="text-xs leading-5 text-[var(--driver-text-muted)]">
                    {l.passwordHelp}
                  </p>

                  {[
                    ["currentPassword", l.current, "current-password"],
                    ["password", l.new, "new-password"],
                    ["confirmPassword", l.confirm, "new-password"],
                  ].map(([key, label, autocomplete]) => (
                    <label
                      key={key}
                      className="block text-sm font-semibold text-[var(--driver-text)]"
                    >
                      {label}
                      <input
                        name={key}
                        type="password"
                        autoComplete={autocomplete}
                        minLength={key === "currentPassword" ? 1 : 12}
                        maxLength={128}
                        required
                        disabled={busy}
                        className={field}
                      />
                    </label>
                  ))}

                  <button
                    className="btn-secondary min-h-11 w-full"
                    disabled={busy}
                  >
                    {busy ? l.working : l.password}
                  </button>
                </form>
              </div>
            </DriverDisclosure>
          </div>
        </>
      )}
    </main>
  );
}

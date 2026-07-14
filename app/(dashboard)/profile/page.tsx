"use client";

import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { Header } from "@/components/header";
import { useLanguage } from "@/lib/language-provider";
import { supabase } from "@/lib/supabase";

type ProfileUser = {
  id?: string;
  email?: string;
  created_at?: string;
  last_sign_in_at?: string | null;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};

function metaString(user: ProfileUser | null, key: string) {
  const value = user?.user_metadata?.[key] ?? user?.app_metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function formatDate(value: string | null | undefined, language: "en" | "th") {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export default function ProfilePage() {
  const { language, t } = useLanguage();
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser((data.user ?? null) as ProfileUser | null);
    });
  }, []);

  const email = user?.email ?? "";
  const name = metaString(user, "name") || metaString(user, "full_name") || (email.toLowerCase() === "joeryan09@outlook.com" ? "Joey Ryan" : email || "-");
  const role = email.toLowerCase() === "joeryan09@outlook.com" ? "Admin" : metaString(user, "role") || "Staff";
  const company = metaString(user, "company") || metaString(user, "company_name") || "Expert Express Sender Co., Ltd.";

  const startEditingName = () => {
    setNameInput(name === "-" ? "" : name);
    setNameError(null);
    setSuccessMessage(null);
    setEditingName(true);
  };

  const cancelEditingName = () => {
    setEditingName(false);
    setNameInput("");
    setNameError(null);
  };

  const saveName = async () => {
    const trimmedName = nameInput.trim();
    setNameError(null);
    setSuccessMessage(null);

    if (!trimmedName) {
      setNameError(t.profile.nameRequired);
      return;
    }

    if (trimmedName.length < 2) {
      setNameError(t.profile.nameTooShort);
      return;
    }

    if (trimmedName.length > 80) {
      setNameError(t.profile.nameTooLong);
      return;
    }

    try {
      setSavingName(true);
      const { data, error } = await supabase.auth.updateUser({
        data: {
          ...(user?.user_metadata ?? {}),
          name: trimmedName,
          full_name: trimmedName
        }
      });

      if (error) {
        throw error;
      }

      const updatedUser = (data.user ?? {
        ...user,
        user_metadata: {
          ...(user?.user_metadata ?? {}),
          name: trimmedName,
          full_name: trimmedName
        }
      }) as ProfileUser;

      if (updatedUser.id) {
        const { error: bookingCreatorError } = await supabase
          .from("booking_diary")
          .update({ created_by: trimmedName })
          .eq("created_by_user_id", updatedUser.id);

        if (bookingCreatorError) {
          console.warn("Booking creator display name refresh skipped:", bookingCreatorError);
        }
      }

      setUser(updatedUser);
      setEditingName(false);
      setNameInput("");
      setSuccessMessage(t.profile.nameUpdated);

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("fuel-bank:user-updated"));
      }
    } catch (error) {
      console.error("Profile name update failed:", error);
      setNameError(t.profile.updateNameError);
    } finally {
      setSavingName(false);
    }
  };

  return (
    <>
      <div className="mb-6 hidden md:block">
        <Header title={t.profile.title} description={t.profile.description} />
      </div>

      <section className="surface-card p-4 sm:p-5">
        {successMessage ? (
          <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
            {successMessage}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t.profile.name}</p>
              {!editingName ? (
                <button
                  type="button"
                  onClick={startEditingName}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 shadow-sm transition hover:border-brand-200 hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-200"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {t.profile.editName}
                </button>
              ) : null}
            </div>
            {editingName ? (
              <div className="mt-2 space-y-2">
                <input
                  value={nameInput}
                  onChange={(event) => setNameInput(event.target.value)}
                  className="form-input bg-white"
                  disabled={savingName}
                  maxLength={80}
                  autoFocus
                />
                {nameError ? <p className="text-xs font-semibold text-rose-600">{nameError}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void saveName()} disabled={savingName} className="btn-primary min-h-9 px-3 py-1.5 text-xs disabled:opacity-60">
                    {savingName ? t.common.saving : t.common.save}
                  </button>
                  <button type="button" onClick={cancelEditingName} disabled={savingName} className="btn-secondary min-h-9 px-3 py-1.5 text-xs disabled:opacity-60">
                    {t.common.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-1 font-semibold text-slate-950">{name}</p>
            )}
          </div>
          {[
            [t.profile.email, email || "-"],
            [t.profile.role, role],
            [t.profile.company, company],
            [t.profile.accountCreated, formatDate(user?.created_at, language)],
            [t.profile.lastLogin, formatDate(user?.last_sign_in_at, language)]
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
              <p className="mt-1 font-semibold text-slate-950">{value}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

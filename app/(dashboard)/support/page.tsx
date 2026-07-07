"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Header } from "@/components/header";
import { createSupportTicket } from "@/lib/data";
import { useLanguage } from "@/lib/language-provider";
import { supabase } from "@/lib/supabase";

type SupportCategory = "Bug" | "Feature Request" | "Question" | "Other";
type SupportPriority = "Low" | "Medium" | "High";

type SupportUser = {
  id?: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};

function roleFrom(user: SupportUser | null) {
  const value = user?.user_metadata?.role ?? user?.app_metadata?.role;
  return typeof value === "string" && value.trim() ? value.trim() : "User";
}

function getErrorMessage(error: unknown, fallback: string) {
  if (process.env.NODE_ENV !== "production" && error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (process.env.NODE_ENV !== "production" && typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export default function SupportPage() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const [user, setUser] = useState<SupportUser | null>(null);
  const [category, setCategory] = useState<SupportCategory>("Bug");
  const [priority, setPriority] = useState<SupportPriority>("Medium");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser((data.user ?? null) as SupportUser | null);
    });
  }, []);

  const submitTicket = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);

    const trimmedSubject = subject.trim();
    const trimmedDescription = description.trim();

    if (!trimmedSubject || !trimmedDescription) {
      setMessage(t.support.invalidRequest);
      return;
    }

    try {
      setSubmitting(true);
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        throw authError ?? new Error(t.support.authRequired);
      }

      const currentUser = authData.user as SupportUser;
      setUser(currentUser);

      const ticket = await createSupportTicket({
        user_id: currentUser.id ?? null,
        user_email: currentUser.email || "unknown",
        user_role: roleFrom(currentUser),
        category,
        priority,
        subject: trimmedSubject,
        description: trimmedDescription,
        page_path: pathname,
        current_url: typeof window !== "undefined" ? window.location.href : null,
        browser_info: typeof navigator !== "undefined" ? navigator.userAgent : null,
        screen_size: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : null,
        screenshot_url: null
      });

      setSubject("");
      setDescription("");
      setMessage(t.support.submitSuccessWithNumber.replace("{ticketNumber}", ticket.ticket_number));
    } catch (error) {
      console.error("Support ticket submission failed:", error);
      setMessage(getErrorMessage(error, t.support.submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="mb-6 hidden md:block">
        <Header title={t.support.title} description={t.support.description} />
      </div>

      <section className="surface-card max-w-2xl p-4 sm:p-5">
        <form className="space-y-4" onSubmit={submitTicket}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="form-label">{t.support.category}</span>
              <select value={category} onChange={(event) => setCategory(event.target.value as SupportCategory)} className="form-input bg-white">
                {(["Bug", "Feature Request", "Question", "Other"] as SupportCategory[]).map((option) => (
                  <option key={option} value={option}>{t.support.categoryLabels[option]}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="form-label">{t.support.priority}</span>
              <select value={priority} onChange={(event) => setPriority(event.target.value as SupportPriority)} className="form-input bg-white">
                {(["Low", "Medium", "High"] as SupportPriority[]).map((option) => (
                  <option key={option} value={option}>{t.support.priorityLabels[option]}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="form-label">{t.support.subject}</span>
            <input value={subject} onChange={(event) => setSubject(event.target.value)} className="form-input bg-white" required />
          </label>
          <label className="block">
            <span className="form-label">{t.support.descriptionField}</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} className="form-textarea bg-white" required />
          </label>
          {message ? <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">{message}</p> : null}
          <button type="submit" disabled={submitting} className="btn-primary w-full disabled:opacity-60">
            {submitting ? t.support.submitting : t.support.submitTicket}
          </button>
        </form>
      </section>
    </>
  );
}

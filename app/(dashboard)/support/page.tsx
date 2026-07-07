"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Header } from "@/components/header";
import { createSupportTicket } from "@/lib/data";
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

export default function SupportPage() {
  const pathname = usePathname();
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
    setSubmitting(true);

    try {
      const ticket = await createSupportTicket({
        user_id: user?.id ?? null,
        user_email: user?.email || "unknown",
        user_role: roleFrom(user),
        category,
        priority,
        subject: subject.trim(),
        description: description.trim(),
        page_path: pathname,
        current_url: typeof window !== "undefined" ? window.location.href : null,
        browser_info: typeof navigator !== "undefined" ? navigator.userAgent : null,
        screen_size: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : null,
        screenshot_url: null
      });

      setSubject("");
      setDescription("");
      setMessage(`Support ticket ${ticket.ticket_number} submitted.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to submit support ticket.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="mb-6 hidden md:block">
        <Header title="Support & Feedback" description="Send a support request to the Fuel Bank admin team." />
      </div>

      <section className="surface-card max-w-2xl p-4 sm:p-5">
        <form className="space-y-4" onSubmit={submitTicket}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="form-label">Category</span>
              <select value={category} onChange={(event) => setCategory(event.target.value as SupportCategory)} className="form-input bg-white">
                {["Bug", "Feature Request", "Question", "Other"].map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label>
              <span className="form-label">Priority</span>
              <select value={priority} onChange={(event) => setPriority(event.target.value as SupportPriority)} className="form-input bg-white">
                {["Low", "Medium", "High"].map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="form-label">Subject</span>
            <input value={subject} onChange={(event) => setSubject(event.target.value)} className="form-input bg-white" required />
          </label>
          <label className="block">
            <span className="form-label">Description</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} className="form-textarea bg-white" required />
          </label>
          {message ? <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">{message}</p> : null}
          <button type="submit" disabled={submitting} className="btn-primary w-full disabled:opacity-60">
            {submitting ? "Submitting..." : "Submit ticket"}
          </button>
        </form>
      </section>
    </>
  );
}

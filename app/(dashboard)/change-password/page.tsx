"use client";

import { useState } from "react";
import { Header } from "@/components/header";
import { useLanguage } from "@/lib/language-provider";
import { supabase } from "@/lib/supabase";

export default function ChangePasswordPage() {
  const { t } = useLanguage();
  const c = t.changePassword;
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const updatePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);

    if (newPassword.length < 6) {
      setMessage(c.minimumLength);
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage(c.mismatch);
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);

    if (error) {
      setMessage(c.updateError);
      return;
    }

    setNewPassword("");
    setConfirmPassword("");
    setMessage(c.updated);
  };

  return (
    <>
      <div className="mb-6 hidden md:block">
        <Header title={c.title} description={c.description} />
      </div>

      <section className="surface-card max-w-xl p-4 sm:p-5">
        <form className="space-y-4" onSubmit={updatePassword}>
          <label className="block">
            <span className="form-label">{c.newPassword}</span>
            <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="form-input bg-white" required />
          </label>
          <label className="block">
            <span className="form-label">{c.confirmPassword}</span>
            <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="form-input bg-white" required />
          </label>
          {message ? <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">{message}</p> : null}
          <button type="submit" disabled={saving} className="btn-primary w-full disabled:opacity-60">
            {saving ? c.updating : c.update}
          </button>
        </form>
      </section>
    </>
  );
}

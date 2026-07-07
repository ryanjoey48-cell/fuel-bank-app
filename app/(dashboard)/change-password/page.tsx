"use client";

import { useState } from "react";
import { Header } from "@/components/header";
import { supabase } from "@/lib/supabase";

export default function ChangePasswordPage() {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const updatePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);

    if (newPassword.length < 6) {
      setMessage("New password must be at least 6 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage("New passwords do not match.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);

    if (error) {
      setMessage(error.message || "Unable to update password.");
      return;
    }

    setNewPassword("");
    setConfirmPassword("");
    setMessage("Password updated successfully.");
  };

  return (
    <>
      <div className="mb-6 hidden md:block">
        <Header title="Change Password" description="Update your Fuel Bank sign-in password." />
      </div>

      <section className="surface-card max-w-xl p-4 sm:p-5">
        <form className="space-y-4" onSubmit={updatePassword}>
          <label className="block">
            <span className="form-label">New password</span>
            <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="form-input bg-white" required />
          </label>
          <label className="block">
            <span className="form-label">Confirm new password</span>
            <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="form-input bg-white" required />
          </label>
          {message ? <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">{message}</p> : null}
          <button type="submit" disabled={saving} className="btn-primary w-full disabled:opacity-60">
            {saving ? "Updating..." : "Update password"}
          </button>
        </form>
      </section>
    </>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export function AuthForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    const action =
      mode === "login"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });

    const { error } = await action;

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    setMessage(
      mode === "signup"
        ? "Account created. If email confirmation is enabled, verify your inbox first."
        : "Login successful. Redirecting..."
    );

    setLoading(false);

    if (mode === "login") {
      router.replace("/dashboard");
    }
  };

  return (
    <div className="w-full max-w-md rounded-[2rem] border border-white/60 bg-white/90 p-8 shadow-soft backdrop-blur">
      <div className="mb-8 flex rounded-2xl bg-slate-100 p-1">
        <button
          type="button"
          className={`flex-1 rounded-2xl px-4 py-3 text-sm font-medium ${
            mode === "login" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"
          }`}
          onClick={() => setMode("login")}
        >
          Login
        </button>
        <button
          type="button"
          className={`flex-1 rounded-2xl px-4 py-3 text-sm font-medium ${
            mode === "signup" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"
          }`}
          onClick={() => setMode("signup")}
        >
          Create Account
        </button>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Email</label>
          <input
            type="email"
            required
            placeholder="ops@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Password</label>
          <input
            type="password"
            required
            minLength={6}
            placeholder="Minimum 6 characters"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {message ? (
          <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-700">{message}</p>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
        </button>
      </form>
    </div>
  );
}

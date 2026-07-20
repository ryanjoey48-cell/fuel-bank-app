"use client";

import clsx from "clsx";
import { Check, ChevronDown, Plus, Search, Settings, X } from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { normalizeClientName, normalizedClientKey } from "@/lib/clients";
import type { Client } from "@/types/database";

type ClientSelectorProps = {
  clients: Client[];
  selectedId: string;
  onSelect: (clientId: string) => void;
  onCreate: (name: string) => Promise<Client>;
  onManage: () => void;
  canManage: boolean;
  required: boolean;
  language: "en" | "th";
  disabled?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
};

const copy = {
  en: {
    label: "Client name",
    placeholder: "Search or select client",
    add: (name: string) => `Add new client: "${name}"`,
    confirm: (name: string) => `Create "${name}" as a new client?`,
    inactive: "Inactive",
    manage: "Manage clients",
    noMatches: "No matching active clients",
    duplicate: "This client already exists and has been selected."
  },
  th: {
    label: "ชื่อลูกค้า",
    placeholder: "ค้นหาหรือเลือกลูกค้า",
    add: (name: string) => `เพิ่มลูกค้าใหม่: "${name}"`,
    confirm: (name: string) => `ยืนยันการสร้าง "${name}" เป็นลูกค้าใหม่หรือไม่`,
    inactive: "ไม่ได้ใช้งาน",
    manage: "จัดการลูกค้า",
    noMatches: "ไม่พบลูกค้าที่เปิดใช้งาน",
    duplicate: "มีลูกค้านี้อยู่แล้วและได้เลือกให้แล้ว"
  }
} as const;

export function ClientSelector({
  clients,
  selectedId,
  onSelect,
  onCreate,
  onManage,
  canManage,
  required,
  language,
  disabled,
  inputRef
}: ClientSelectorProps) {
  const t = copy[language];
  const rootRef = useRef<HTMLDivElement | null>(null);
  const previousSelectedIdRef = useRef(selectedId);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const selected = clients.find((client) => client.id === selectedId) ?? null;

  useEffect(() => {
    if (!open) setQuery(selected?.name ?? "");
  }, [open, selected?.name]);

  useEffect(() => {
    const previousSelectedId = previousSelectedIdRef.current;
    if (previousSelectedId && !selectedId && !clients.some((client) => client.id === previousSelectedId)) {
      setQuery("");
      setOpen(false);
    }
    previousSelectedIdRef.current = selectedId;
  }, [clients, selectedId]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const activeOptions = useMemo(() => {
    const key = normalizedClientKey(query);
    return clients
      .filter((client) => client.active || client.id === selectedId)
      .filter((client) => !key || normalizedClientKey(client.name).includes(key))
      .slice(0, 30);
  }, [clients, query, selectedId]);
  const cleanedQuery = normalizeClientName(query);
  const exactMatch = clients.find((client) => normalizedClientKey(client.name) === normalizedClientKey(cleanedQuery));
  const canAdd = Boolean(cleanedQuery && !exactMatch);

  const select = (client: Client) => {
    onSelect(client.id);
    setQuery(client.name);
    setMessage("");
    setOpen(false);
  };

  const addClient = async () => {
    if (!canAdd || !window.confirm(t.confirm(cleanedQuery))) return;
    setCreating(true);
    setMessage("");
    try {
      const client = await onCreate(cleanedQuery);
      select(client);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };

  return <div ref={rootRef} className="client-selector">
    <div className="flex items-center justify-between gap-3">
      <label className={clsx("form-label", required && "form-label-required")}>{t.label}</label>
      {canManage ? <button type="button" className="client-selector-manage" onClick={onManage}><Settings className="h-3.5 w-3.5" />{t.manage}</button> : null}
    </div>
    <div className="client-selector-control">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setMessage("");
          if (selectedId) onSelect("");
        }}
        placeholder={t.placeholder}
        disabled={disabled}
        className="booking-form-control pl-10 pr-20"
        role="combobox"
        aria-expanded={open}
        aria-controls="booking-client-options"
        autoComplete="off"
      />
      {selectedId ? <button type="button" className="client-selector-clear" onClick={() => { onSelect(""); setQuery(""); setOpen(true); }} aria-label="Clear client"><X className="h-4 w-4" /></button> : null}
      <button type="button" className="client-selector-toggle" onClick={() => setOpen((value) => !value)} aria-label={t.placeholder}><ChevronDown className={clsx("h-4 w-4 transition", open && "rotate-180")} /></button>
    </div>
    {open ? <div id="booking-client-options" className="client-selector-options" role="listbox">
      {activeOptions.map((client) => <button key={client.id} type="button" role="option" aria-selected={client.id === selectedId} onClick={() => select(client)}>
        <span className="min-w-0 truncate">{client.name}</span>
        {!client.active ? <small>{t.inactive}</small> : client.id === selectedId ? <Check className="h-4 w-4 text-emerald-600" /> : null}
      </button>)}
      {!activeOptions.length && !canAdd ? <p>{t.noMatches}</p> : null}
      {exactMatch?.active && query && exactMatch.id !== selectedId ? <button type="button" onClick={() => { select(exactMatch); setMessage(t.duplicate); }}><Check className="h-4 w-4" />{exactMatch.name}</button> : null}
      {canAdd ? <button type="button" className="client-selector-add" disabled={creating} onClick={() => void addClient()}><Plus className="h-4 w-4" />{t.add(cleanedQuery)}</button> : null}
    </div> : null}
    {message ? <p className="mt-1 text-xs leading-5 text-amber-700">{message}</p> : null}
  </div>;
}

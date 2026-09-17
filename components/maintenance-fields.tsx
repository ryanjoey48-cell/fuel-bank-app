"use client";
import type { ReactNode } from "react";
import { useLanguage } from "@/lib/language-provider";
import { MAINTENANCE_CATEGORIES, type MaintenanceCategory } from "@/lib/maintenance-types";
import { maintenanceCategoryLabels } from "@/lib/maintenance-translations";
export function MaintenanceField({label,children}:{label:string;children:ReactNode}) { return <label className="block min-w-0 space-y-1 text-sm font-medium text-slate-700"><span>{label}</span>{children}</label>; }
export function MaintenanceCategorySelect({value,onChange}:{value:MaintenanceCategory;onChange:(value:MaintenanceCategory)=>void}) { const {language}=useLanguage();return <select className="form-input" value={value} onChange={e=>onChange(e.target.value as MaintenanceCategory)}>{MAINTENANCE_CATEGORIES.map(c=><option key={c} value={c}>{maintenanceCategoryLabels[language][c]}</option>)}</select>; }

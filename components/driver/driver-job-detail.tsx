"use client";

import { ArrowLeft, Clock3, ExternalLink, MapPin, PackageCheck, Truck } from "lucide-react";
import Link from "next/link";
import { useLanguage } from "@/lib/language-provider";
import { buildDriverMapsUrl, type DriverPortalJob } from "@/lib/driver-portal";

const copy = {
  en: {
    back: "Back to my jobs",
    title: "Job details",
    client: "Client",
    pickup: "Pickup",
    dropoff: "Drop-off",
    openMaps: "Open in Google Maps",
    timePending: "Time not set",
    vehicle: "Vehicle",
    trailer: "Trailer",
    vehicleType: "Vehicle type",
    jobReference: "Job reference",
    notAssigned: "Not assigned"
  },
  th: {
    back: "กลับไปยังงานของฉัน",
    title: "รายละเอียดงาน",
    client: "ลูกค้า",
    pickup: "จุดรับสินค้า",
    dropoff: "จุดส่งสินค้า",
    openMaps: "เปิดใน Google Maps",
    timePending: "ยังไม่กำหนดเวลา",
    vehicle: "รถ",
    trailer: "หางพ่วง",
    vehicleType: "ประเภทรถ",
    jobReference: "เลขอ้างอิงงาน",
    notAssigned: "ยังไม่ระบุ"
  }
} as const;

function LocationCard({
  title,
  name,
  address,
  mapsUrl,
  mapsLabel
}: {
  title: string;
  name: string;
  address: string | null;
  mapsUrl: string | null;
  mapsLabel: string;
}) {
  return (
    <section className="rounded-[1.25rem] border border-slate-200 bg-[#fffdf8] p-5 shadow-[0_10px_28px_rgba(57,40,24,0.07)]">
      <div className="flex gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-700">
          <MapPin className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{title}</p>
          <h2 className="mt-1 text-lg font-black leading-6 text-slate-950">{name}</h2>
          {address ? <p className="mt-2 text-sm leading-6 text-slate-600">{address}</p> : null}
        </div>
      </div>
      {mapsUrl ? (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-5 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 text-sm font-bold text-brand-800 hover:border-brand-300 hover:bg-brand-100"
        >
          {mapsLabel}
          <ExternalLink className="h-4 w-4" />
        </a>
      ) : null}
    </section>
  );
}

export function DriverJobDetail({ job }: { job: DriverPortalJob }) {
  const { language } = useLanguage();
  const labels = copy[language];
  const pickupMapsUrl = buildDriverMapsUrl({
    name: job.pickupName,
    address: job.pickupAddress,
    placeId: job.pickupPlaceId,
    latitude: job.pickupLat,
    longitude: job.pickupLng
  });
  const dropoffMapsUrl = buildDriverMapsUrl({
    name: job.dropoffName,
    address: job.dropoffAddress,
    placeId: job.dropoffPlaceId,
    latitude: job.dropoffLat,
    longitude: job.dropoffLng
  });
  const formattedDate = new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Bangkok"
  }).format(new Date(`${job.bookingDate}T12:00:00+07:00`));

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <Link href="/driver" className="inline-flex min-h-10 items-center gap-2 rounded-xl text-sm font-bold text-brand-700 hover:text-brand-900">
        <ArrowLeft className="h-4 w-4" />
        {labels.back}
      </Link>

      <section className="mt-4 rounded-[1.25rem] bg-[#211336] p-5 text-white shadow-[0_18px_40px_rgba(33,19,54,0.18)] sm:p-6">
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-accent-300">{labels.title}</p>
        <h1 className="mt-2 text-2xl font-black tracking-[-0.035em]">{job.clientName || job.jobOrderNumber || labels.title}</h1>
        <div className="mt-5 flex flex-wrap gap-2 text-sm font-bold">
          <span className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2">
            <Clock3 className="h-4 w-4 text-accent-300" />
            {formattedDate} · {job.pickupTime?.slice(0, 5) || labels.timePending}
          </span>
          {job.jobOrderNumber ? (
            <span className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2">
              <PackageCheck className="h-4 w-4 text-accent-300" />
              {labels.jobReference}: {job.jobOrderNumber}
            </span>
          ) : null}
        </div>
      </section>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <LocationCard title={labels.pickup} name={job.pickupName} address={job.pickupAddress} mapsUrl={pickupMapsUrl} mapsLabel={labels.openMaps} />
        <LocationCard title={labels.dropoff} name={job.dropoffName} address={job.dropoffAddress} mapsUrl={dropoffMapsUrl} mapsLabel={labels.openMaps} />
      </div>

      <section className="mt-4 rounded-[1.25rem] border border-slate-200 bg-[#fffdf8] p-5 shadow-[0_10px_28px_rgba(57,40,24,0.07)]">
        <div className="flex items-center gap-2">
          <Truck className="h-5 w-5 text-brand-700" />
          <h2 className="text-sm font-black text-slate-950">{labels.vehicle}</h2>
        </div>
        <dl className="mt-4 divide-y divide-slate-200 text-sm">
          <div className="flex items-center justify-between gap-4 py-3 first:pt-0">
            <dt className="font-semibold text-slate-500">{labels.vehicle}</dt>
            <dd className="text-right font-black text-slate-950">{job.vehicleRegistration || labels.notAssigned}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <dt className="font-semibold text-slate-500">{labels.vehicleType}</dt>
            <dd className="text-right font-black text-slate-950">{job.vehicleType || labels.notAssigned}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
            <dt className="font-semibold text-slate-500">{labels.trailer}</dt>
            <dd className="text-right font-black text-slate-950">{job.trailerRegistration || labels.notAssigned}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}

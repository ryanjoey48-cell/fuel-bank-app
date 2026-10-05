export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return <div className="driver-portal-shell min-h-[100dvh] bg-[var(--app-background)] text-slate-950">{children}</div>;
}

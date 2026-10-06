export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return <div className="driver-portal-shell min-h-[100dvh] bg-[var(--driver-bg)] text-[var(--driver-text)]">{children}</div>;
}

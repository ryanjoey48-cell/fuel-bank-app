import { notFound } from "next/navigation";

export default async function FinanceDemoPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const { default: FinanceDemoCentre } = await import("@/components/finance-demo-centre");
  return <FinanceDemoCentre />;
}

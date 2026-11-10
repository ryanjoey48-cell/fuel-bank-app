import { notFound } from 'next/navigation';
import ExpensesCentre from '@/components/expenses-centre';
export default async function ExpensesFixturePage({searchParams}:{searchParams:Promise<{volume?:string}>}) {
  if (process.env.NODE_ENV === 'production' || process.env.EES_EXPENSES_FIXTURE !== '1') notFound();
  const params=await searchParams;
  return <main><ExpensesCentre fixture fixtureCount={params.volume==='1'?45:2}/></main>;
}

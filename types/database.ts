export type Driver = {
  id: string;
  name: string;
  vehicle_reg: string;
  created_at: string;
  user_id: string;
};

export type WeeklyMileageEntry = {
  id: string;
  week_ending: string;
  driver_id: string;
  driver: string;
  vehicle_reg: string;
  mileage: number;
  created_at: string;
  user_id?: string;
};

export type FuelLog = {
  id: string;
  date: string;
  driver_id: string;
  driver: string;
  vehicle_reg: string;
  mileage: number | null;
  litres: number;
  total_cost: number;
  price_per_litre: number | null;
  location: string;
  fuel_type: string | null;
  payment_method: string | null;
  notes: string | null;
  created_at: string;
  user_id: string;
};

export type BankTransfer = {
  id: string;
  date: string;
  driver_id: string;
  driver: string;
  vehicle_reg: string;
  amount: number;
  transfer_type: string;
  notes: string | null;
  created_at: string;
  user_id: string;
};

export type FuelLogWithDriver = FuelLog;

export type BankTransferWithDriver = BankTransfer;

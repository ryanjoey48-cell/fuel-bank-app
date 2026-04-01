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
  odometer_reading: number;
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
  odometer: number | null;
  mileage: number | null;
  litres: number;
  total_cost: number;
  price_per_litre: number | null;
  station: string;
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
  fuel_log_id?: string | null;
  receipt_status?: "pending" | "submitted" | "approved" | null;
  created_at: string;
  user_id: string;
};

export type FuelLogWithDriver = FuelLog;

export type FuelLogSortKey = "date" | "total_cost" | "litres";
export type FuelLogSortDirection = "asc" | "desc";

export type FuelLogFilters = {
  search?: string;
  fromDate?: string;
  toDate?: string;
  driverId?: string;
  vehicleReg?: string;
  fuelType?: string;
  paymentMethod?: string;
  totalCostMin?: string;
  totalCostMax?: string;
};

export type PaginatedFuelLogsResult = {
  rows: FuelLogWithDriver[];
  totalCount: number;
  page: number;
  pageSize: number;
};

export type FuelLogDaySummary = {
  date: string;
  spend: number;
  litres: number;
  entries: number;
};

export type BankTransferWithDriver = BankTransfer;

export type Shipment = {
  id: string;
  job_reference: string;
  driver_id: string | null;
  driver: string;
  vehicle_reg: string | null;
  shipment_date: string;
  start_location: string;
  end_location: string;
  estimated_distance_km: number | null;
  estimated_fuel_cost_thb: number | null;
  cost_per_km_snapshot_thb: number | null;
  cost_estimation_status: "ready" | "pending";
  cost_estimation_note: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  user_id: string;
  company_id?: string | null;
};

export type ShipmentWithDriver = Shipment;

export type RouteDistanceEstimate = {
  id: string;
  origin_location: string;
  destination_location: string;
  origin_key: string;
  destination_key: string;
  distance_km: number;
  distance_meters: number | null;
  duration_seconds: number | null;
  provider: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  company_id?: string | null;
};

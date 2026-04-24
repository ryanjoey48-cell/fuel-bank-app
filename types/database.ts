export type Driver = {
  id: string;
  name: string;
  vehicle_reg: string;
  vehicle_type: DriverVehicleType | null;
  assigned_vehicle_id: string | null;
  active: boolean;
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

export type Vehicle = {
  id: string;
  user_id: string;
  company_id?: string | null;
  vehicle_reg: string;
  registration?: string;
  vehicle_name: string;
  vehicle_category: string;
  vehicle_type?: DriverVehicleType | string | null;
  fuel_type?: string | null;
  standard_km_per_litre?: number | null;
  default_driver_cost?: number | null;
  active: boolean;
  last_oil_change_odometer: number | null;
  last_oil_change_date: string | null;
  oil_change_interval_km: number | null;
  created_at: string;
  updated_at: string;
};

export type VehicleServiceLog = {
  id: string;
  vehicle_id: string | null;
  vehicle_reg: string;
  service_type: "oil_change" | string;
  service_date: string;
  odometer: number;
  service_odometer?: number;
  interval_km: number | null;
  vehicle_type_snapshot?: DriverVehicleType | string | null;
  notes: string | null;
  created_at: string;
  updated_at?: string;
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
  receipt_checked: boolean;
  receipt_checked_at: string | null;
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
  receiptCheckedStatus?: "" | "checked" | "not_checked";
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

export type FuelLogReceiptSummary = {
  total: number;
  checked: number;
  notChecked: number;
};

export type BankTransferWithDriver = BankTransfer;

export type DriverVehicleType =
  | "EIGHTEEN_WHEELER"
  | "SIX_PLUS_SIX_WHEELER"
  | "SIX_WHEEL_TRUCK"
  | "FOUR_WHEEL_TRUCK";

export type Shipment = {
  id: string;
  job_reference: string;
  customer_name?: string | null;
  goods_description?: string | null;
  pickup_location?: string | null;
  dropoff_location?: string | null;
  vehicle_type?: string | null;
  standard_km_per_litre?: number | null;
  estimated_fuel_litres?: number | null;
  fuel_price_per_litre?: number | null;
  diesel_price?: number | null;
  estimated_fuel_cost?: number | null;
  fuel_cost?: number | null;
  toll_estimate?: number | null;
  toll_cost?: number | null;
  driver_cost?: number | null;
  subtotal_cost?: number | null;
  margin_percent?: number | null;
  final_price?: number | null;
  quoted_price?: number | null;
  total_distance_km?: number | null;
  total_operational_distance_km?: number | null;
  quoted_distance_km?: number | null;
  status?: "Draft" | "Quoted" | "Confirmed" | "In Progress" | "Delivered" | "Completed" | "Cancelled" | "Accepted" | "Assigned" | null;
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

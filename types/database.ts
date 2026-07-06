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
  oil_change_odometer?: number | null;
  service_odometer?: number;
  interval_km: number | null;
  next_service_due_odometer?: number | null;
  vehicle_type_snapshot?: DriverVehicleType | string | null;
  notes: string | null;
  created_at: string;
  updated_at?: string;
  user_id?: string;
};

export type OilChangeBaseline = {
  id: string;
  vehicle_reg: string;
  last_oil_change_date: string;
  last_odometer: number;
  interval_km: number;
  created_at: string;
  updated_at: string;
};

export type OilChangeHistory = {
  id: string;
  vehicle_reg: string;
  oil_change_date: string;
  odometer: number;
  created_at: string;
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
  entry_source: FuelLogEntrySource;
  receipt_checked: boolean;
  receipt_checked_at: string | null;
  notes: string | null;
  created_at: string;
  user_id: string;
};

export type FuelLogEntrySource =
  | "line_message"
  | "direct_from_receipt"
  | "statement_manual"
  | "statement_import"
  | "other";

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
  fromDate?: string;
  toDate?: string;
  driverId?: string;
  vehicleReg?: string;
  location?: string;
  paymentMethod?: string;
  entrySource?: "" | FuelLogEntrySource;
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

export type TripFuelSource = "linked" | "manual";

export type TripJourneyStatus =
  | "created"
  | "missing_mileage"
  | "missing_fuel"
  | "missing_estimated_distance"
  | "completed";

export type TripJourney = {
  id: string;
  booking_diary_id: string | null;
  booking_id: string | null;
  booking_reference?: string | null;
  trip_date: string;
  date?: string | null;
  pickup_time: string | null;
  start_location_type?: "depot" | "custom" | "pickup_only" | string | null;
  start_location?: string | null;
  depot_address?: string | null;
  route_start_type?: "depot" | "custom" | "pickup_only" | string | null;
  depot_address_used?: string | null;
  custom_start_address?: string | null;
  pickup_address?: string | null;
  dropoff_address?: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  route: string | null;
  vehicle_type: string | null;
  vehicle_reg: string | null;
  driver: string | null;
  load_details: string | null;
  load_text?: string | null;
  warehouse_no: string | null;
  booking_notes: string | null;
  notes?: string | null;
  start_mileage: number | null;
  end_mileage: number | null;
  actual_distance_km?: number | null;
  manual_actual_km?: number | null;
  distance_difference_km?: number | null;
  distance_difference_percent?: number | null;
  return_to_depot: boolean;
  estimated_distance_km: number | null;
  estimated_duration_minutes?: number | null;
  google_maps_route_url?: string | null;
  estimated_distance_source: string | null;
  google_estimated_km?: number | null;
  google_estimated_minutes?: number | null;
  route_source?: string | null;
  booking_estimated_km?: number | null;
  booking_estimated_minutes?: number | null;
  booking_google_maps_route_url?: string | null;
  manual_estimated_distance_km: number | null;
  manual_litres_used: number | null;
  manual_litres?: number | null;
  manual_fuel_cost: number | null;
  fuel_source: TripFuelSource;
  waiting_idle_notes: string | null;
  extra_route_notes: string | null;
  status: TripJourneyStatus;
  created_at: string;
  updated_at: string;
  user_id?: string | null;
};

export type TripFuelLogLink = {
  id: string;
  trip_journey_id: string;
  fuel_log_id: string;
  created_at: string;
  user_id?: string | null;
};

export type TripJourneyWithFuel = TripJourney & {
  linkedFuelLogs: FuelLogWithDriver[];
};

export type BookingDiaryEntry = {
  id: string;
  booking_id: string | null;
  booking_date: string;
  pickup_time: string | null;
  amount_pallets: number | null;
  weight: number | null;
  dimensions: string | null;
  pickup: string;
  warehouse_no: string | null;
  dropoff: string;
  pickup_place_id?: string | null;
  dropoff_place_id?: string | null;
  pickup_address?: string | null;
  dropoff_address?: string | null;
  estimated_distance_km?: number | null;
  estimated_duration_minutes?: number | null;
  google_maps_route_url?: string | null;
  distance_source?: string | null;
  route_calculated_at?: string | null;
  vehicle: string | null;
  driver: string | null;
  notes: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  modified_by: string | null;
};

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
  start_location_data?: unknown | null;
  pickup_location_data?: unknown | null;
  dropoff_location_data?: unknown | null;
  additional_dropoffs_data?: unknown | null;
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
  status?: "Draft" | "Quoted" | "Approved" | "In Progress" | "Completed" | "Cancelled" | "Confirmed" | "Delivered" | "Accepted" | "Assigned" | null;
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

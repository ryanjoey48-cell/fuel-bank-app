begin;

create index if not exists fuel_logs_driver_id_date_idx
  on public.fuel_logs (driver_id, date desc, id desc);

create index if not exists fuel_logs_vehicle_reg_date_idx
  on public.fuel_logs (vehicle_reg, date desc, id desc);

create index if not exists fuel_logs_date_idx
  on public.fuel_logs (date desc, id desc);

create index if not exists bank_transfers_driver_id_date_idx
  on public.bank_transfers (driver_id, date desc, id desc);

create index if not exists bank_transfers_vehicle_reg_date_idx
  on public.bank_transfers (vehicle_reg, date desc, id desc);

create index if not exists bank_transfers_date_idx
  on public.bank_transfers (date desc, id desc);

create index if not exists shipments_driver_id_shipment_date_idx
  on public.shipments (driver_id, shipment_date desc, id desc);

create index if not exists shipments_vehicle_reg_shipment_date_idx
  on public.shipments (vehicle_reg, shipment_date desc, id desc);

create index if not exists shipments_shipment_date_id_idx
  on public.shipments (shipment_date desc, id desc);

commit;

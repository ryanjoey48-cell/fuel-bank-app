update public.fuel_logs
set location = 'Bangchak'
where location is not null
  and lower(btrim(location)) like 'bangchak%'
  and location <> 'Bangchak';

update public.fuel_logs
set location = 'Shell'
where location is not null
  and lower(btrim(location)) like 'shell%'
  and location <> 'Shell';

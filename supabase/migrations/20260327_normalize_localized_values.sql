update public.fuel_logs
set fuel_type = case lower(trim(fuel_type))
  when 'diesel' then 'diesel'
  when 'ดีเซล' then 'diesel'
  when 'benzene' then 'benzene'
  when 'เบนซิน' then 'benzene'
  when 'gasohol 91' then 'gasohol_91'
  when 'gasohol_91' then 'gasohol_91'
  when 'แก๊สโซฮอล์ 91' then 'gasohol_91'
  when 'gasohol 95' then 'gasohol_95'
  when 'gasohol_95' then 'gasohol_95'
  when 'แก๊สโซฮอล์ 95' then 'gasohol_95'
  when 'premium diesel' then 'premium_diesel'
  when 'premium_diesel' then 'premium_diesel'
  when 'ดีเซลพรีเมียม' then 'premium_diesel'
  when 'other' then 'other'
  when 'อื่น ๆ' then 'other'
  when 'อื่นๆ' then 'other'
  else fuel_type
end
where fuel_type is not null;

update public.fuel_logs
set payment_method = case lower(trim(payment_method))
  when 'cash' then 'cash'
  when 'เงินสด' then 'cash'
  when 'personal card' then 'personal_card'
  when 'personal_card' then 'personal_card'
  when 'บัตรส่วนตัว' then 'personal_card'
  when 'company card' then 'company_card'
  when 'company_card' then 'company_card'
  when 'card' then 'company_card'
  when 'บัตรบริษัท' then 'company_card'
  when 'bank transfer' then 'bank_transfer'
  when 'bank_transfer' then 'bank_transfer'
  when 'transfer' then 'bank_transfer'
  when 'โอนเงิน' then 'bank_transfer'
  when 'other' then 'other'
  when 'อื่น ๆ' then 'other'
  when 'อื่นๆ' then 'other'
  else payment_method
end
where payment_method is not null;

update public.bank_transfers
set transfer_type = case lower(trim(transfer_type))
  when 'driver advance' then 'driver_advance'
  when 'driver_advance' then 'driver_advance'
  when 'fuel reimbursement' then 'fuel_reimbursement'
  when 'fuel_reimbursement' then 'fuel_reimbursement'
  when 'maintenance' then 'maintenance'
  when 'other' then 'other'
  when 'อื่น ๆ' then 'other'
  when 'อื่นๆ' then 'other'
  else transfer_type
end
where transfer_type is not null;

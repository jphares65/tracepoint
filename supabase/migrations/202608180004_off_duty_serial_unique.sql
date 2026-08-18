create unique index if not exists off_duty_firearm_requests_department_serial_uidx
  on public.off_duty_firearm_requests (
    department_id,
    serial_number
  );

notify pgrst, 'reload schema';

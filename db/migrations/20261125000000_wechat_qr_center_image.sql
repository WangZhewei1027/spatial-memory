alter table public.organization add column wechat_qr_center_image_key text;
create index organization_wechat_qr_center_image_key
  on public.organization (wechat_qr_center_image_key) where wechat_qr_center_image_key is not null;

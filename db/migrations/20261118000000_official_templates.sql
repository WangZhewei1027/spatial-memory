-- A newly provisioned team owns the library in each environment, including when
-- a customer already has a team with the same display name.
alter table public.organization add column is_official_template_library boolean not null default false;
create unique index organization_official_template_library on public.organization (is_official_template_library)
  where is_official_template_library;
insert into public.organization(name, is_official_template_library, allowed_file_types)
values ('官方模板库', true, array['image','video','audio','document','link','text','anchor','model','scene']);

create table public.template_preview (
  asset_id uuid unique references public.asset(id) on delete cascade,
  scene_id uuid unique references public.scene(id) on delete cascade,
  workspace_id uuid unique references public.workspace(id) on delete cascade,
  storage_key text,
  mime_type text,
  lock_version integer not null check (lock_version > 0),
  check (num_nonnulls(asset_id, scene_id, workspace_id) = 1),
  check ((storage_key is null) = (mime_type is null)),
  check (mime_type in ('image/png','image/jpeg','image/webp','image/gif','video/mp4'))
);
create index template_preview_storage_key on public.template_preview(storage_key) where storage_key is not null;

-- PostgreSQL 17 + PostGIS baseline: mutable team assets and map collections.
-- Existing databases upgrade through the transactional migration ledger.
CREATE EXTENSION IF NOT EXISTS postgis;
SET LOCAL check_function_bodies = false;

CREATE SCHEMA auth;

CREATE SCHEMA migration_archive;

CREATE SCHEMA IF NOT EXISTS public;

COMMENT ON SCHEMA public IS 'standard public schema';

CREATE TYPE public.user_role AS ENUM (
    'super_admin',
    'user'
);

CREATE FUNCTION public.consume_anchor_match_request(p_workspace_id uuid, p_limit integer DEFAULT 120) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare used integer;
begin
  insert into public.anchor_match_rate_limit as r values(p_workspace_id,clock_timestamp(),1)
  on conflict(workspace_id) do update set
    request_count=case when r.window_start < clock_timestamp()-interval '1 minute' then 1 else r.request_count+1 end,
    window_start=case when r.window_start < clock_timestamp()-interval '1 minute' then clock_timestamp() else r.window_start end
  returning request_count into used;
  return used <= p_limit;
end;
$$;

CREATE FUNCTION public.error_log_query(p_scope text DEFAULT NULL::text, p_status_class text DEFAULT NULL::text, p_q text DEFAULT NULL::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  with f as (
    select *
    from public.error_log e
    where (p_scope is null or e.scope = p_scope)
      and (p_from is null or e.created_at >= p_from)
      and (p_to is null or e.created_at < p_to)
      and (
        p_q is null
        or e.message ilike '%' || p_q || '%'
        or e.path ilike '%' || p_q || '%'
      )
      and (
        p_status_class is null
        or (p_status_class = 'zero' and e.status = 0)
        or (p_status_class = '4xx' and e.status between 400 and 499)
        or (p_status_class = '5xx' and e.status between 500 and 599)
      )
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'rows', (
      select coalesce(jsonb_agg(t), '[]'::jsonb)
      from (
        select id, created_at, user_id, scope, method, path, status,
               message, context
        from f
        order by created_at desc
        limit greatest(p_limit, 0)
        offset greatest(p_offset, 0)
      ) t
    ),
    'stats', jsonb_build_object(
      'byScope', (
        select coalesce(jsonb_object_agg(scope, c), '{}'::jsonb)
        from (
          select coalesce(scope, 'unknown') as scope, count(*) as c
          from f group by 1
        ) s
      ),
      'byStatusClass', jsonb_build_object(
        'zero', (select count(*) from f where status = 0),
        '4xx', (select count(*) from f where status between 400 and 499),
        '5xx', (select count(*) from f where status between 500 and 599),
        'other', (
          select count(*) from f
          where status is null
             or (status <> 0 and not (status between 400 and 599))
        )
      ),
      'topPaths', (
        select coalesce(
          jsonb_agg(jsonb_build_object('path', path, 'count', c) order by c desc),
          '[]'::jsonb
        )
        from (
          select coalesce(path, '—') as path, count(*) as c
          from f group by 1 order by c desc limit 8
        ) p
      ),
      'daily', (
        select coalesce(
          jsonb_agg(jsonb_build_object('day', day, 'count', c) order by day),
          '[]'::jsonb
        )
        from (
          select date_trunc('day', created_at)::date as day, count(*) as c
          from f group by 1 order by 1
        ) d
      )
    )
  );
$$;

CREATE FUNCTION public.get_user_organizations(p_user_id uuid) RETURNS TABLE(id uuid, name text, description text, created_at timestamp with time zone, role text, map_center jsonb, allowed_file_types text[], pinned_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $$
declare
  v_user_role user_role;
begin
  select u.role into v_user_role
  from users u
  where u.user_id = p_user_id;

  if not found then
    return;
  end if;

  if v_user_role = 'super_admin' then
    return query
    select o.id, o.name, o.description, o.created_at,
      coalesce(om.role, 'super_admin') as role,
      o.map_center,
      o.allowed_file_types,
      p.pinned_at
    from organization o
    left join organization_member om
      on o.id = om.organization_id and om.user_id = p_user_id
    left join user_organization_pin p
      on o.id = p.organization_id and p.user_id = p_user_id
    order by o.created_at desc;
  else
    return query
    select o.id, o.name, o.description, o.created_at, om.role,
      o.map_center,
      o.allowed_file_types,
      p.pinned_at
    from organization o
    inner join organization_member om
      on o.id = om.organization_id
    left join user_organization_pin p
      on o.id = p.organization_id and p.user_id = p_user_id
    where om.user_id = p_user_id
    order by o.created_at desc;
  end if;
end;
$$;

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  user_name text;
  new_org_id uuid;
  default_types text[];
begin
  user_name := nullif(new.name, '');

  -- 新组织的默认文件类型（super-admin 系统设置可改）；配置行缺失时兜底
  select array(select jsonb_array_elements_text(value))
  into default_types
  from public.app_config
  where key = 'default_allowed_file_types';

  if default_types is null then
    default_types := array['image','video','audio','link','text','anchor'];
  end if;

  insert into public.users (user_id, name, role, email)
  values (new.id, user_name, 'user', new.email);

  -- Team workbench: a new personal team starts with
  -- zero map collections (content needs none; collections are created on demand).
  insert into public.organization (name, created_by, allowed_file_types)
  values (
    coalesce(user_name, split_part(new.email, '@', 1)) || '''s Organization',
    new.id,
    default_types
  )
  returning id into new_org_id;

  insert into public.organization_member (organization_id, user_id, role)
  values (new_org_id, new.id, 'owner');

  return new;
end;
$$;

CREATE FUNCTION public.promote_owner_successors(_org_ids uuid[], _excluding_user uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _promoted integer;
begin
  with ranked as (
    select om.id,
           row_number() over (
             partition by om.organization_id
             order by (om.role = 'admin') desc, om.created_at asc, om.id asc
           ) as rn
    from public.organization_member om
    where om.organization_id = any(_org_ids)
      and om.user_id <> _excluding_user
      and om.role <> 'owner'
      -- 已有其他 owner 的组织无需晋升
      and not exists (
        select 1 from public.organization_member o2
        where o2.organization_id = om.organization_id
          and o2.role = 'owner'
          and o2.user_id <> _excluding_user
      )
  )
  update public.organization_member m
  set role = 'owner'
  from ranked r
  where m.id = r.id and r.rn = 1;

  get diagnostics _promoted = row_count;
  return _promoted;
end;
$$;

CREATE FUNCTION public.purge_organizations(_org_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET "content_model.writer" TO 'purge'
    AS $$
declare
  _ws_ids uuid[];
  _deleted_assets integer := 0;
  _deleted_workspaces integer := 0;
  _deleted_orgs integer := 0;
begin
  select coalesce(array_agg(id), '{}'::uuid[])
  into _ws_ids
  from public.workspace
  where organization_id = any(_org_ids);

  -- content model rows (dependency order; everything is organization-scoped)
  delete from public.placement where organization_id = any(_org_ids);
  delete from public.scene where organization_id = any(_org_ids);
  delete from public.upload_receipt where organization_id = any(_org_ids);
  delete from public.content_command_idempotency where organization_id = any(_org_ids);
  -- placements of other organizations never reference these anchors (same-org rule)
  delete from public.asset where organization_id = any(_org_ids);
  get diagnostics _deleted_assets = row_count;

  if array_length(_ws_ids, 1) is not null then
    delete from public.workspace where id = any(_ws_ids);
    get diagnostics _deleted_workspaces = row_count;
  end if;

  -- 级联 organization_member / organization_invitation(organization_id)
  delete from public.organization where id = any(_org_ids);
  get diagnostics _deleted_orgs = row_count;

  return jsonb_build_object(
    'deleted_assets', _deleted_assets,
    'deleted_workspaces', _deleted_workspaces,
    'deleted_orgs', _deleted_orgs
  );
end;
$$;


CREATE FUNCTION public.set_asset_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;

CREATE FUNCTION public.sync_user_email() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.users set email = new.email where user_id = new.id;
  return new;
end;
$$;

CREATE FUNCTION public.touch_last_sign_in() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.users set last_sign_in_at = new.created_at where user_id = new.user_id;
  return new;
end;
$$;

CREATE TABLE auth.account (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamp with time zone,
    refresh_token_expires_at timestamp with time zone,
    scope text,
    password text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE auth.session (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE auth.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    email text NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    image text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE auth.verification (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE migration_archive.content_migration_map (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid,
    source_kind text NOT NULL,
    source_id uuid NOT NULL,
    source_workspace_id uuid,
    source_row_hash text NOT NULL,
    target_organization_id uuid,
    target_kind text,
    target_id uuid,
    status text NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_migration_map_source_kind_check CHECK ((source_kind = ANY (ARRAY['asset'::text, 'scene_asset'::text, 'shop'::text, 'anchor'::text, 'text'::text, 'workspace_assignment'::text, 'tag'::text]))),
    CONSTRAINT content_migration_map_status_check CHECK ((status = ANY (ARRAY['planned'::text, 'staged'::text, 'applied'::text, 'quarantined'::text, 'skipped'::text, 'failed'::text]))),
    CONSTRAINT content_migration_map_target_kind_check CHECK (((target_kind IS NULL) OR (target_kind = ANY (ARRAY['asset'::text, 'asset_version'::text, 'scene'::text, 'scene_revision'::text, 'placement'::text, 'binding'::text, 'assignment'::text]))))
);

CREATE TABLE migration_archive.content_migration_run (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phase text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    organization_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    notes jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT content_migration_run_phase_check CHECK ((phase = ANY (ARRAY['audit'::text, 'backfill'::text, 'verify'::text, 'cutover'::text, 'rollback'::text, 'schema'::text]))),
    CONSTRAINT content_migration_run_status_check CHECK ((status = ANY (ARRAY['running'::text, 'staged'::text, 'completed'::text, 'failed'::text, 'aborted'::text])))
);

CREATE TABLE migration_archive.content_model_source (
    source_table text NOT NULL,
    source_key text NOT NULL,
    row_data jsonb NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE migration_archive.mutable_asset_source (
    source_table text NOT NULL,
    source_key text NOT NULL,
    row_data jsonb NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.anchor_embedding (
    anchor_id uuid NOT NULL,
    image_url text NOT NULL,
    image_sha256 text,
    generation uuid NOT NULL,
    status text NOT NULL,
    embedding real[],
    embedding_version text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT anchor_embedding_check CHECK (((status <> 'ready'::text) OR ((embedding IS NOT NULL) AND (array_ndims(embedding) = 1) AND (cardinality(embedding) = 8448) AND (embedding_version IS NOT NULL)))),
    CONSTRAINT anchor_embedding_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'ready'::text, 'failed'::text])))
);

CREATE TABLE public.anchor_match_rate_limit (
    workspace_id uuid NOT NULL,
    window_start timestamp with time zone NOT NULL,
    request_count integer NOT NULL
);

CREATE TABLE public.app_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.asset (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_by uuid,
    create_at timestamp with time zone DEFAULT now(),
    file_type text NOT NULL,
    name text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    organization_id uuid NOT NULL,
    origin_workspace_id uuid,
    maintained_by uuid,
    visibility text DEFAULT 'restricted'::text NOT NULL,
    state text DEFAULT 'active'::text NOT NULL,
    lock_version integer DEFAULT 1 NOT NULL,
    origin text DEFAULT 'legacy'::text NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    payload jsonb NOT NULL,
    CONSTRAINT asset_origin_check CHECK ((origin = ANY (ARRAY['team_upload'::text, 'public_submission'::text, 'legacy'::text]))),
    CONSTRAINT asset_payload_check CHECK (((jsonb_typeof(payload) = 'object'::text) AND (payload ? 'kind'::text) AND ((payload ->> 'kind'::text) = file_type))),
    CONSTRAINT asset_state_check CHECK ((state = ANY (ARRAY['active'::text, 'archived'::text]))),
    CONSTRAINT asset_visibility_check CHECK ((visibility = ANY (ARRAY['restricted'::text, 'organization'::text])))
);

CREATE TABLE public.asset_resource (
    asset_id uuid NOT NULL,
    role text NOT NULL,
    ordinal integer DEFAULT 0 NOT NULL,
    storage_key text,
    external_url text,
    content_hash text,
    mime_type text,
    size_bytes integer,
    CONSTRAINT asset_resource_key_check CHECK (((storage_key IS NULL) OR ((length(storage_key) >= 1) AND (length(storage_key) <= 1024) AND (storage_key !~ '^[A-Za-z][A-Za-z0-9+.-]*:'::text) AND (storage_key !~ '(^|/)\.\.(/|$)'::text) AND (storage_key !~ '^/'::text)))),
    CONSTRAINT asset_resource_ordinal_check CHECK ((ordinal >= 0)),
    CONSTRAINT asset_resource_role_check CHECK ((role = ANY (ARRAY['primary'::text, 'thumbnail'::text, 'checkin'::text, 'audio_compat'::text, 'reference'::text]))),
    CONSTRAINT asset_resource_size_check CHECK (((size_bytes IS NULL) OR (size_bytes >= 0))),
    CONSTRAINT asset_resource_target_check CHECK ((num_nonnulls(storage_key, external_url) = 1)),
    CONSTRAINT asset_resource_url_check CHECK (((external_url IS NULL) OR (external_url ~ '^https?://'::text)))
);

CREATE TABLE public.content_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    organization_id uuid,
    actor_id uuid,
    action text NOT NULL,
    object_type text NOT NULL,
    object_id uuid,
    workspace_id uuid,
    details jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE public.content_command_idempotency (
    actor_id uuid NOT NULL,
    command text NOT NULL,
    idempotency_key text NOT NULL,
    organization_id uuid NOT NULL,
    request_hash text NOT NULL,
    result_type text NOT NULL,
    result_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_command_idempotency_key_check CHECK (((length(idempotency_key) >= 8) AND (length(idempotency_key) <= 128)))
);

CREATE TABLE public.error_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    user_id uuid,
    scope text,
    method text,
    path text,
    status integer,
    message text,
    context jsonb
);

CREATE TABLE public.organization (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    map_center jsonb,
    allowed_file_types text[],
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    archived_at timestamp with time zone
);

CREATE TABLE public.organization_invitation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    workspace_id uuid,
    token text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone,
    revoked boolean DEFAULT false NOT NULL,
    use_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT organization_invitation_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'viewer'::text])))
);

CREATE TABLE public.organization_member (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT organization_member_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'viewer'::text])))
);

CREATE TABLE public.placement (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    name text,
    asset_id uuid,
    scene_id uuid,
    location public.geometry(Point,4326),
    altitude double precision,
    anchor_id uuid,
    render_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    lock_version integer DEFAULT 1 NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT placement_render_config_check CHECK ((jsonb_typeof(render_config) = 'object'::text)),
    CONSTRAINT placement_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'paused'::text, 'archived'::text]))),
    CONSTRAINT placement_target_xor CHECK ((num_nonnulls(asset_id, scene_id) = 1))
);

CREATE TABLE public.placement_tag (
    placement_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    workspace_id uuid NOT NULL
);

CREATE TABLE public.scene (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    workspace_id uuid,
    name text NOT NULL,
    document jsonb NOT NULL,
    lock_version integer DEFAULT 1 NOT NULL,
    state text DEFAULT 'active'::text NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT scene_document_check CHECK ((jsonb_typeof(document) = 'object'::text)),
    CONSTRAINT scene_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 200))),
    CONSTRAINT scene_state_check CHECK ((state = ANY (ARRAY['active'::text, 'archived'::text])))
);

CREATE TABLE public.scene_asset_ref (
    scene_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    resource_alias text NOT NULL,
    asset_id uuid NOT NULL
);



CREATE TABLE public.schema_migrations (
    name text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.storage_hold (
    storage_key text NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.tag (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#808080'::text,
    workspace_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid
);

CREATE TABLE public.upload_receipt (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    workspace_id uuid,
    created_by uuid NOT NULL,
    storage_key text NOT NULL,
    content_hash text NOT NULL,
    mime_type text,
    size_bytes integer NOT NULL,
    upload_type text,
    purpose text NOT NULL,
    reused boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    CONSTRAINT upload_receipt_purpose_check CHECK ((purpose = 'asset'::text)),
    CONSTRAINT upload_receipt_size_check CHECK ((size_bytes >= 0))
);

CREATE TABLE public.user_organization_pin (
    user_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    pinned_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.users (
    user_id uuid NOT NULL,
    name text,
    role public.user_role DEFAULT 'user'::public.user_role NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    email text,
    last_sign_in_at timestamp with time zone
);

CREATE TABLE public.workspace (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    create_date timestamp with time zone DEFAULT now(),
    organization_id uuid NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid
);

ALTER TABLE ONLY auth.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);

ALTER TABLE ONLY auth.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);

ALTER TABLE ONLY auth.session
    ADD CONSTRAINT session_token_key UNIQUE (token);

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY auth.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);

ALTER TABLE ONLY migration_archive.content_migration_map
    ADD CONSTRAINT content_migration_map_pkey PRIMARY KEY (id);

ALTER TABLE ONLY migration_archive.content_migration_map
    ADD CONSTRAINT content_migration_map_unique UNIQUE NULLS NOT DISTINCT (source_kind, source_id, target_organization_id, target_kind);

ALTER TABLE ONLY migration_archive.content_migration_run
    ADD CONSTRAINT content_migration_run_pkey PRIMARY KEY (id);

ALTER TABLE ONLY migration_archive.content_model_source
    ADD CONSTRAINT content_model_source_pkey PRIMARY KEY (source_table, source_key);

ALTER TABLE ONLY migration_archive.mutable_asset_source
    ADD CONSTRAINT mutable_asset_source_pkey PRIMARY KEY (source_table, source_key);

ALTER TABLE ONLY public.anchor_embedding
    ADD CONSTRAINT anchor_embedding_pkey PRIMARY KEY (anchor_id);

ALTER TABLE ONLY public.anchor_match_rate_limit
    ADD CONSTRAINT anchor_match_rate_limit_pkey PRIMARY KEY (workspace_id);

ALTER TABLE ONLY public.app_config
    ADD CONSTRAINT app_config_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.asset
    ADD CONSTRAINT asset_id_organization_unique UNIQUE (id, organization_id);

ALTER TABLE ONLY public.asset
    ADD CONSTRAINT asset_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.asset_resource
    ADD CONSTRAINT asset_resource_pkey PRIMARY KEY (asset_id, role, ordinal);

ALTER TABLE ONLY public.content_audit_log
    ADD CONSTRAINT content_audit_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.content_command_idempotency
    ADD CONSTRAINT content_command_idempotency_pkey PRIMARY KEY (actor_id, command, idempotency_key);

ALTER TABLE ONLY public.error_log
    ADD CONSTRAINT error_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.organization_invitation
    ADD CONSTRAINT organization_invitation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.organization_invitation
    ADD CONSTRAINT organization_invitation_token_key UNIQUE (token);

ALTER TABLE ONLY public.organization_member
    ADD CONSTRAINT organization_member_org_user_unique UNIQUE (organization_id, user_id);

ALTER TABLE ONLY public.organization_member
    ADD CONSTRAINT organization_member_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.organization
    ADD CONSTRAINT organization_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.placement
    ADD CONSTRAINT placement_id_organization_unique UNIQUE (id, organization_id);

ALTER TABLE ONLY public.placement
    ADD CONSTRAINT placement_id_workspace_unique UNIQUE (id, workspace_id);

ALTER TABLE ONLY public.placement
    ADD CONSTRAINT placement_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.placement_tag
    ADD CONSTRAINT placement_tag_pkey PRIMARY KEY (placement_id, tag_id);

ALTER TABLE ONLY public.scene_asset_ref
    ADD CONSTRAINT scene_asset_ref_pkey PRIMARY KEY (scene_id, resource_alias);

ALTER TABLE ONLY public.scene
    ADD CONSTRAINT scene_id_organization_unique UNIQUE (id, organization_id);

ALTER TABLE ONLY public.scene
    ADD CONSTRAINT scene_pkey PRIMARY KEY (id);






ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (name);

ALTER TABLE ONLY public.storage_hold
    ADD CONSTRAINT storage_hold_pkey PRIMARY KEY (storage_key);

ALTER TABLE ONLY public.tag
    ADD CONSTRAINT tag_id_workspace_unique UNIQUE (id, workspace_id);

ALTER TABLE ONLY public.tag
    ADD CONSTRAINT tag_name_workspace_id_key UNIQUE (name, workspace_id);

ALTER TABLE ONLY public.tag
    ADD CONSTRAINT tag_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.upload_receipt
    ADD CONSTRAINT upload_receipt_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_organization_pin
    ADD CONSTRAINT user_organization_pin_pkey PRIMARY KEY (user_id, organization_id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_id_organization_unique UNIQUE (id, organization_id);

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX account_provider_account_idx ON auth.account USING btree (provider_id, account_id);

CREATE INDEX account_user_id_idx ON auth.account USING btree (user_id);

CREATE INDEX session_user_id_idx ON auth.session USING btree (user_id);

CREATE INDEX verification_identifier_idx ON auth.verification USING btree (identifier);

CREATE INDEX content_migration_map_run_idx ON migration_archive.content_migration_map USING btree (run_id);

CREATE INDEX asset_organization_id_idx ON public.asset USING btree (organization_id) WHERE (organization_id IS NOT NULL);

CREATE INDEX asset_resource_storage_key_idx ON public.asset_resource USING btree (storage_key) WHERE (storage_key IS NOT NULL);

CREATE INDEX content_audit_log_object_idx ON public.content_audit_log USING btree (object_type, object_id);

CREATE INDEX content_audit_log_org_idx ON public.content_audit_log USING btree (organization_id, created_at DESC);

CREATE INDEX idx_error_log_created_at ON public.error_log USING btree (created_at DESC);

CREATE INDEX idx_error_log_status ON public.error_log USING btree (status);

CREATE INDEX idx_org_invitation_org ON public.organization_invitation USING btree (organization_id);

CREATE INDEX idx_organization_member_org_id ON public.organization_member USING btree (organization_id);

CREATE INDEX idx_organization_member_user_id ON public.organization_member USING btree (user_id);

CREATE INDEX idx_tag_workspace_id ON public.tag USING btree (workspace_id);

CREATE INDEX idx_workspace_organization_id ON public.workspace USING btree (organization_id);

CREATE INDEX placement_anchor_idx ON public.placement USING btree (anchor_id) WHERE (anchor_id IS NOT NULL);

CREATE INDEX placement_location_gix ON public.placement USING gist (((location)::public.geography)) WHERE (location IS NOT NULL);

CREATE INDEX placement_organization_idx ON public.placement USING btree (organization_id);

CREATE INDEX placement_scene_idx ON public.placement USING btree (scene_id) WHERE (scene_id IS NOT NULL);

CREATE INDEX placement_workspace_idx ON public.placement USING btree (workspace_id);

CREATE INDEX scene_asset_ref_asset_idx ON public.scene_asset_ref USING btree (asset_id);

CREATE INDEX scene_organization_idx ON public.scene USING btree (organization_id, updated_at DESC);


CREATE INDEX scene_workspace_idx ON public.scene USING btree (workspace_id);

CREATE INDEX upload_receipt_org_hash_idx ON public.upload_receipt USING btree (organization_id, content_hash);

CREATE INDEX upload_receipt_storage_key_idx ON public.upload_receipt USING btree (storage_key);

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER on_auth_user_email_changed AFTER UPDATE OF email ON auth.users FOR EACH ROW WHEN ((old.email IS DISTINCT FROM new.email)) EXECUTE FUNCTION public.sync_user_email();

CREATE TRIGGER trg_session_touch_last_sign_in AFTER INSERT ON auth.session FOR EACH ROW EXECUTE FUNCTION public.touch_last_sign_in();



CREATE TRIGGER trg_asset_set_updated_at BEFORE UPDATE ON public.asset FOR EACH ROW EXECUTE FUNCTION public.set_asset_updated_at();

ALTER TABLE ONLY auth.account
    ADD CONSTRAINT account_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY auth.session
    ADD CONSTRAINT session_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY migration_archive.content_migration_map
    ADD CONSTRAINT content_migration_map_run_id_fkey FOREIGN KEY (run_id) REFERENCES migration_archive.content_migration_run(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.anchor_embedding
    ADD CONSTRAINT anchor_embedding_anchor_id_fkey FOREIGN KEY (anchor_id) REFERENCES public.asset(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.anchor_match_rate_limit
    ADD CONSTRAINT anchor_match_rate_limit_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.asset
    ADD CONSTRAINT asset_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(user_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.asset
    ADD CONSTRAINT asset_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.asset
    ADD CONSTRAINT asset_maintained_by_fkey FOREIGN KEY (maintained_by) REFERENCES public.users(user_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.asset
    ADD CONSTRAINT asset_organization_fk FOREIGN KEY (organization_id) REFERENCES public.organization(id);

ALTER TABLE ONLY public.asset
    ADD CONSTRAINT asset_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);

ALTER TABLE ONLY public.asset
    ADD CONSTRAINT asset_origin_workspace_fk FOREIGN KEY (origin_workspace_id, organization_id) REFERENCES public.workspace(id, organization_id) ON DELETE SET NULL (origin_workspace_id);

ALTER TABLE ONLY public.asset_resource
    ADD CONSTRAINT asset_resource_asset_fk FOREIGN KEY (asset_id) REFERENCES public.asset(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.organization
    ADD CONSTRAINT organization_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.organization_invitation
    ADD CONSTRAINT organization_invitation_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.organization_invitation
    ADD CONSTRAINT organization_invitation_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.organization_member
    ADD CONSTRAINT organization_member_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.organization_member
    ADD CONSTRAINT organization_member_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.placement
    ADD CONSTRAINT placement_anchor_id_fkey FOREIGN KEY (anchor_id) REFERENCES public.asset(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.placement
    ADD CONSTRAINT placement_asset_org_fk FOREIGN KEY (asset_id, organization_id) REFERENCES public.asset(id, organization_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.placement
    ADD CONSTRAINT placement_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.placement
    ADD CONSTRAINT placement_scene_fk FOREIGN KEY (scene_id, organization_id) REFERENCES public.scene(id, organization_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.placement_tag
    ADD CONSTRAINT placement_tag_placement_fk FOREIGN KEY (placement_id, workspace_id) REFERENCES public.placement(id, workspace_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.placement_tag
    ADD CONSTRAINT placement_tag_tag_fk FOREIGN KEY (tag_id, workspace_id) REFERENCES public.tag(id, workspace_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.placement
    ADD CONSTRAINT placement_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(user_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.placement
    ADD CONSTRAINT placement_workspace_fk FOREIGN KEY (workspace_id, organization_id) REFERENCES public.workspace(id, organization_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.scene_asset_ref
    ADD CONSTRAINT scene_asset_ref_asset_fk FOREIGN KEY (asset_id, organization_id) REFERENCES public.asset(id, organization_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.scene_asset_ref
    ADD CONSTRAINT scene_asset_ref_scene_fk FOREIGN KEY (scene_id, organization_id) REFERENCES public.scene(id, organization_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.scene
    ADD CONSTRAINT scene_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.scene
    ADD CONSTRAINT scene_organization_fk FOREIGN KEY (organization_id) REFERENCES public.organization(id);




ALTER TABLE ONLY public.scene
    ADD CONSTRAINT scene_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(user_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.scene
    ADD CONSTRAINT scene_workspace_fk FOREIGN KEY (workspace_id, organization_id) REFERENCES public.workspace(id, organization_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.tag
    ADD CONSTRAINT tag_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.tag
    ADD CONSTRAINT tag_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.upload_receipt
    ADD CONSTRAINT upload_receipt_organization_fk FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.upload_receipt
    ADD CONSTRAINT upload_receipt_workspace_fk FOREIGN KEY (workspace_id, organization_id) REFERENCES public.workspace(id, organization_id) ON DELETE SET NULL (workspace_id);

ALTER TABLE ONLY public.user_organization_pin
    ADD CONSTRAINT user_organization_pin_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_organization_pin
    ADD CONSTRAINT user_organization_pin_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(user_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);

INSERT INTO public.app_config(key,value) VALUES
 ('default_allowed_file_types','["image","video","audio","link","text","anchor"]'::jsonb)
ON CONFLICT(key) DO NOTHING;
INSERT INTO public.schema_migrations(name) VALUES
 ('schema.sql'),
 ('20261008000000_anchor_match_rate_limit_param.sql'),
 ('20261015000000_content_model_foundation.sql'),
 ('20261017120000_team_workbench.sql'),
 ('20261017180000_single_content_model.sql'),
 ('20261017220000_mutable_assets.sql'),
 ('20261018000000_mutable_scenes.sql'),
 ('20261019000000_restore_anchor_placement_tags.sql');


-- BEGIN ACTIVITY SCHEMA (also included in the fresh database baseline)
create table public.activity (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id) on delete restrict,
  type text not null check (type in ('shop_checkin','danmaku')),
  name text not null check (length(btrim(name)) > 0),
  description text,
  config jsonb not null default '{}' check (jsonb_typeof(config) = 'object'),
  location geometry(Point,4326),
  radius_meters double precision,
  constraint activity_radius_valid check (radius_meters>0 and radius_meters<'Infinity'::float8),
  constraint activity_radius_location check ((radius_meters is null) = (location is null)),
  constraint activity_location_valid check (location is null or (st_x(location) between -180 and 180 and st_y(location) between -90 and 90)),
  state text not null default 'active' check (state in ('active','archived')),
  lock_version integer not null default 1 check (lock_version > 0),
  created_by uuid references users(user_id) on delete set null,
  updated_by uuid references users(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,organization_id)
);
create index activity_org_idx on activity(organization_id,state,created_at);
create index activity_location_idx on activity using gist(location);

create table public.activity_point (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null,
  organization_id uuid not null,
  name text not null check (length(btrim(name)) > 0),
  description text,
  ordinal integer not null default 0 check (ordinal >= 0),
  image_asset_id uuid,
  reward_asset_id uuid,
  location geometry(Point,4326),
  constraint activity_point_location_valid check (location is null or (st_x(location) between -180 and 180 and st_y(location) between -90 and 90)),
  state text not null default 'active' check (state in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,activity_id,organization_id),
  foreign key (activity_id,organization_id) references activity(id,organization_id) on delete restrict,
  foreign key (image_asset_id,organization_id) references asset(id,organization_id) on delete restrict,
  foreign key (reward_asset_id,organization_id) references asset(id,organization_id) on delete restrict
);
create index activity_point_activity_idx on activity_point(activity_id,ordinal,id);
create index activity_point_location_idx on activity_point using gist(location);
create index activity_point_image_idx on activity_point(image_asset_id) where image_asset_id is not null;
create index activity_point_reward_idx on activity_point(reward_asset_id) where reward_asset_id is not null;

create table public.activity_placement (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null,
  organization_id uuid not null,
  workspace_id uuid not null,
  status text not null default 'draft' check (status in ('draft','active','paused','archived')),
  lock_version integer not null default 1 check (lock_version > 0),
  created_by uuid references users(user_id) on delete set null,
  updated_by uuid references users(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,activity_id,organization_id),
  constraint activity_placement_activity_workspace_unique unique(activity_id,workspace_id),
  foreign key (activity_id,organization_id) references activity(id,organization_id) on delete restrict,
  foreign key (workspace_id,organization_id) references workspace(id,organization_id) on delete restrict
);
create index activity_placement_workspace_idx on activity_placement(workspace_id,status);
create index activity_placement_activity_idx on activity_placement(activity_id,status);

create table public.activity_record (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  activity_id uuid not null,
  placement_id uuid not null,
  point_id uuid,
  participant_id text check (length(participant_id) between 1 and 128),
  kind text not null check (kind in ('danmaku','checkin')),
  content text,
  location geometry(Point,4326),
  status text not null default 'visible' check (status in ('visible','hidden')),
  idempotency_key text check (length(idempotency_key) between 8 and 128),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  render_config jsonb not null default '{}' check (jsonb_typeof(render_config) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lock_version integer not null default 1 check (lock_version > 0),
  foreign key (placement_id,activity_id,organization_id) references activity_placement(id,activity_id,organization_id) on delete restrict,
  foreign key (point_id,activity_id,organization_id) references activity_point(id,activity_id,organization_id) on delete restrict,
  check ((kind='danmaku' and point_id is null and content is not null) or
    (kind='checkin' and point_id is not null and participant_id is not null and content is null)),
  check (location is null or (st_x(location) between -180 and 180 and st_y(location) between -90 and 90))
);
create index activity_record_activity_idx on activity_record(activity_id,created_at desc,id);
create index activity_record_placement_idx on activity_record(placement_id,status,created_at desc,id);
create index activity_record_location_idx on activity_record using gist(location);
create unique index activity_record_retry_unique on activity_record(placement_id,participant_id,idempotency_key)
  where participant_id is not null and idempotency_key is not null;
create unique index activity_record_checkin_unique on activity_record(placement_id,participant_id,point_id) where kind='checkin';
-- END ACTIVITY SCHEMA

create table migration_archive.activity_source (
  source_table text not null,
  source_key text not null,
  row_data jsonb not null,
  captured_at timestamptz not null default now(),
  primary key(source_table,source_key)
);
create table migration_archive.activity_text_review (
  asset_id uuid primary key,
  source_hash text not null,
  decision text not null check (decision in ('migrate','keep')),
  reason text not null,
  reviewed_at timestamptz not null default now()
);

CREATE OR REPLACE FUNCTION public.purge_organizations(_org_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET "content_model.writer" TO 'purge'
    AS $$
declare
  _ws_ids uuid[];
  _deleted_assets integer := 0;
  _deleted_workspaces integer := 0;
  _deleted_orgs integer := 0;
begin
  select coalesce(array_agg(id), '{}'::uuid[])
  into _ws_ids
  from public.workspace
  where organization_id = any(_org_ids);

  -- Explicit purge of activity participation and definitions, in dependency order.
  delete from public.activity_record where organization_id = any(_org_ids);
  delete from public.activity_placement where organization_id = any(_org_ids);
  delete from public.activity_point where organization_id = any(_org_ids);
  delete from public.activity where organization_id = any(_org_ids);

  -- content model rows (dependency order; everything is organization-scoped)
  delete from public.placement where organization_id = any(_org_ids);
  delete from public.scene where organization_id = any(_org_ids);
  delete from public.upload_receipt where organization_id = any(_org_ids);
  delete from public.content_command_idempotency where organization_id = any(_org_ids);
  -- placements of other organizations never reference these anchors (same-org rule)
  delete from public.asset where organization_id = any(_org_ids);
  get diagnostics _deleted_assets = row_count;

  if array_length(_ws_ids, 1) is not null then
    delete from public.workspace where id = any(_ws_ids);
    get diagnostics _deleted_workspaces = row_count;
  end if;

  -- 级联 organization_member / organization_invitation(organization_id)
  delete from public.organization where id = any(_org_ids);
  get diagnostics _deleted_orgs = row_count;

  return jsonb_build_object(
    'deleted_assets', _deleted_assets,
    'deleted_workspaces', _deleted_workspaces,
    'deleted_orgs', _deleted_orgs
  );
end;
$$;
INSERT INTO public.schema_migrations(name) VALUES ('20261028000000_independent_activities.sql');

-- Exact prior activity placement rows retained across the fixed-location upgrade.
create table migration_archive.activity_location_source (
  source_table text not null,
  source_key text not null,
  row_data jsonb not null,
  captured_at timestamptz not null default now(),
  primary key(source_table,source_key)
);
INSERT INTO public.schema_migrations(name) VALUES ('20261028010000_activity_owned_locations.sql');

-- Copy the effective team display settings once. Maps are independent thereafter.
-- Keep the old organization JSON for rollback evidence; runtime no longer reads it.
ALTER TABLE public.workspace
  ADD COLUMN miniapp_config jsonb NOT NULL DEFAULT '{"retrieval_mode":"gps","text_asset_miniapp_style":"dialog_decorated","confetti_enabled":false,"footer_enabled":false}'::jsonb,
  ADD COLUMN config_lock_version integer NOT NULL DEFAULT 1;

UPDATE public.workspace AS w SET miniapp_config = jsonb_build_object(
  'retrieval_mode', 'gps',
  'text_asset_miniapp_style', CASE WHEN o.config->>'text_asset_miniapp_style' IN ('plain_white', 'dialog_decorated') THEN o.config->>'text_asset_miniapp_style' ELSE 'dialog_decorated' END,
  'confetti_enabled', COALESCE(o.config->'confetti_enabled' = 'true'::jsonb, false),
  'footer_enabled', COALESCE(o.config->'footer_enabled' = 'true'::jsonb, false)
) FROM public.organization AS o WHERE o.id = w.organization_id;

ALTER TABLE public.workspace ADD CONSTRAINT workspace_miniapp_config_check CHECK (
  jsonb_typeof(miniapp_config) = 'object'
  AND miniapp_config ?& ARRAY['retrieval_mode','text_asset_miniapp_style','confetti_enabled','footer_enabled']
  AND miniapp_config - ARRAY['retrieval_mode','text_asset_miniapp_style','confetti_enabled','footer_enabled'] = '{}'::jsonb
  AND jsonb_typeof(miniapp_config->'retrieval_mode') = 'string'
  AND miniapp_config->>'retrieval_mode' IN ('gps','anchor')
  AND jsonb_typeof(miniapp_config->'text_asset_miniapp_style') = 'string'
  AND miniapp_config->>'text_asset_miniapp_style' IN ('plain_white','dialog_decorated')
  AND jsonb_typeof(miniapp_config->'confetti_enabled') = 'boolean'
  AND jsonb_typeof(miniapp_config->'footer_enabled') = 'boolean'
  AND config_lock_version > 0
);

INSERT INTO public.schema_migrations(name) VALUES ('20261108000000_collection_miniapp_config.sql');

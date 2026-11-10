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

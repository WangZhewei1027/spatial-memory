-- Keep existing choices; new maps use GPS for unlinked content and image matching for linked content.
ALTER TABLE public.workspace
  ALTER COLUMN miniapp_config SET DEFAULT '{"retrieval_mode":"hybrid","text_asset_miniapp_style":"dialog_decorated","confetti_enabled":false,"footer_enabled":false}'::jsonb,
  DROP CONSTRAINT workspace_miniapp_config_check;

ALTER TABLE public.workspace ADD CONSTRAINT workspace_miniapp_config_check CHECK (
  jsonb_typeof(miniapp_config) = 'object'
  AND miniapp_config ?& ARRAY['retrieval_mode','text_asset_miniapp_style','confetti_enabled','footer_enabled']
  AND miniapp_config - ARRAY['retrieval_mode','text_asset_miniapp_style','confetti_enabled','footer_enabled'] = '{}'::jsonb
  AND jsonb_typeof(miniapp_config->'retrieval_mode') = 'string'
  AND miniapp_config->>'retrieval_mode' IN ('hybrid','gps','anchor')
  AND jsonb_typeof(miniapp_config->'text_asset_miniapp_style') = 'string'
  AND miniapp_config->>'text_asset_miniapp_style' IN ('plain_white','dialog_decorated')
  AND jsonb_typeof(miniapp_config->'confetti_enabled') = 'boolean'
  AND jsonb_typeof(miniapp_config->'footer_enabled') = 'boolean'
  AND config_lock_version > 0
);

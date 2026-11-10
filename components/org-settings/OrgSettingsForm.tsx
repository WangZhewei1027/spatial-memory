"use client";

import { useTranslation } from "react-i18next";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OrgBasicInfoFields } from "./OrgBasicInfoFields";
import { OrgFormSections } from "./OrgFormSections";
import { useOrgSettingsForm } from "./useOrgSettingsForm";
import type { OrgSettingsSource, SaveOrgSettings } from "./types";
import { Text } from "@/components/ui/typography";

interface OrgSettingsFormProps {
  org: OrgSettingsSource;
  save: SaveOrgSettings;
  onSuccess: () => void;
}

/**
 * 组织设置表单（基本信息 + 地图中心 + 文件类型 + 保存按钮）。
 * super-admin 组织详情面板与 /admin/settings 共用。
 */
export function OrgSettingsForm({ org, save, onSuccess }: OrgSettingsFormProps) {
  const { t } = useTranslation();
  const {
    name,
    setName,
    description,
    setDescription,
    lat,
    setLat,
    lng,
    setLng,
    fileTypes,
    toggleFileType,
    saveError,
    hasChanged,
    handleSave,
    isPending,
  } = useOrgSettingsForm(org, save, onSuccess);

  return (
    <div className="space-y-5">
      <OrgBasicInfoFields
        name={name}
        setName={setName}
        description={description}
        setDescription={setDescription}
      />

      <OrgFormSections
        lat={lat}
        setLat={setLat}
        lng={lng}
        setLng={setLng}
        fileTypes={fileTypes}
        toggleFileType={toggleFileType}
      />

      <div className="border-t" />

      <div className="space-y-2">
        {saveError && (
          <Text as="p" variant="bodySm" tone="critical">
            {saveError}
          </Text>
        )}
        <Button
          onClick={handleSave}
          disabled={!hasChanged || !name.trim() || isPending}
          size="sm"
          className="w-full"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5 mr-2" />
          )}
          {t("superAdmin.orgs.saveChanges", "Save Changes")}
        </Button>
      </div>
    </div>
  );
}

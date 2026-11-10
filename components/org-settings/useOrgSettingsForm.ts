import { useState, useTransition } from "react";
import { DEFAULT_UPLOAD_TYPES, FILE_TYPE_CONFIGS } from "@/lib/upload/config";
import {
  type OrgSettingsSource,
  type SaveOrgSettings,
} from "./types";

export const ALL_FILE_TYPES = Object.keys(FILE_TYPE_CONFIGS) as Array<
  keyof typeof FILE_TYPE_CONFIGS
>;

function sameSet(a: Set<string>, b: readonly string[]) {
  return a.size === b.length && b.every((t) => a.has(t));
}

/**
 * 组织设置表单状态。落库方式由 save 回调注入：
 * super-admin 传 updateOrganization server action，/admin 传 PUT API。
 */
export function useOrgSettingsForm(
  org: OrgSettingsSource,
  save: SaveOrgSettings,
  onSuccess: () => void,
) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(org.name);
  const [description, setDescription] = useState(org.description ?? "");
  const [lat, setLat] = useState(
    org.map_center?.lat != null ? String(org.map_center.lat) : "",
  );
  const [lng, setLng] = useState(
    org.map_center?.lng != null ? String(org.map_center.lng) : "",
  );
  // allowed_file_types 为 null 时，上传面板实际生效的是 DEFAULT_UPLOAD_TYPES，
  // 表单必须按同一集合展示，否则界面与真实行为不一致
  const fileTypesBaseline = org.allowed_file_types ?? DEFAULT_UPLOAD_TYPES;
  const [fileTypes, setFileTypes] = useState<Set<string>>(
    new Set(fileTypesBaseline),
  );
  const [saveError, setSaveError] = useState("");

  const hasChanged =
    name !== org.name ||
    description !== (org.description ?? "") ||
    lat !== (org.map_center?.lat != null ? String(org.map_center.lat) : "") ||
    lng !== (org.map_center?.lng != null ? String(org.map_center.lng) : "") ||
    !sameSet(fileTypes, fileTypesBaseline);

  const toggleFileType = (type: string) => {
    setFileTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const handleSave = () => {
    if (!name.trim()) return;
    setSaveError("");

    const latNum = lat.trim() ? parseFloat(lat) : null;
    const lngNum = lng.trim() ? parseFloat(lng) : null;
    const mapCenter =
      latNum != null && lngNum != null && !isNaN(latNum) && !isNaN(lngNum)
        ? { lat: latNum, lng: lngNum }
        : null;

    // 没动过文件类型就保持原值（null 不被改写成显式数组）；
    // 动过则存显式数组 —— null 只代表默认集合而非"全部"，
    // 全选 9 项时必须落显式数组，document / model 才真正生效
    const fileTypesPayload = sameSet(fileTypes, fileTypesBaseline)
      ? (org.allowed_file_types ?? null)
      : [...fileTypes];

    startTransition(async () => {
      const result = await save({
        name: name.trim(),
        description: description.trim() || null,
        map_center: mapCenter,
        allowed_file_types: fileTypesPayload,
      });
      if (result.error) {
        setSaveError(result.error);
      } else {
        onSuccess();
      }
    });
  };

  return {
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
  };
}

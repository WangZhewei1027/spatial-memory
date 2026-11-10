import type { LinkAssetData } from "@/lib/link-asset";

export interface LocationData {
  longitude: number;
  latitude: number;
  height: number;
}

export interface Organization {
  archived_at?: string | null;
  id: string;
  name: string;
  description: string | null;
  role?: string; // user's role in this organization
  map_center?: { lat: number; lng: number } | null;
  allowed_file_types?: string[] | null;
  pinned_at?: string | null; // 当前用户的置顶时间（user_organization_pin）
}

export interface Workspace {
  id: string;
  name: string;
  description: string | null;
  organization_id?: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  workspace_id: string;
  created_at?: string;
  created_by?: string | null;
}

export interface Creator {
  user_id: string;
  name: string;
  email: string;
}

export interface Asset {
  id: string;
  workspace_id?: string[];
  name?: string | null; // 资源名称（特别是 anchor 类型）
  file_type: string;
  file_url: string | null;
  content_hash?: string | null; // 文件内容 SHA-256，用于全局去重
  text_content?: string | null; // 文本类型的内容
  anchor_id?: string | null; // 关联的锚点ID
  tag_ids?: string[]; // 关联的标签ID数组
  is_huge?: boolean | null; // 是否为大型模型（仅 model 类型）
  config?: {
    scale_multiplier?: number; // 模型缩放倍率（相对于归一化后的大小）
    text_color?: string; // 文字颜色，十六进制 e.g. #FFFFFF（仅 text 类型）
    text_size?: number; // 文字大小，XR-Frame size 单位（仅 text 类型）
    link?: LinkAssetData; // 链接原地址、预览地址与解析类型（仅 link 类型）
    [key: string]: unknown;
  } | null;
  created_by?: string | null; // 创建者用户ID
  metadata: {
    longitude?: number;
    latitude?: number;
    height?: number;
    gps_source?: string;
    // 音频元数据
    duration?: number;
    sampleRate?: number;
    numberOfChannels?: number;
    length?: number;
    // 图片元数据
    dimensions?: {
      width: number;
      height: number;
    };
  };
}

// iframe 通信消息类型
export type ViewerMessageType =
  | "SET_WORKSPACE"
  | "SET_ASSETS"
  | "LOCATION_CLICKED"
  | "ASSET_CLICKED"
  | "ASSETS_UPDATE"
  | "VIEWER_READY"
  | "FOCUS_ASSET"
  | "CAMERA_POSITION"
  | "ASSETS_MOVED"
  | "ASSETS_SELECTED"
  | "SET_SELECTION"
  | "CLEAR_SELECTION";

export interface ViewerMessage {
  type: ViewerMessageType;
  payload: unknown;
  source?: string;
  version?: number;
}

export type MatchingStatus =
  | "status_error"
  | "saving"
  | "unsaved"
  | "loading"
  | "missing_image"
  | "pending"
  | "ready"
  | "failed"
  | "unconfigured"
  | "processing";
export interface MatchingPointPanelProps {
  imageUrl: string | null;
  imageFile: File | null;
  isEditing: boolean;
  status: MatchingStatus;
  error?: string | null;
  statusError?: string | null;
  updatedAt?: string | null;
  onRefresh?: () => void;
  canManage: boolean;
  childrenAssets: { id: string; name: string }[];
  availableAssets: { id: string; name: string }[];
  attaching?: boolean;
  onImageSelect: (file: File) => void;
  onImageRemove: () => void;
  onAttach: (id: string) => void;
  onDetach: (id: string) => void;
}

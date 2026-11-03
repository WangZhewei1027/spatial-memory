"use client";

import { isSpecificWorkspaceId } from "@/app/manage/constants";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Text } from "@/components/ui/typography";
import { fetchJson } from "@/lib/fetch-json";
import { AlertCircle, Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CleanLog } from "./components/CleanLog";

type CleanAction = "clean-rows" | "clean-files" | "both";

interface CleanResult {
  orphanedRows: {
    id: string;
    file_url: string;
    reason: string;
  }[];
  orphanedFiles: {
    path: string;
    name: string;
  }[];
  deletedRows: string[];
  deletedFiles: string[];
  errors: string[];
}

interface CleanSummary {
  orphanedRowsFound: number;
  orphanedFilesFound: number;
  rowsDeleted: number;
  filesDeleted: number;
  errorsCount: number;
}

interface OrgOption {
  id: string;
  name: string;
}

interface WorkspaceOption {
  id: string;
  name: string;
}

export default function CleanPage() {
  const { t } = useTranslation();
  // super_admin 全局页面：组织取全量（/api/admin/organizations），工作空间列表
  // 由所选组织驱动（effect 联动），避免独立 hook 实例与组织切换不同步的问题
  const [organizations, setOrganizations] = useState<OrgOption[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<
    string | null
  >(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [result, setResult] = useState<CleanResult | null>(null);
  const [summary, setSummary] = useState<CleanSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ data: OrgOption[] }>("/api/admin/organizations")
      .then((res) => {
        if (cancelled) return;
        const orgs = res.data || [];
        setOrganizations(orgs);
        setSelectedOrganizationId(orgs[0]?.id ?? null);
      })
      .catch((error) => {
        console.error("获取组织列表失败:", error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 切换组织 → 重新拉取该组织的工作空间并重置选中项
  useEffect(() => {
    if (!selectedOrganizationId) {
      setWorkspaces([]);
      setSelectedWorkspaceId(null);
      return;
    }
    let cancelled = false;
    setWorkspaces([]);
    setSelectedWorkspaceId(null);
    fetchJson<{ data: WorkspaceOption[] }>(
      `/api/organizations/${selectedOrganizationId}/collections`,
    )
      .then((res) => {
        if (cancelled) return;
        const list = res.data || [];
        setWorkspaces(list);
        setSelectedWorkspaceId(list[0]?.id ?? null);
      })
      .catch((error) => {
        console.error("获取工作空间失败:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedOrganizationId]);

  const handleClean = async (action: CleanAction) => {
    // clean-files 是全桶清扫，与 workspace 无关；仅涉及 clean-rows 时需要选定
    const needsWorkspace = action !== "clean-files";
    if (needsWorkspace && !isSpecificWorkspaceId(selectedWorkspaceId)) {
      toast.error(t("admin.clean.selectWorkspaceFirst"));
      return;
    }

    if (
      !confirm(
        t("admin.clean.confirmMessage") +
          "\n\n" +
          `${
            action === "clean-rows"
              ? t("admin.clean.willDeleteRows") + "\n"
              : ""
          }` +
          `${
            action === "clean-files"
              ? t("admin.clean.willDeleteFiles") + "\n"
              : ""
          }` +
          `${
            action === "both"
              ? t("admin.clean.willDeleteRows") +
                "\n" +
                t("admin.clean.willDeleteFiles") +
                "\n"
              : ""
          }` +
          "\n" +
          t("admin.clean.irreversible"),
      )
    ) {
      return;
    }

    setCleaning(true);
    setResult(null);
    setSummary(null);

    try {
      const data = await fetchJson<{ data: CleanResult; summary: CleanSummary }>(
        "/api/admin/clean",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workspaceId: needsWorkspace ? selectedWorkspaceId : undefined,
            action,
          }),
        },
      );

      setResult(data.data);
      setSummary(data.summary);
    } catch (error) {
      // fetchJson 已弹 toast
      console.error("清理失败:", error);
    } finally {
      setCleaning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Trash2 className="h-7 w-7" />
          <Text as="h1" variant="headingLg" fontWeight="bold">{t("admin.clean.title")}</Text>
        </div>
        <p className="text-muted-foreground">{t("admin.clean.description")}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>清理操作</CardTitle>
              <CardDescription>选择组织、工作空间和清理类型</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 组织选择：切换后 useWorkspace 会重新拉取该组织的工作空间列表 */}
              <div className="space-y-2">
                <label className="text-sm font-medium">组织</label>
                <Select
                  value={selectedOrganizationId || ""}
                  onValueChange={setSelectedOrganizationId}
                  disabled={cleaning}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择组织" />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 工作空间选择（仅清理孤立记录需要） */}
              <div className="space-y-2">
                <label className="text-sm font-medium">工作空间</label>
                <Select
                  value={selectedWorkspaceId || ""}
                  onValueChange={setSelectedWorkspaceId}
                  disabled={cleaning}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择工作空间" />
                  </SelectTrigger>
                  <SelectContent>
                    {workspaces.map((ws) => (
                      <SelectItem key={ws.id} value={ws.id}>
                        {ws.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 清理按钮 */}
              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  disabled={!selectedWorkspaceId || cleaning}
                  onClick={() => handleClean("clean-rows")}
                >
                  {cleaning ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4 mr-2" />
                  )}
                  清理孤立数据库记录
                </Button>

                <Button
                  variant="outline"
                  className="w-full justify-start"
                  disabled={cleaning}
                  onClick={() => handleClean("clean-files")}
                >
                  {cleaning ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4 mr-2" />
                  )}
                  清理孤立存储文件（全局）
                </Button>

                <Button
                  variant="destructive"
                  className="w-full justify-start"
                  disabled={!selectedWorkspaceId || cleaning}
                  onClick={() => handleClean("both")}
                >
                  {cleaning ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4 mr-2" />
                  )}
                  全面清理
                </Button>
              </div>

              {/* 说明 */}
              <div className="p-4 bg-warning/10 border border-warning/30 rounded-lg">
                <div className="flex gap-2">
                  <AlertCircle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-warning">
                    <p className="font-medium mb-1">注意事项：</p>
                    <ul className="list-disc list-inside space-y-1 text-xs">
                      <li>清理操作不可逆，请谨慎操作</li>
                      <li>孤立记录：数据库中存在但文件已被删除（按所选工作空间）</li>
                      <li>孤立文件：全桶扫描无任何记录引用的文件（24 小时内的新文件跳过）</li>
                      <li>建议先单独清理，确认无误后再全面清理</li>
                    </ul>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          {summary && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>清理摘要</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600">
                      {summary.orphanedRowsFound}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      孤立记录
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">
                      {summary.orphanedFilesFound}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      孤立文件
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-success">
                      {summary.rowsDeleted}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      已删记录
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-success">
                      {summary.filesDeleted}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      已删文件
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-destructive">
                      {summary.errorsCount}
                    </div>
                    <div className="text-sm text-muted-foreground">错误</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {result && <CleanLog result={result} />}

          {!result && !cleaning && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Trash2 className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  选择组织、工作空间和清理类型开始清理
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

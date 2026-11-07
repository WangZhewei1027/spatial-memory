"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/typography";
import { fetchJson } from "@/lib/fetch-json";

interface OrganizationSetting {
  id: string;
  name: string;
  archived_at: string | null;
  enabled: boolean;
}

export default function MapScanModelPage() {
  const { t } = useTranslation();
  const [organizations, setOrganizations] = useState<OrganizationSetting[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const pending = useRef(new Set<string>());

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    void (async () => {
      try {
        const response = await fetch("/api/admin/map-scan-model", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Could not load organizations");
        const body: { data: OrganizationSetting[] } = await response.json();
        if (!controller.signal.aborted) {
          setOrganizations(body.data);
          setStatus("ready");
        }
      } catch {
        if (!controller.signal.aborted) setStatus("error");
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  async function toggle(organization: OrganizationSetting, enabled: boolean) {
    if (pending.current.has(organization.id)) return;
    pending.current.add(organization.id);
    setSaving(new Set(pending.current));
    try {
      const { data } = await fetchJson<{ data: { organizationId: string; enabled: boolean } }>("/api/admin/map-scan-model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: organization.id, enabled }),
      });
      setOrganizations((rows) => rows.map((row) => row.id === data.organizationId ? { ...row, enabled: data.enabled } : row));
      toast.success(t("superAdmin.mapScanModel.saved", { name: organization.name }));
    } catch {
      // fetchJson displays the error; keep the last confirmed setting.
    } finally {
      pending.current.delete(organization.id);
      setSaving(new Set(pending.current));
    }
  }

  const query = search.trim().toLowerCase();
  const visible = organizations.filter((row) => row.name.toLowerCase().includes(query) || row.id.includes(query));

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 lg:p-8">
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Box className="size-7 shrink-0" aria-hidden />
          <Text as="h1" variant="headingXl">{t("superAdmin.mapScanModel.title")}</Text>
        </div>
        <Text as="p" variant="bodyMd" tone="subdued">{t("superAdmin.mapScanModel.description")}</Text>
        <Text as="p" variant="bodySm" tone="subdued">{t("superAdmin.mapScanModel.effect")}</Text>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)}
          placeholder={t("superAdmin.mapScanModel.search")} aria-label={t("superAdmin.mapScanModel.search")} />
      </div>

      {status === "loading" && (
        <div className="flex items-center justify-center gap-2 py-12" role="status">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          <Text as="span" variant="bodySm" tone="subdued">{t("common.loading")}</Text>
        </div>
      )}
      {status === "error" && (
        <div className="space-y-4 rounded-lg border p-6" role="alert">
          <Text as="p" variant="bodyMd">{t("superAdmin.mapScanModel.loadFailed")}</Text>
          <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>{t("superAdmin.mapScanModel.retry")}</Button>
        </div>
      )}
      {status === "ready" && (
        <div className="space-y-3">
          <Text as="p" variant="bodySm" tone="subdued">
            {t("superAdmin.mapScanModel.count", { enabled: organizations.filter((row) => row.enabled).length, total: organizations.length })}
          </Text>
          {visible.length === 0 ? (
            <Text as="p" variant="bodyMd" tone="subdued" className="py-12" alignment="center">{t("superAdmin.mapScanModel.empty")}</Text>
          ) : (
            <ul className="divide-y rounded-lg border">
              {visible.map((organization) => (
                <li key={organization.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
                  <div className="min-w-0 flex-1 basis-48 space-y-1">
                    <Text as="h2" variant="bodyMd" fontWeight="semibold" breakWord>{organization.name}</Text>
                    <Text as="p" variant="bodyXs" tone="subdued" breakWord>{organization.id}</Text>
                    {organization.archived_at && <Badge variant="outline">{t("superAdmin.mapScanModel.archived")}</Badge>}
                  </div>
                  <div className="flex min-h-11 items-center gap-3">
                    {saving.has(organization.id) && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
                    <label htmlFor={`scan-model-${organization.id}`} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                      <Checkbox id={`scan-model-${organization.id}`} checked={organization.enabled}
                        disabled={saving.has(organization.id)}
                        aria-label={t("superAdmin.mapScanModel.toggle", { name: organization.name })}
                        onCheckedChange={(checked) => void toggle(organization, checked === true)} />
                      {t(organization.enabled ? "superAdmin.mapScanModel.enabled" : "superAdmin.mapScanModel.disabled")}
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

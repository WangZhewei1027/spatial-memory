"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Building2, Check, ChevronsUpDown, Pin } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { useManageStore } from "@/app/manage/store";
import { cn } from "@/lib/utils";
import type { Organization } from "@/app/manage/types";

export function OrgSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const organizations = useManageStore((state) => state.organizations);
  const selectedOrganizationId = useManageStore(
    (state) => state.selectedOrganizationId,
  );
  const selectedOrganization = useManageStore(
    (state) => state.selectedOrganization,
  );
  const setSelectedOrganizationId = useManageStore(
    (state) => state.setSelectedOrganizationId,
  );
  const setSelectedOrganization = useManageStore(
    (state) => state.setSelectedOrganization,
  );
  const setOrganizations = useManageStore((state) => state.setOrganizations);
  const loading = useManageStore((state) => state.organizationLoading);

  const handleSelect = (orgId: string) => {
    setSelectedOrganizationId(orgId);
    const org = organizations.find((o) => o.id === orgId);
    setSelectedOrganization(org || null);
    setOpen(false);
  };

  // 乐观更新本地列表，失败时回滚并提示。持久化在 user_organization_pin 表。
  const handleTogglePin = async (org: Organization) => {
    const nextPinned = !org.pinned_at;
    const prev = organizations;
    setOrganizations(
      organizations.map((o) =>
        o.id === org.id
          ? { ...o, pinned_at: nextPinned ? new Date().toISOString() : null }
          : o,
      ),
    );
    const res = await fetch("/api/organizations/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: org.id, pinned: nextPinned }),
    }).catch(() => null);
    if (!res?.ok) {
      setOrganizations(prev);
      toast.error(t("organization.pinError", "Failed to update pin"));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground">
        <div className="h-4 w-4 animate-pulse rounded bg-muted" />
        <span className="hidden sm:inline">{t("common.loading")}</span>
      </div>
    );
  }

  if (organizations.length === 0) {
    return null;
  }

  // 置顶区按置顶时间排序（先置顶的在前），其余保持接口返回顺序
  const pinnedOrgs = organizations
    .filter((o) => o.pinned_at)
    .sort((a, b) => (a.pinned_at! < b.pinned_at! ? -1 : 1));
  const otherOrgs = organizations.filter((o) => !o.pinned_at);

  const renderItem = (org: Organization) => {
    const pinned = !!org.pinned_at;
    return (
      <CommandItem
        key={org.id}
        value={org.id}
        keywords={[org.name]}
        onSelect={() => handleSelect(org.id)}
        className="group cursor-pointer"
      >
        <Building2 className="text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{org.name}</span>
        {org.id === selectedOrganizationId && <Check className="text-primary" />}
        <button
          type="button"
          aria-label={
            pinned
              ? t("organization.unpin", "Unpin")
              : t("organization.pin", "Pin")
          }
          // Stop pointer events so toggling the pin never selects the row
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            handleTogglePin(org);
          }}
          className={cn(
            "rounded-sm p-1 hover:bg-muted",
            pinned
              ? "text-primary"
              : "text-muted-foreground opacity-0 group-hover:opacity-100 group-data-[selected=true]:opacity-100",
          )}
        >
          <Pin />
        </button>
      </CommandItem>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          title={selectedOrganization?.name || t("organization.selectPlaceholder", "Select organization")}
          className={cn(
            "flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-1.5 h-auto min-w-0 font-medium text-sm max-w-[110px] sm:max-w-[180px]",
            className,
          )}
        >
          <Building2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <span className="truncate">
            {selectedOrganization?.name ||
              t("organization.selectPlaceholder", "Select organization")}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[240px] p-0">
        <Command
          // Exact substring match on the org name (CJK-friendly), instead of
          // cmdk's fuzzy scoring over the value (which is the org id here)
          filter={(value, search, keywords) => {
            const haystack = (keywords ?? []).join(" ").toLowerCase();
            return haystack.includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput
            placeholder={t("organization.searchPlaceholder", "Search…")}
          />
          {/* 512px cap, further clamped to the viewport space below the trigger */}
          <CommandList className="max-h-[min(512px,var(--radix-popover-content-available-height))]">
            <CommandEmpty>
              {t("organization.noResults", "No organizations found")}
            </CommandEmpty>
            {pinnedOrgs.length > 0 && (
              <CommandGroup heading={t("organization.pinned", "Pinned")}>
                {pinnedOrgs.map(renderItem)}
              </CommandGroup>
            )}
            {pinnedOrgs.length > 0 && otherOrgs.length > 0 && (
              <CommandSeparator />
            )}
            {otherOrgs.length > 0 && (
              <CommandGroup
                heading={t("organization.switchTitle", "Organizations")}
              >
                {otherOrgs.map(renderItem)}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

"use client";

import { useId, useRef, useState, type FormEvent, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { ActivityDto, ActivityType } from "@/lib/activities/contracts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { activityApi } from "../../lib/activity-api";
import { ActivityFailure } from "./ActivityFeedback";

/** The map entry uses the same form, creating its initial association atomically. */
export function ActivityCreateDialog({ organizationId, workspaceId, onCreated, children }: {
  organizationId: string;
  workspaceId?: string;
  onCreated: (activity: ActivityDto) => void;
  children: ReactElement;
}) {
  const { t } = useTranslation();
  const nameId = useId(), typeId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<ActivityType>("shop_checkin");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const intent = useRef<string | null>(null);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || !name.trim()) return;
    setPending(true); setError(null);
    intent.current ??= crypto.randomUUID();
    try {
      const activity = await activityApi.create(organizationId, {
        name: name.trim(), type, idempotencyKey: intent.current, ...(workspaceId ? { workspaceId } : {}),
      });
      setOpen(false); setName(""); intent.current = null;
      onCreated(activity);
    } catch (failure) { setError(failure); } finally { setPending(false); }
  };

  return (
    <Dialog open={open} onOpenChange={next => { if (!pending) { setOpen(next); if (next) setError(null); } }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent aria-describedby={undefined} showCloseButton={!pending}>
        <form onSubmit={create} className="space-y-4">
          <DialogHeader><DialogTitle>{t(workspaceId ? "activities.createAndLink" : "activities.create")}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor={nameId}>{t("activities.name")}</Label>
              <Input id={nameId} autoFocus required maxLength={200} value={name} disabled={pending}
                onChange={event => { setName(event.target.value); intent.current = null; }} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={typeId}>{t("activities.type")}</Label>
              <Select value={type} disabled={pending} onValueChange={value => { setType(value as ActivityType); intent.current = null; }}>
                <SelectTrigger id={typeId} className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="shop_checkin">{t("activities.types.shop_checkin")}</SelectItem>
                  <SelectItem value="danmaku">{t("activities.types.danmaku")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <ActivityFailure error={error} />
          <DialogFooter>
            <Button variant="outline" type="button" disabled={pending} onClick={() => setOpen(false)}>{t("activities.cancel")}</Button>
            <Button type="submit" disabled={pending || !name.trim()}>{t(pending ? "activities.saving" : "activities.create")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

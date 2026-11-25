"use client";

import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Text } from "@/components/ui/typography";
import { WECHAT_QR_ENVIRONMENTS, isWeChatQrEnvironment, type WeChatQrEnvironment } from "@/lib/wechat-qr";

export function WeChatQrSettings({ environment, onEnvironmentChange, children }: {
  children: ReactNode;
  environment: WeChatQrEnvironment;
  onEnvironmentChange: (value: WeChatQrEnvironment) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <section className="border rounded-lg p-6 space-y-4" aria-labelledby={`${id}-title`}>
      <Text as="h2" variant="headingMd" id={`${id}-title`}>
        {t("admin.settings.wechatQr.title")}
      </Text>
      <div className="space-y-2">
        <Label htmlFor={id}>{t("admin.settings.wechatQr.label")}</Label>
        <Select value={environment} onValueChange={(value) => {
          if (isWeChatQrEnvironment(value)) onEnvironmentChange(value);
        }}>
          <SelectTrigger id={id} className="w-full sm:w-64" aria-describedby={`${id}-description`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WECHAT_QR_ENVIRONMENTS.map((value) => (
              <SelectItem key={value} value={value}>{t(`admin.settings.wechatQr.versions.${value}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Text as="p" variant="bodySm" tone="subdued" id={`${id}-description`}>
          {t("admin.settings.wechatQr.description")}
        </Text>
      </div>
      {children}
    </section>
  );
}

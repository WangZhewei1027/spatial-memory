"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ShieldAlert, Home, ArrowLeft } from "lucide-react";

export default function ForbiddenPage() {
  const { t } = useTranslation();

  return (
    <div className="min-h-[calc(100dvh-var(--app-navbar-height))] flex items-center justify-center p-4 bg-gradient-to-b from-background to-muted/20">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center pb-4">
          <div className="flex justify-center mb-4">
            <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center">
              <ShieldAlert className="h-10 w-10 text-destructive" />
            </div>
          </div>
          <CardTitle className="text-3xl font-bold">403</CardTitle>
          <CardDescription className="text-lg mt-2">
            {t("errors.forbidden.description", "Access Denied")}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center space-y-6">
          <div className="space-y-2">
            <p className="text-muted-foreground">
              {t(
                "errors.forbidden.message",
                "Sorry, you don't have permission to access this page.",
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              {t(
                "errors.forbidden.contact",
                "If you believe this is a mistake, please contact an administrator.",
              )}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-4">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t("errors.forbidden.goBack", "Go Back")}
            </Button>
            <Link href="/" className="flex-1">
              <Button className="w-full">
                <Home className="h-4 w-4 mr-2" />
                {t("common.backHome", "Back to Home")}
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

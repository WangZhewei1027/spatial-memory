"use client";

import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { AuthButton, AuthDivider, AuthError, AuthFormShell } from "@/components/auth-form-shell";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { Text } from "@/components/ui/typography";
import { authClient } from "@/lib/auth/client";
import { cliLoginCallbackUrl, isCliLoginToken, parseCliLoginRequest } from "@/lib/auth/cli-login";
import { useGoogleSignIn } from "@/lib/auth/use-google-sign-in";

export function CliLoginForm() {
  const { t } = useTranslation();
  const params = useSearchParams();
  const { data: session, isPending } = authClient.useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const request = ["redirect_uri", "code_challenge", "state"].every(key => params.getAll(key).length === 1)
    ? parseCliLoginRequest({ redirectUri: params.get("redirect_uri"), codeChallenge: params.get("code_challenge"), state: params.get("state") })
    : null;
  const next = request ? `/auth/cli?${new URLSearchParams({ redirect_uri: request.redirectUri, code_challenge: request.codeChallenge, state: request.state })}` : "/auth/cli";
  const google = useGoogleSignIn(next, `${next}${request ? "&" : "?"}error=google`);

  const authorize = async () => {
    if (!request || !session || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/cli/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        credentials: "same-origin",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(response.status === 401 ? "session" : "request");
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || !("redirectUrl" in result) || typeof result.redirectUrl !== "string") throw new Error("request");
      const callback = new URL(result.redirectUrl);
      const code = callback.searchParams.get("code");
      if (!isCliLoginToken(code) || result.redirectUrl !== cliLoginCallbackUrl(request, { code })) throw new Error("request");
      window.location.assign(result.redirectUrl);
    } catch (cause) {
      setError(t(cause instanceof Error && cause.message === "session" ? "auth.cli.sessionExpired" : "auth.cli.failed"));
      setBusy(false);
      submitting.current = false;
    }
  };

  return (
    <AuthFormShell title={t("auth.cli.title")} description={t("auth.cli.description")}>
      {!request ? <AuthError>{t("auth.cli.invalid")}</AuthError> : (
        <div className="space-y-6">
          <Text as="p" tone="subdued">{t("auth.cli.confirmLocal")}</Text>
          {isPending ? <Text as="p" role="status">{t("common.loading")}</Text> : (
            <>
              {session && (
                <>
                  <div className="rounded-lg border bg-muted/40 p-4">
                    <Text as="p" variant="bodySm" tone="subdued">{t("auth.cli.account")}</Text>
                    {session.user.name && <Text as="p" fontWeight="medium" breakWord>{session.user.name}</Text>}
                    <Text as="p" variant="bodySm" tone="subdued" breakWord>{session.user.email}</Text>
                  </div>
                  <Text as="p" tone="subdued">{t("auth.cli.permissions")}</Text>
                  <AuthButton onClick={authorize} disabled={busy || google.isLoading} aria-busy={busy}>
                    {t(busy ? "auth.cli.authorizing" : "auth.cli.authorize")}
                  </AuthButton>
                  <AuthDivider />
                </>
              )}
              <GoogleSignInButton onSignIn={google.signIn} isLoading={google.isLoading} disabled={busy}
                error={google.error ?? (params.get("error") ? t("auth.errors.googleFailed") : null)}
                className="h-auto min-h-12 rounded-full shadow-none" />
              <AuthError>{error}</AuthError>
            </>
          )}
          <AuthButton variant="ghost" disabled={busy || google.isLoading} onClick={() => window.location.assign(cliLoginCallbackUrl(request, { error: "access_denied" }))}>
            {t("common.cancel")}
          </AuthButton>
        </div>
      )}
    </AuthFormShell>
  );
}

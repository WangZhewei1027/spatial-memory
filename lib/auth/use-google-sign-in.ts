"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "@/lib/auth/client";
import { formatAuthError } from "@/lib/auth/auth-error";
import { safeNext } from "@/lib/safe-next";

export function useGoogleSignIn(next: string, errorReturn?: string) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();

  const signIn = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const callbackURL = safeNext(next);
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL,
        errorCallbackURL: errorReturn ? safeNext(errorReturn) : `/auth/login?next=${encodeURIComponent(callbackURL)}&error=google`,
      });
      if (result.error) throw result.error;
      // The auth client redirects to Google; keep the button disabled until then.
    } catch (error: unknown) {
      setError(formatAuthError(t, error));
      setIsLoading(false);
    }
  };

  return { signIn, isLoading, error };
}

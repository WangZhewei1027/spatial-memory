"use client";

import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { resolveLanguage, type Language } from "@/lib/i18n/settings";

export function GuideContent(guides: Record<Language, ReactNode>) {
  const { i18n } = useTranslation();
  const language = resolveLanguage(i18n.language);

  useEffect(() => {
    const chapter = window.location.hash.slice(1);
    if (chapter) document.getElementById(chapter)?.scrollIntoView();
  }, [language]);

  return guides[language];
}

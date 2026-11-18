"use client";

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Languages } from "lucide-react";
import { applyLanguage } from "@/components/i18n-provider";
import type { Language } from "@/lib/i18n/settings";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = useRef(false);

  function selectLanguage(language: Language) {
    selected.current = true;
    applyLanguage(language);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button ref={trigger} variant="ghost" size="icon" className="w-9 h-9">
          <Languages className="h-4 w-4" />
          <span className="sr-only">切换语言 / Switch language</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (!selected.current) return;
          selected.current = false;
          // Keep the translated chapter in view when focus returns to the header.
          event.preventDefault();
          trigger.current?.focus({ preventScroll: true });
        }}
      >
        <DropdownMenuItem
          onSelect={() => selectLanguage("zh")}
          className={i18n.language === "zh" ? "bg-accent" : ""}
        >
          中文
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => selectLanguage("en")}
          className={i18n.language === "en" ? "bg-accent" : ""}
        >
          English
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

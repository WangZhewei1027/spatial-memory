import { TeamProvider } from "@/app/manage/components/TeamProvider";
import { ErrorReporter } from "@/components/error-reporter";
import { I18nProvider } from "@/components/i18n-provider";
import { Navbar } from "@/components/navbar";
import { Toaster } from "@/components/ui/sonner";
import { geistSans } from "@/lib/fonts";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_COOKIE,
  resolveLanguage,
} from "@/lib/i18n/settings";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import "./globals.css";

const defaultUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Spatial Memory",
  description:
    "Create and explore location-based digital experiences with Spatial Memory through augmented reality and interactive maps",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

// cacheComponents 模式下 cookies() 只能在 Suspense 边界内访问,
// 所以语言解析放在这个异步子组件里,而不是布局顶层
async function I18nFromCookie({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const lang = resolveLanguage(cookieStore.get(LANGUAGE_COOKIE)?.value);
  return <I18nProvider lang={lang}>{children}</I18nProvider>;
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang={DEFAULT_LANGUAGE} suppressHydrationWarning>
      <body className={`${geistSans.variable} font-sans antialiased`}>
        {/* <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        > */}
        <Suspense fallback={null}>
          <I18nFromCookie>
            <TeamProvider>
              <Navbar />
              {children}
            </TeamProvider>
          </I18nFromCookie>
        </Suspense>
        <Toaster />
        <ErrorReporter />
        {/* </ThemeProvider> */}
      </body>
    </html>
  );
}

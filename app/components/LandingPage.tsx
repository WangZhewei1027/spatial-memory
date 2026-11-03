"use client";

import Link from "next/link";
import Image from "next/image";
import { useTranslation } from "react-i18next";
import {
  Camera,
  Map,
  ScanLine,
  Users,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";

const FEATURES: { key: string; Icon: LucideIcon }[] = [
  { key: "capture", Icon: Camera },
  { key: "map", Icon: Map },
  { key: "ar", Icon: ScanLine },
  { key: "org", Icon: Users },
];

const WORKFLOW_STEPS = ["step1", "step2", "step3"] as const;

export function LandingPage({ cta }: { cta: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const guideLang = i18n.language?.startsWith("en") ? "en" : "zh";

  return (
    <main className="overflow-hidden">
      {/* Hero */}
      <section className="relative flex flex-col items-center justify-center gap-6 px-6 pt-24 pb-28 text-center min-h-[calc(85vh-3.5rem)]">
        {/* Decorative glow, semantic tokens only */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
        >
          <div className="absolute left-1/2 top-0 h-96 w-[48rem] max-w-full -translate-x-1/2 rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute left-1/4 bottom-0 h-64 w-96 -translate-x-1/2 rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
        </div>

        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
          <span className="inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
            {t("home.badge")}
          </span>
        </div>

        <h1 className="text-display md:text-display-lg font-bold max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 fill-mode-backwards">
          {t("home.hero.title")}
        </h1>

        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200 fill-mode-backwards">
          <Text as="p" variant="bodyMd" tone="subdued" className="max-w-xl">
            {t("home.hero.description")}
          </Text>
        </div>

        <div className="flex items-center gap-3 pt-2 min-h-11 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300 fill-mode-backwards">
          {cta}
          <Button asChild variant="ghost" size="lg">
            <Link href={`/instructions/${guideLang}`}>
              {t("home.cta.instructions")}
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div className="animate-in fade-in duration-700 delay-500 fill-mode-backwards">
          <Text as="p" variant="bodySm" tone="subdued">
            {t("home.hero.subtitle")}
          </Text>
        </div>

        {/* 产品截图：3D 地图工作台 */}
        <div className="mt-10 w-full max-w-4xl animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-300 fill-mode-backwards">
          <div className="rounded-xl border bg-background shadow-2xl overflow-hidden">
            <Image
              src="/images/landing/workspace.webp"
              alt={t("home.heroShotAlt")}
              width={1600}
              height={901}
              priority
              className="w-full h-auto"
            />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-20 border-t bg-muted/30">
        <div className="mx-auto max-w-5xl flex flex-col gap-10">
          <div className="flex flex-col items-center gap-3 text-center">
            <Text as="h2" variant="headingLg">
              {t("home.features.title")}
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued" className="max-w-xl">
              {t("home.features.subtitle")}
            </Text>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ key, Icon }) => (
              <div
                key={key}
                className="group rounded-xl border bg-background p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="h-5 w-5" />
                </div>
                <Text as="h3" variant="headingMd" className="mb-2">
                  {t(`home.features.${key}.title`)}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t(`home.features.${key}.desc`)}
                </Text>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Gallery: street → scan → mesh */}
      <section className="px-6 py-20 border-t">
        <div className="mx-auto max-w-5xl flex flex-col gap-10">
          <div className="flex flex-col items-center gap-3 text-center">
            <Text as="h2" variant="headingLg">
              {t("home.gallery.title")}
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued" className="max-w-xl">
              {t("home.gallery.subtitle")}
            </Text>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                { key: "street", src: "/images/landing/street.webp" },
                { key: "scan", src: "/images/landing/scan.webp" },
                { key: "mesh", src: "/images/landing/mesh.webp" },
              ] as const
            ).map(({ key, src }) => (
              <figure key={key} className="flex flex-col gap-2">
                <div className="rounded-lg border overflow-hidden aspect-[16/10]">
                  <Image
                    src={src}
                    alt={t(`home.gallery.${key}`)}
                    width={800}
                    height={500}
                    className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
                  />
                </div>
                <figcaption className="text-center">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t(`home.gallery.${key}`)}
                  </Text>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* AR showcase: phone mockup + floating street captures */}
      <section className="px-6 py-24 border-t bg-muted/30 overflow-hidden">
        <div className="mx-auto max-w-5xl grid gap-14 lg:grid-cols-2 lg:items-center">
          {/* Copy */}
          <div className="flex flex-col gap-5">
            <Text as="h2" variant="headingLg">
              {t("home.ar.title")}
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              {t("home.ar.subtitle")}
            </Text>
            <ul className="flex flex-col gap-3 mt-2">
              {(["point1", "point2", "point3"] as const).map((key) => (
                <li key={key} className="flex items-start gap-3">
                  <span
                    className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                    aria-hidden
                  >
                    <ScanLine className="h-3 w-3" />
                  </span>
                  <Text as="span" variant="bodyMd">
                    {t(`home.ar.${key}`)}
                  </Text>
                </li>
              ))}
            </ul>
          </div>

          {/* Visual collage */}
          <div>
            <div className="relative flex justify-center lg:py-8">
              {/* Glow behind the phone */}
              <div
                aria-hidden
                className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl"
              />
              {/* Phone mockup */}
              <figure className="relative z-10 w-56 sm:w-64 rounded-3xl border-4 border-foreground/15 bg-background shadow-2xl overflow-hidden">
                <Image
                  src="/images/landing/ar-phone-1.webp"
                  alt={t("home.ar.title")}
                  width={440}
                  height={953}
                  className="w-full h-auto"
                />
              </figure>
              {/* Floating street captures (desktop) */}
              <figure className="hidden md:block absolute -left-2 lg:left-0 top-16 w-52 -rotate-6 rounded-xl border bg-background shadow-lg overflow-hidden">
                <Image
                  src="/images/landing/ar-street-1.webp"
                  alt={t("home.ar.title")}
                  width={600}
                  height={337}
                  className="w-full h-auto"
                />
              </figure>
              <figure className="hidden md:block absolute z-20 -right-2 lg:right-0 bottom-16 w-52 rotate-6 rounded-xl border bg-background shadow-xl overflow-hidden">
                <Image
                  src="/images/landing/ar-street-2.webp"
                  alt={t("home.ar.title")}
                  width={600}
                  height={336}
                  className="w-full h-auto"
                />
              </figure>
            </div>
            {/* Street captures stack below on mobile */}
            <div className="mt-6 grid grid-cols-2 gap-4 md:hidden">
              <figure className="rounded-xl border bg-background overflow-hidden">
                <Image
                  src="/images/landing/ar-street-1.webp"
                  alt={t("home.ar.title")}
                  width={600}
                  height={337}
                  className="w-full h-auto"
                />
              </figure>
              <figure className="rounded-xl border bg-background overflow-hidden">
                <Image
                  src="/images/landing/ar-street-2.webp"
                  alt={t("home.ar.title")}
                  width={600}
                  height={336}
                  className="w-full h-auto"
                />
              </figure>
            </div>
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section className="px-6 py-20 border-t">
        <div className="mx-auto max-w-4xl flex flex-col gap-12">
          <Text as="h2" variant="headingLg" alignment="center">
            {t("home.workflow.title")}
          </Text>
          <ol className="grid gap-10 sm:grid-cols-3">
            {WORKFLOW_STEPS.map((step, index) => (
              <li
                key={step}
                className="relative flex flex-col items-center gap-3 text-center"
              >
                {/* Connector line between steps (desktop) */}
                {index < WORKFLOW_STEPS.length - 1 && (
                  <div
                    aria-hidden
                    className="hidden sm:block absolute top-6 left-[calc(50%+2rem)] w-[calc(100%-4rem)] h-px bg-border"
                  />
                )}
                <span className="flex h-12 w-12 items-center justify-center rounded-full border bg-background text-lg font-semibold">
                  {index + 1}
                </span>
                <Text as="h3" variant="headingMd">
                  {t(`home.workflow.${step}.title`)}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t(`home.workflow.${step}.desc`)}
                </Text>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="px-6 pb-20">
        <div className="mx-auto max-w-5xl rounded-2xl border bg-muted/30 px-8 py-14 flex flex-col items-center gap-6 text-center">
          <Text as="h2" variant="headingLg">
            {t("home.bottomCta.title")}
          </Text>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild variant="outline" size="lg">
              <Link href="/auth/sign-up">{t("home.bottomCta.signUp")}</Link>
            </Button>
            <Button asChild variant="ghost" size="lg">
              <Link href={`/instructions/${guideLang}`}>
                {t("home.cta.instructions")}
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t px-6 py-16">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 text-center">
          <Image
            src="/images/landing/dhl-logo.png"
            alt="NYU Shanghai Digital Heritage Lab"
            width={1400}
            height={320}
            className="h-14 w-auto opacity-90 dark:grayscale dark:invert"
          />
          <Text as="p" variant="bodySm" tone="subdued">
            {t("home.footer.credit")}
          </Text>
          <nav className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2">
            <Link
              href={`/instructions/${guideLang}`}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("home.cta.instructions")}
            </Link>
            <Link
              href="/auth/login"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("account.signIn")}
            </Link>
            <Link
              href="/auth/sign-up"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("account.signUp")}
            </Link>
          </nav>
          <div className="h-px w-16 bg-border" aria-hidden />
          <div className="flex flex-col items-center gap-3">
            <p className="text-xs text-muted-foreground">
              {t("home.footer.copyright", { year: new Date().getFullYear() })}
            </p>
            <Link
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noopener noreferrer"
              lang="zh-CN"
              className="inline-flex min-h-6 items-center rounded-sm text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              沪ICP备2026007411号-1
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

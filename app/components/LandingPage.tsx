"use client";

import Link from "next/link";
import Image from "next/image";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowRight, ArrowUpRight, Box, Camera, Check, MapPin, MessageSquare, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import "./landing-page.css";

const CHAPTERS = [
  { key: "scene", Icon: Box, imageHeight: 805 },
  { key: "map", Icon: MapPin, imageHeight: 749 },
  { key: "activity", Icon: MessageSquare, imageHeight: 749 },
  { key: "anchor", Icon: ScanLine, imageHeight: 749 },
  { key: "assets", Icon: Camera, imageHeight: 749 },
] as const;
const STEPS = ["collect", "compose", "place", "engage"] as const;
const USE_CASES = ["culture", "commerce", "community"] as const;
const QUESTIONS = ["download", "content", "update", "collaborate"] as const;

export function LandingPage({ cta }: { cta: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const guide = `/instructions/${i18n.language?.startsWith("en") ? "en" : "zh"}`;

  return (
    <main className="landing-page" id="top">
      <section className="landing-hero landing-shell" aria-labelledby="home-title">
        <div className="landing-hero-copy">
          <h1 id="home-title" className="text-display md:text-display-xl font-semibold">
            {t("home.hero.line1")}<br /><span>{t("home.hero.line2")}</span>
          </h1>
          <div className="landing-hero-intro">
            <Text as="p" variant="bodyMd" tone="subdued">{t("home.hero.description")}</Text>
            <div className="landing-actions">
              {cta}
              <Button asChild variant="ghost" size="lg"><a href="#platform">{t("home.cta.explore")}<ArrowDown className="ml-2 h-4 w-4" aria-hidden /></a></Button>
            </div>
          </div>
        </div>
        <div className="landing-stage">
          <figure className="landing-map-frame">
            <figcaption><span className="landing-window-dots" aria-hidden><i /><i /><i /></span><span>{t("home.hero.project")}</span><span className="landing-stage-tag">{t("home.hero.real")}</span></figcaption>
            <Image src="/images/landing/dongming-map.webp" alt={t("home.heroShotAlt")} width={1512} height={749} sizes="(max-width: 767px) 100vw, 90vw" priority className="landing-product-image" />
          </figure>
          <figure className="landing-hero-phone">
            <Image src="/images/landing/ar-phone-1.webp" alt={t("home.ar.phoneAlt")} width={440} height={953} sizes="(max-width: 767px) 100px, 210px" priority />
            <figcaption><ScanLine className="h-4 w-4" aria-hidden />{t("home.hero.phone")}</figcaption>
          </figure>
        </div>
        <div className="landing-hero-footer"><Text as="p" variant="bodySm">{t("home.hero.caption")}</Text><a href="#workflow">{t("home.hero.scroll")}<ArrowDown className="h-4 w-4" aria-hidden /></a></div>
      </section>

      <section className="landing-workflow" id="workflow" aria-labelledby="workflow-title">
        <div className="landing-shell">
          <div className="landing-section-top">
            <h2 id="workflow-title" className="text-display font-semibold">{t("home.workflow.title")}</h2>
            <Text as="p" variant="bodyMd" tone="subdued">{t("home.workflow.description")}</Text>
          </div>
          <ol className="landing-steps">
            {STEPS.map((step, index) => <li key={step}>
              <span className="landing-step-index" aria-hidden>{String(index + 1).padStart(2, "0")}</span>
              <div><Text as="h3" variant="headingMd">{t(`home.workflow.${step}.title`)}</Text><Text as="p" variant="bodyMd" tone="subdued">{t(`home.workflow.${step}.desc`)}</Text></div>
              {index < STEPS.length - 1 && <ArrowRight className="landing-step-arrow h-5 w-5" aria-hidden />}
            </li>)}
          </ol>
        </div>
      </section>

      <section className="landing-platform landing-shell landing-section" id="platform" aria-labelledby="platform-title">
        <div className="landing-section-top">
          <h2 id="platform-title" className="text-display md:text-display-lg font-semibold">{t("home.platform.title")}</h2>
          <Text as="p" variant="bodyMd" tone="subdued">{t("home.platform.description")}</Text>
        </div>
        <Tabs defaultValue="scene" className="landing-product-tabs">
          <TabsList aria-label={t("home.platform.tabsLabel")} className="landing-tab-list">
            {CHAPTERS.map(({ key, Icon }) => <TabsTrigger key={key} value={key} className="landing-tab"><Icon className="h-4 w-4" aria-hidden />{t(`home.platform.${key}.label`)}</TabsTrigger>)}
          </TabsList>
          {CHAPTERS.map(({ key, imageHeight }) => <TabsContent key={key} value={key} className="landing-tab-panel">
            <div className="landing-tab-copy">
              <Text as="h3" variant="headingLg">{t(`home.platform.${key}.title`)}</Text>
              <Text as="p" variant="bodyMd" tone="subdued">{t(`home.platform.${key}.desc`)}</Text>
              <ul className="landing-feature-points">{["point1", "point2", "point3"].map(point => <li key={point}><Check className="h-4 w-4" aria-hidden /><span>{t(`home.platform.${key}.${point}`)}</span></li>)}</ul>
            </div>
            <figure className="landing-showcase">
              <Image src={`/images/landing/dongming-${key}.webp`} alt={t(`home.platform.${key}.alt`)} width={1512} height={imageHeight} sizes="(max-width: 767px) 100vw, 90vw" className="landing-product-image" />
              <figcaption><span>{t("home.platform.capture")}</span><span>{t(`home.platform.${key}.label`)}</span></figcaption>
            </figure>
          </TabsContent>)}
        </Tabs>
      </section>

      <section className="landing-experience" id="experience" aria-labelledby="experience-title">
        <div className="landing-shell landing-experience-grid">
          <div className="landing-experience-copy">
            <h2 id="experience-title" className="text-display md:text-display-lg font-semibold">{t("home.ar.title")}</h2>
            <Text as="p" variant="bodyMd" tone="subdued">{t("home.ar.subtitle")}</Text>
            <ul className="landing-ar-points">{["point1", "point2", "point3"].map(key => <li key={key}><Check className="h-5 w-5" aria-hidden /><Text as="span" variant="bodyMd">{t(`home.ar.${key}`)}</Text></li>)}</ul>
            <Button asChild variant="outline" size="lg"><Link href={guide}>{t("home.ar.guide")}<ArrowUpRight className="ml-2 h-4 w-4" aria-hidden /></Link></Button>
          </div>
          <div className="landing-ar-gallery">
            <figure className="landing-ar-landscape"><Image src="/images/landing/ar-street-1.webp" alt={t("home.ar.street1Alt")} width={600} height={337} sizes="(max-width: 767px) 75vw, 440px" /><figcaption>{t("home.ar.street1Caption")}</figcaption></figure>
            <figure className="landing-ar-phone"><Image src="/images/landing/ar-phone-1.webp" alt={t("home.ar.phoneAlt")} width={440} height={953} sizes="(max-width: 767px) 150px, 220px" /></figure>
            <figure className="landing-ar-detail"><Image src="/images/landing/ar-street-2.webp" alt={t("home.ar.street2Alt")} width={600} height={336} sizes="(max-width: 767px) 60vw, 280px" /></figure>
          </div>
        </div>
      </section>

      <section className="landing-operations landing-shell landing-section" aria-labelledby="operations-title">
        <div className="landing-operations-heading">
          <h2 id="operations-title" className="text-display font-semibold">{t("home.operations.title")}</h2>
          <Text as="p" variant="bodyMd" tone="subdued">{t("home.operations.description")}</Text>
        </div>
        <div className="landing-operations-grid">
          <article className="landing-team">
            <Text as="h3" variant="headingLg">{t("home.operations.team.title")}</Text>
            <Text as="p" variant="bodyMd" tone="subdued">{t("home.operations.team.desc")}</Text>
            <dl className="landing-operation-details">
              <div>
                <dt><Text as="span" variant="bodySm" fontWeight="medium">{t("home.operations.team.rolesLabel")}</Text></dt>
                <dd><Text as="p" variant="bodySm" tone="subdued">{["owner", "admin", "member", "viewer"].map(role => t(`home.operations.team.${role}`)).join(" / ")}</Text></dd>
              </div>
              <div>
                <dt><Text as="span" variant="bodySm" fontWeight="medium">{t("home.operations.team.updateLabel")}</Text></dt>
                <dd><Text as="p" variant="bodySm" tone="subdued">{t("home.operations.team.note")}</Text></dd>
              </div>
            </dl>
          </article>
          <article className="landing-agent">
            <Text as="h3" variant="headingLg">{t("home.operations.agent.title")}</Text>
            <Text as="p" variant="bodyMd" tone="subdued">{t("home.operations.agent.desc")}</Text>
            <div className="landing-agent-process">
              <Text as="p" variant="bodySm" fontWeight="medium">{t("home.operations.agent.flowLabel")}</Text>
              <ol className="landing-agent-flow">{["find", "compose", "verify", "save"].map((step, index) => <li key={step}><Text as="span" variant="bodySm" tone="subdued">{t(`home.operations.agent.${step}`)}</Text>{index < 3 && <ArrowRight className="h-3 w-3" aria-hidden />}</li>)}</ol>
            </div>
            <Link href={guide} className="landing-text-link">{t("home.operations.agent.link")}<ArrowUpRight className="h-4 w-4" aria-hidden /></Link>
          </article>
        </div>
      </section>

      <section className="landing-usecases landing-shell landing-section" id="solutions" aria-labelledby="solutions-title">
        <div className="landing-section-top">
          <h2 id="solutions-title" className="text-display md:text-display-lg font-semibold">{t("home.solutions.title")}</h2>
          <Text as="p" variant="bodyMd" tone="subdued">{t("home.solutions.description")}</Text>
        </div>
        <div className="landing-solution-layout">
          <figure className="landing-place-image"><Image src="/images/landing/street.webp" alt={t("home.solutions.imageAlt")} width={800} height={500} sizes="(max-width: 767px) 100vw, 45vw" /><figcaption>{t("home.solutions.imageCaption")}</figcaption></figure>
          <div className="landing-solution-list">{USE_CASES.map(key => <article key={key}>
            <Text as="h3" variant="headingLg">{t(`home.solutions.${key}.title`)}</Text><Text as="p" variant="bodyMd" tone="subdued">{t(`home.solutions.${key}.desc`)}</Text><span className="landing-solution-tags">{t(`home.solutions.${key}.tags`)}</span>
          </article>)}</div>
        </div>
      </section>

      <section className="landing-faq landing-shell landing-section" aria-labelledby="faq-title">
        <div><h2 id="faq-title" className="text-display font-semibold">{t("home.faq.title")}</h2><Text as="p" variant="bodyMd" tone="subdued" className="mt-5">{t("home.faq.description")}</Text><Link href={guide} className="landing-text-link">{t("home.cta.instructions")}<ArrowUpRight className="h-4 w-4" aria-hidden /></Link></div>
        <Accordion type="single" collapsible>{QUESTIONS.map(key => <AccordionItem value={key} key={key}><AccordionTrigger className="landing-faq-question">{t(`home.faq.${key}.q`)}</AccordionTrigger><AccordionContent><Text as="p" variant="bodyMd" tone="subdued">{t(`home.faq.${key}.a`)}</Text></AccordionContent></AccordionItem>)}</Accordion>
      </section>

      <section className="landing-final" aria-labelledby="start-title"><div className="landing-shell">
        <h2 id="start-title" className="text-display md:text-display-lg font-semibold">{t("home.bottomCta.title")}</h2>
        <Text as="p" variant="bodyMd">{t("home.bottomCta.description")}</Text>
        <div className="landing-actions">{cta}<Button asChild variant="outline" size="lg"><Link href="/auth/sign-up">{t("home.bottomCta.signUp")}<ArrowUpRight className="ml-2 h-4 w-4" aria-hidden /></Link></Button></div>
      </div></section>

      <footer className="landing-footer landing-shell">
        <div className="landing-footer-top"><div><Link href="#top" className="landing-brand"><Box className="h-6 w-6" aria-hidden />Spatial Memory</Link><Text as="p" variant="bodySm" tone="subdued" className="mt-4">{t("home.footer.tagline")}</Text></div><nav aria-label={t("home.footer.navLabel")}><Link href={guide}>{t("home.cta.instructions")}</Link><Link href="/auth/login">{t("account.signIn")}</Link><Link href="/auth/sign-up">{t("account.signUp")}</Link></nav></div>
        <div className="landing-footer-bottom"><div className="landing-credit"><Image src="/images/landing/dhl-logo.png" alt="NYU Shanghai Digital Heritage Lab" width={1400} height={320} sizes="180px" /><Text as="p" variant="bodyXs">{t("home.footer.credit")}</Text></div><div><Text as="p" variant="bodyXs">{t("home.footer.copyright", { year: new Date().getFullYear() })}</Text><Link href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" lang="zh-CN">沪ICP备2026007411号-1</Link></div></div>
      </footer>
    </main>
  );
}

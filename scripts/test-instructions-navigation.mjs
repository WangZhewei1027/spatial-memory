import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const origin = process.env.MANAGE_TEST_ORIGIN ?? "http://localhost:3000";
const browser = await chromium.launch();
try {
  for (const { language, width } of [{ language: "zh", width: 1440 }, { language: "en", width: 320 }]) {
    const context = await browser.newContext({ viewport: { width, height: 830 } });
    await context.addCookies([{ name: "language", value: language, url: origin }]);
    const page = await context.newPage();
    const english = language === "en";
    const otherLanguage = english ? "zh" : "en";
    await page.goto(`${origin}/instructions/${otherLanguage}?source=bookmark#placements`);
    await page.waitForURL(`${origin}/instructions?source=bookmark#placements`);
    const initialUrl = page.url();

    await page.getByRole("heading", { level: 1, name: english ? "User guide" : "使用指南" }).waitFor();
    assert.equal(await page.locator("main nav:visible").count(), 0);
    assert.equal(await page.locator("header").getByRole("button", { name: english ? "Docs & tutorials" : "文档与教程" }).count(), 0);
    assert.equal(await page.locator("header").getByRole("button", { name: english ? "Site navigation" : "网站导航" }).count(), 0);

    const switcher = page.getByRole("button", { name: /Switch language/ });
    await switcher.click();
    await page.getByRole("menuitem", { name: english ? "中文" : "English", exact: true }).click();
    const translatedTitle = page.getByRole("heading", { level: 1, name: english ? "使用指南" : "User guide" });
    await translatedTitle.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-haspopup") === "menu");
    await page.waitForFunction(() => Math.abs(document.getElementById("placements").getBoundingClientRect().top) < 2);
    assert.equal(page.url(), initialUrl);
    await page.reload();
    await translatedTitle.waitFor();
    await context.close();
  }
  console.log("PASS guide navigation, global language switching and chapter bookmarks");
} finally {
  await browser.close();
}

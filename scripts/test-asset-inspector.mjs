/** Real browser UI against a local Next server; all API reads/writes use disposable fixtures. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const origin = process.env.MANAGE_TEST_ORIGIN ?? "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const teamId = "11111111-1111-4111-8111-111111111111";
const id = (n) => `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`;
const captureDir = process.env.INSPECTOR_SCREENSHOTS;
if (captureDir) await mkdir(captureDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [language, dark, width] of [["en", false, 1440], ["zh", true, 1440], ["en", true, 390], ["zh", false, 390]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const rows = Array.from({ length: 45 }, (_, n) => ({
      id: id(n), organization_id: teamId, name: `Fixture asset ${n}`, file_type: n === 0 ? "image" : "text",
      origin: "team_upload", visibility: "organization", state: "active", origin_workspace_id: null,
      maintained_by: null, maintainer: null, created_by: null, create_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", archived_at: null,
      lock_version: 1, usage_count: 0, payload: n === 0 ? { kind: "image" } : { kind: "text", text: `Fixture content ${n}` },
      resources: n === 0 ? [{ role: "primary", ordinal: 0, url: `${origin}/images/landing/street.webp` }] : [],
      capabilities: { can_read: true, can_maintain: true, can_use_in_workspace: true },
    }));
    let failListRead = false;
    await context.addCookies([{ name: "better-auth.session_token", value: "inspector-fixture", url: origin }, { name: "language", value: language, url: origin }]);
    await context.route("**/api/**", async (route) => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      let status = 200, body = { data: [], page: { total: 0, hasMore: false, limit: 30, offset: 0 } };
      if (path === "/api/auth/get-session") body = { user: { id: "fixture", name: "Fixture", email: "fixture@example.invalid" }, session: { id: "fixture", expiresAt: "2099-01-01" } };
      else if (path === "/api/auth/role") body = { role: "user" };
      else if (path === "/api/organizations") body = { data: [{ id: teamId, name: "Fixture team", role: "owner", allowed_file_types: ["image", "text"] }] };
      else if (path === `/api/organizations/${teamId}/assets`) {
        let filtered = rows.filter((row) => row.name.toLowerCase().includes((url.searchParams.get("q") ?? "").toLowerCase()));
        const type = url.searchParams.get("file_type");
        if (type) filtered = filtered.filter((row) => row.file_type === type);
        const offset = Number(url.searchParams.get("offset") ?? 0), limit = Number(url.searchParams.get("limit") ?? 30);
        body = { data: filtered.slice(offset, offset + limit), page: { total: filtered.length, offset, limit } };
        if (failListRead) { status = 500; body = { error: "Fixture refresh failure" }; }
      } else if (/\/api\/assets\/[^/]+\/usage$/.test(path)) body = { data: { asset_id: path.split("/")[3], impact: { scenes: 0, placements: 0, activities: 0, restricted_count: 0, items: [] } } };
      else if (path.startsWith("/api/assets/")) {
        const asset = rows.find((row) => path.endsWith(row.id));
        if (!asset) { status = 404; body = { code: "NOT_FOUND", error: "Fixture not found" }; }
        else {
          if (request.method() === "PATCH") {
            const input = request.postDataJSON();
            assert.equal(input.expectedLockVersion, asset.lock_version);
            Object.assign(asset, { name: input.name ?? asset.name, lock_version: asset.lock_version + 1 });
          }
          body = { data: asset };
        }
      } else if (path === "/api/tags") body = { tags: [] };
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/manage/assets?organizationId=${teamId}`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
    const search = page.getByPlaceholder(language === "en" ? "Search by name" : "按名称搜索");
    await search.fill("Fixture");
    await page.waitForResponse((response) => response.url().includes("/assets?") && new URL(response.url()).searchParams.get("q") === "Fixture");
    const first = page.locator(`#library-asset-${id(0)}`);
    await first.waitFor();
    const main = await page.locator(".team-workarea").elementHandle();
    const region = await page.locator(".team-library [role=region]").elementHandle();
    const sidebar = await page.locator(".console-sidebar").elementHandle();
    const initialBounds = await main.boundingBox();
    const initialSidebar = await sidebar.boundingBox();
    await first.focus();
    await page.keyboard.press("Enter");
    const panel = width >= 1024 ? page.getByRole("complementary", { name: language === "en" ? "Asset details" : "素材详情" }) : page.getByRole("dialog");
    await panel.getByRole("heading", { name: "Fixture asset 0", exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/manage/assets");
    assert.equal(new URL(page.url()).searchParams.get("assetId"), id(0));
    assert.equal(await search.inputValue(), "Fixture");
    assert.equal(await main.evaluate((node) => node.isConnected), true);
    if (width >= 1024) {
      assert.ok((await main.boundingBox()).width < initialBounds.width - 250, "the island must squeeze the library");
      assert.deepEqual(await sidebar.boundingBox(), initialSidebar);
      assert.equal(await panel.locator("dl").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length), 1);
    }
    await panel.getByText(language === "en" ? "Team upload" : "团队上传", { exact: true }).waitFor();
    if (captureDir) await page.screenshot({ path: `${captureDir}/${language}-${dark ? "dark" : "light"}-${width}.png`, animations: "disabled" });
    const close = () => panel.getByRole("button", { name: language === "en" ? "Close" : "关闭", exact: true }).click();
    await close();
    await panel.waitFor({ state: "hidden" });
    assert.equal(new URL(page.url()).searchParams.has("assetId"), false);
    assert.equal(await search.inputValue(), "Fixture");
    assert.deepEqual(await main.boundingBox(), initialBounds);
    assert.equal(await region.evaluate((node) => node.isConnected), true);
    await page.waitForFunction((linkId) => document.activeElement?.id === linkId, `library-asset-${id(0)}`);
    if (width >= 1024) {
      await region.evaluate((node) => { node.scrollTop = 100; });
      const target = page.locator(`#library-asset-${id(7)}`);
      await target.scrollIntoViewIfNeeded();
      const scroll = await region.evaluate((node) => node.scrollTop);
      await target.click();
      await panel.getByRole("heading", { name: "Fixture asset 7", exact: true }).waitFor();
      assert.equal(await region.evaluate((node) => node.scrollTop), scroll, "opening must preserve list scroll");
      await page.goBack();
      await panel.waitFor({ state: "hidden" });
      assert.equal(await search.inputValue(), "Fixture");
      await page.goForward();
      await panel.getByRole("heading", { name: "Fixture asset 7", exact: true }).waitFor();
      await region.evaluate((node) => { node.scrollTop = node.scrollHeight; });
      await page.locator(`#library-asset-${id(44)}`).waitFor({ state: "attached" });
      await panel.locator(":scope > .overflow-y-auto").evaluate((node) => { node.scrollTop = 200; });
      await page.locator(`#library-asset-${id(8)}`).click();
      await panel.getByRole("heading", { name: "Fixture asset 8", exact: true }).waitFor();
      assert.equal(await panel.locator(":scope > .overflow-y-auto").evaluate((node) => node.scrollTop), 0);
      const editScroll = await region.evaluate((node) => node.scrollTop);
      await panel.getByRole("button", { name: language === "en" ? "Rename" : "重命名", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox").fill("Fixture renamed");
      await dialog.getByRole("button", { name: language === "en" ? "Save" : "保存", exact: true }).click();
      await panel.getByRole("heading", { name: "Fixture renamed", exact: true }).waitFor();
      assert.equal(rows[8].name, "Fixture renamed");
      await page.locator(`#library-asset-${id(8)}`).filter({ hasText: "Fixture renamed" }).waitFor();
      assert.equal(await region.evaluate((node) => node.scrollTop), editScroll, "refreshing must preserve list scroll");
      assert.equal(await page.locator(`#library-asset-${id(44)}`).count(), 1, "refreshing must preserve loaded pages");
      if (language === "en") {
        failListRead = true;
        await panel.getByRole("button", { name: "Rename", exact: true }).click();
        await dialog.getByRole("textbox").fill("Fixture retry");
        await dialog.getByRole("button", { name: "Save", exact: true }).click();
        await panel.getByRole("heading", { name: "Fixture retry", exact: true }).waitFor();
        assert.equal(await page.locator(`#library-asset-${id(8)}`).innerText(), "Fixture renamed");
        const retry = page.locator(".team-library").getByRole("button", { name: "Retry", exact: true });
        await retry.waitFor();
        failListRead = false;
        await retry.click();
        await page.locator(`#library-asset-${id(8)}`).filter({ hasText: "Fixture retry" }).waitFor({ state: "attached" });
      }
      await close();
    }
    assert.deepEqual(errors, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log(`PASS asset inspector ${language} ${dark ? "dark" : "light"} ${width}`);
    await context.close();
  }
} finally { await browser.close(); }

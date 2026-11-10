/** Browser regression for per-map settings; APIs and viewer are isolated fixtures. */
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
const origin = process.env.MANAGE_TEST_ORIGIN ?? "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const teamId = "11111111-1111-4111-8111-111111111111", mapId = "22222222-2222-4222-8222-222222222222";
const capture = process.env.MAP_SETTINGS_SCREENSHOTS;
if (capture) await mkdir(capture, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [language, dark, width, writable, archived] of [
    ["zh", false, 1440, true, false], ["en", true, 1440, true, false],
    ["zh", true, 390, true, false], ["en", false, 320, true, false],
    ["en", false, 1440, false, false], ["zh", false, 1440, false, true],
  ]) {
    const locale = JSON.parse(await readFile(new URL(`../locales/${language}.json`, import.meta.url), "utf8"));
    const t = locale.collectionSettings;
    const context = await browser.newContext({ viewport: { width, height: width === 320 ? 568 : 900 } });
    const collection = { id: mapId, organization_id: teamId, name: "Map fixture", archived_at: archived ? "2026-11-01T00:00:00Z" : null,
      config_lock_version: 1, miniapp_config: { retrieval_mode: "gps", text_asset_miniapp_style: "dialog_decorated", confetti_enabled: false, footer_enabled: false },
      capabilities: { can_read: true, can_edit: writable, can_archive: writable } };
    let failure = 0, writes = 0;
    await context.addCookies([{ name: "better-auth.session_token", value: "map-settings-fixture", url: origin }, { name: "language", value: language, url: origin }]);
    await context.route("**/api/**", async (route) => {
      const request = route.request(), path = new URL(request.url()).pathname;
      let status = 200, body = { data: [], page: { total: 0, hasMore: false, limit: 30, offset: 0 } };
      if (request.method() !== "GET") {
        assert.ok(writable); assert.equal(request.method(), "PATCH"); assert.equal(path, `/api/collections/${mapId}`);
        const input = request.postDataJSON(); writes++;
        assert.deepEqual(Object.keys(input).sort(), ["expectedLockVersion", "miniappConfig"]);
        if (failure) { status = failure; body = { code: failure === 409 ? "LOCK_VERSION_CONFLICT" : "INTERNAL_ERROR", error: "Fixture error" }; }
        else {
          assert.equal(input.expectedLockVersion, collection.config_lock_version);
          collection.miniapp_config = input.miniappConfig; collection.config_lock_version++;
          body = { data: collection };
        }
      } else if (path === "/api/auth/get-session") body = { user: { id: "fixture", name: "Fixture", email: "fixture@example.invalid" }, session: { id: "fixture", expiresAt: "2099-01-01" } };
      else if (path === "/api/auth/role") body = { role: "user" };
      else if (path === "/api/organizations") body = { data: [{ id: teamId, name: "Fixture team", role: writable ? "owner" : "viewer", allowed_file_types: ["text"] }] };
      else if (path === `/api/organizations/${teamId}/collections`) body = { data: [collection] };
      else if (path === `/api/collections/${mapId}`) body = { data: collection };
      else if (path === "/api/tags") body = { tags: [] };
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    await context.route("**/js/viewer/index.html*", (route) => route.fulfill({ contentType: "text/html", body: '<html><body style="margin:0;background:#e5e7eb;height:100vh"><script>parent.postMessage({type:"VIEWER_READY",source:"viewer",version:1},location.origin)</script></body></html>' }));
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/manage/collections/${mapId}?organizationId=${teamId}`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: "nextjs-portal { display:none!important }" });
    if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
    const trigger = page.locator("header").getByRole("button", { name: t.trigger, exact: true });
    const frame = await page.locator('iframe[title="3D Viewer"]').elementHandle();
    const bounds = await frame.boundingBox();
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: t.title, exact: true });
    const mode = dialog.getByRole("combobox", { name: t.retrievalMode, exact: true });
    const style = dialog.getByRole("combobox", { name: t.textStyle, exact: true });
    await mode.waitFor();
    assert.deepEqual(await frame.boundingBox(), bounds, "settings must not resize or remount the map");
    assert.ok(await frame.evaluate((node) => node.isConnected));
    const b = await dialog.boundingBox(), viewport = page.viewportSize();
    assert.ok(b.x >= 0 && b.x + b.width <= width && b.y >= 0 && b.y + b.height <= viewport.height);
    assert.ok(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth));
    assert.ok(await page.locator("header").evaluate((node) => node.scrollWidth <= node.clientWidth));
    if (capture) await page.screenshot({ path: `${capture}/${language}-${dark ? "dark" : "light"}-${width}-${writable}.png`, animations: "disabled" });
    if (!writable) {
      assert.equal(await mode.isDisabled(), true); assert.equal(await style.isDisabled(), true);
      assert.equal(await dialog.getByRole("button", { name: locale.common.save, exact: true }).count(), 0);
    } else {
      const choose = async (control, name) => { await control.click(); await page.getByRole("option", { name, exact: true }).click(); };
      await mode.click(); assert.deepEqual(await page.getByRole("option").allTextContents(), [t.modes.anchor, t.modes.gps]);
      await page.getByRole("option", { name: t.modes.anchor, exact: true }).click();
      await page.keyboard.press("Escape"); await trigger.click();
      assert.equal(await mode.innerText(), t.modes.gps, "closing discards unsaved changes"); assert.equal(writes, 0);
      await choose(mode, t.modes.anchor); await choose(style, t.styles.plain_white);
      await dialog.getByRole("checkbox", { name: t.confetti_enabled, exact: true }).check();
      await dialog.getByRole("checkbox", { name: t.footer_enabled, exact: true }).check();
      const save = dialog.getByRole("button", { name: locale.common.save, exact: true });
      if (width === 1440 && language === "zh") {
        failure = 500; await save.click(); await dialog.getByRole("alert").waitFor();
        assert.equal(await mode.innerText(), t.modes.anchor); assert.equal(await save.isEnabled(), true);
        failure = 409; await save.click(); await dialog.getByRole("button", { name: locale.contentModel.action.reload, exact: true }).waitFor();
        assert.equal(await mode.isDisabled(), true); assert.equal(await save.isDisabled(), true);
        failure = 0; collection.config_lock_version = 2;
        await dialog.getByRole("button", { name: locale.contentModel.action.reload, exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('#collection-retrieval-mode')?.disabled);
        assert.equal(await mode.innerText(), t.modes.gps);
        await choose(mode, t.modes.anchor); await choose(style, t.styles.plain_white);
        await dialog.getByRole("checkbox", { name: t.confetti_enabled, exact: true }).check();
        await dialog.getByRole("checkbox", { name: t.footer_enabled, exact: true }).check();
      }
      await save.click(); await dialog.waitFor({ state: "hidden" }); await trigger.click();
      assert.equal(await mode.innerText(), t.modes.anchor); assert.equal(await style.innerText(), t.styles.plain_white);
      assert.equal(await dialog.getByRole("checkbox", { name: t.footer_enabled, exact: true }).isChecked(), true);
      assert.equal(await save.isDisabled(), true, "saved settings survive reopening");
    }
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(await frame.boundingBox(), bounds); assert.deepEqual(errors, []);
    await context.close(); console.log(`PASS settings ${language} ${dark ? "dark" : "light"} ${width} writable=${writable} archived=${archived}`);
  }
} finally { await browser.close(); }

/** Full-window activity editing; APIs and viewer messages use isolated fixtures. */
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

const origin = process.env.MANAGE_TEST_ORIGIN ?? "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const team = "11111111-1111-4111-8111-111111111111", id = "33333333-3333-4333-8333-333333333333";
const capture = process.env.ACTIVITY_EDITOR_SCREENSHOTS;
if (capture) await mkdir(capture, { recursive: true });
const browser = await chromium.launch();
try {
  const scenarios = [
    ["zh", "light", 1440, true, false], ["en", "dark", 1100, true, false],
    ["zh", "dark", 390, true, false], ["en", "light", 320, true, false],
    ["en", "light", 1440, false, false], ["zh", "light", 1440, true, true],
  ];
  for (const [language, theme, width, writable, archived, activityType] of scenarios.flatMap(values => ["danmaku", "shop_checkin"].map(type => [...values, type]))) {
    const shop = activityType === "shop_checkin";
    const locale = JSON.parse(await readFile(new URL(`../locales/${language}.json`, import.meta.url), "utf8"));
    const t = locale.activities;
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
    context.setDefaultTimeout(15000);
    await context.addCookies([{ name: "better-auth.session_token", value: "editor-fixture", url: origin }, { name: "language", value: language, url: origin }]);
    await context.addInitScript(({ theme, origin }) => { if (location.origin === origin) localStorage.setItem("theme", theme); }, { theme, origin });
    const pointNames = language === "zh" ? ["河边咖啡", "旧书店", "旧点位"] : ["Riverside café", "Bookshop", "Old stop"];
    const activity = { id, organization_id: team, type: activityType, name: language === "zh" ? shop ? "城市漫游 · 店铺打卡" : "城市漫游 · 弹幕留言" : shop ? "City walk · Shop check-in" : "City walk · Community messages", description: "Fixture activity", config: shop ? { checkinRadiusMeters: 50 } : {},
      points: shop ? pointNames.map((name, index) => ({ id: `point-${index}`, activity_id: id, name, description: `Point ${index}`, state: index === 2 ? "archived" : "active", ordinal: index, location: index === 1 ? null : { longitude: 121.47, latitude: 31.23 }, image_asset_id: null, image_url: null, reward_asset_id: null, reward_url: null })) : [],
      location: null, radius_meters: null, state: archived ? "archived" : "active", lock_version: 1, created_at: "2026-11-15T00:00:00Z", updated_at: "2026-11-15T00:00:00Z", has_map_link: true, capabilities: { can_read: true, can_edit: writable } };
    const map = { id: "22222222-2222-4222-8222-222222222222", name: language === "zh" ? "城市漫游地图" : "City walk map", organization_id: team, archived_at: null, capabilities: { can_edit: writable } };
    const placement = { id: "placement-fixture", activity_id: id, organization_id: team, activity_name: activity.name, activity_type: activityType, workspace_id: map.id, workspace_name: map.name, status: "active", lock_version: 1, capabilities: { can_read: true, can_edit: writable } };
    const record = { id: "record-fixture", activity_id: id, placement_id: placement.id, kind: shop ? "checkin" : "danmaku", point_id: shop ? "point-0" : null, content: language === "zh" ? "在这里留下今天的城市记忆。" : "A memory from today's walk through the city.", status: "visible", location: null, created_at: "2026-11-15T02:00:00Z", lock_version: 1, capabilities: { can_read: true, can_edit: writable && !archived } };
    const writes = [];
    let conflict = false;
    await context.route("**/api/**", async (route) => {
      const req = route.request(), path = new URL(req.url()).pathname;
      let body = { data: [], page: { total: 0, limit: 25, offset: 0, hasMore: false } };
      if (req.method() !== "GET") {
        assert.ok(writable && !archived, "read-only editors must never write");
        assert.equal(req.method(), "PATCH");
        const input = req.postDataJSON();
        writes.push({ path, input });
        if (path === `/api/activities/${id}`) {
          assert.equal(input.expectedLockVersion, activity.lock_version);
          if (conflict) { await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "LOCK_VERSION_CONFLICT", code: "LOCK_VERSION_CONFLICT" }) }); return; }
          const { expectedLockVersion, radiusMeters, ...rest } = input;
          Object.assign(activity, rest, { ...(radiusMeters !== undefined ? { radius_meters: radiusMeters } : {}), lock_version: expectedLockVersion + 1 });
          if (input.points) activity.points = input.points.map((point, index) => ({ ...point, id: point.id ?? `created-point-${index}`, activity_id: id, image_asset_id: point.imageAssetId, image_url: null, reward_asset_id: point.rewardAssetId, reward_url: null }));
          body = { data: activity };
        } else if (path === `/api/activity-records/${record.id}`) {
          assert.equal(input.expectedLockVersion, record.lock_version);
          record.status = input.status; record.lock_version++;
          body = { data: record };
        } else throw new Error(`Unexpected write ${path}`);
      } else if (path === "/api/auth/get-session") body = { user: { id: "fixture", name: "Fixture", email: "fixture@example.invalid" }, session: { id: "fixture", expiresAt: "2099-01-01" } };
      else if (path === "/api/auth/role") body = { role: "user" };
      else if (path === "/api/organizations") body = { data: [{ id: team, name: "Fixture team", role: writable ? "owner" : "viewer", allowed_file_types: ["text"], map_center: { lng: 121.47, lat: 31.23 } }] };
      else if (path === `/api/organizations/${team}/assets`) body = { data: [{ id: "image-fixture", name: "Point image fixture", resources: [] }], page: { total: 1, offset: 0, limit: 24 } };
      else if (path === `/api/organizations/${team}/collections`) body = { data: [map] };
      else if (path === `/api/organizations/${team}/activities`) body = { data: [activity], page: { total: 1, offset: 0, limit: 30, hasMore: false } };
      else if (path === `/api/activities/${id}`) { await delay(150); body = { data: activity }; }
      else if (path === `/api/activities/${id}/placements`) body = { data: [placement] };
      else if (path === `/api/activities/${id}/records`) body = { data: [record], page: { total: 1, limit: 25, offset: 0 } };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    let viewerLoads = 0;
    await context.route("**/js/viewer/index.html*", async (route) => {
      viewerLoads++;
      await route.fulfill({ contentType: "text/html", body: `<html style="color-scheme:${theme}"><body style="margin:0;display:grid;place-items:center;height:100vh;font:14px system-ui;color:${theme === "dark" ? "#b4b4b4" : "#737373"};background:${theme === "dark" ? "#202226" : "#eceeef"}"><p>Map viewer · isolated test fixture</p><script>window.messages=[];addEventListener('message',event=>messages.push(event.data));parent.postMessage({type:'VIEWER_READY',source:'viewer',version:1},location.origin);</script></body></html>` });
    });
    const errors = [];
    context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    const library = await context.newPage();
    await library.goto(`${origin}/manage/activities?organizationId=${team}`, { waitUntil: "networkidle" });
    await library.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    const link = library.getByRole("link", { name: activity.name, exact: true });
    await link.waitFor();
    assert.equal(await link.getAttribute("target"), "_blank");
    const popup = context.waitForEvent("page");
    await link.click();
    const page = await popup;
    await page.getByLabel(t.name, { exact: true }).waitFor();
    await page.waitForLoadState("networkidle");
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), theme);
    assert.ok(new URL(library.url()).pathname === "/manage/activities", "the library remains open");
    assert.equal(await page.locator(".console-sidebar, .app-navbar").count(), 0, "editor owns its whole window");
    assert.equal(await page.locator("header").count(), 1);
    assert.equal(await page.locator("[data-map-panel]").count(), 3);
    const boxes = await page.locator("[data-map-panel]").evaluateAll(nodes => nodes.map(node => ({ panel: node.dataset.mapPanel, box: node.getBoundingClientRect().toJSON() })));
    for (const { box } of boxes) assert.ok(box.x >= 0 && box.right <= width + 1 && box.width > 0);
    if (width >= 996) assert.equal(new Set(boxes.map(({ box }) => box.y)).size, 1, "three columns align");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await page.locator("form form").count(), 0, "association and activity drafts have separate forms");
    const save = page.locator("header").getByRole("button", { name: locale.common.save, exact: true });
    const sendLocation = () => page.frameLocator("iframe").locator("body").evaluate(() => parent.postMessage({ source: "viewer", version: 1, type: "LOCATION_CLICKED", payload: { longitude: 121.48, latitude: 31.24 } }, location.origin));
    if (writable && !archived) {
      assert.equal(await save.isDisabled(), true);
      await page.getByLabel(t.name, { exact: true }).fill(`${activity.name} · edited`);
      const loads = viewerLoads;
      if (shop) {
        // The unlocated point is selected first; changing it updates only its draft.
        assert.equal(await page.getByLabel(t.pointName, { exact: true }).inputValue(), pointNames[1]);
        await page.getByLabel(t.pointName, { exact: true }).fill(`${pointNames[1]} · edited`);
        await sendLocation();
        await page.getByRole("tab", { name: t.placements, exact: true }).click();
        await page.frameLocator("iframe").locator("body").evaluate(() => parent.postMessage({ source: "viewer", version: 1, type: "ASSET_CLICKED", payload: { assetId: "point-0" } }, location.origin));
        await page.getByLabel(t.pointName, { exact: true }).waitFor();
        assert.equal(await page.getByLabel(t.pointName, { exact: true }).inputValue(), pointNames[0], "map selection opens the point inspector");
        await page.getByRole("button", { name: t.chooseImage, exact: true }).first().click();
        await page.getByRole("button", { name: "Point image fixture", exact: true }).click();
        await page.getByRole("button", { name: t.chooseImage, exact: true }).click();
        await page.getByRole("button", { name: "Point image fixture", exact: true }).click();
        await page.getByRole("button", { name: t.archivePoint, exact: true }).click();
        assert.equal(await page.getByLabel(t.pointName, { exact: true }).isDisabled(), true);
        await page.getByRole("button", { name: t.restore, exact: true }).click();
        await page.getByRole("button", { name: t.addPoint, exact: true }).click();
        await page.getByRole("button", { name: t.removePoint, exact: true }).click();
        await page.getByRole("button", { name: t.addPoint, exact: true }).click();
        await page.getByRole("tab", { name: t.placements, exact: true }).click();
        await save.click();
        await page.getByLabel(t.pointName, { exact: true }).waitFor();
        assert.equal(await page.getByLabel(t.pointName, { exact: true }).inputValue(), "", "invalid hidden point is revealed before save");
        assert.equal(writes.length, 0, "an unnamed point must not be submitted");
        await page.getByLabel(t.pointName, { exact: true }).fill("New stop");
        await sendLocation();
        await page.getByLabel(t.checkinRadius, { exact: true }).fill("75");
      } else {
        assert.equal(await page.getByLabel(t.maxLength, { exact: true }).inputValue(), "50");
        await page.getByLabel(t.participationArea, { exact: true }).click();
        await page.getByRole("option", { name: t.localArea, exact: true }).click();
        await sendLocation();
        await page.frameLocator("iframe").locator("body").evaluate(() => parent.postMessage({ source: "viewer", version: 1, type: "ASSET_CLICKED", payload: { assetId: "activity-center" } }, location.origin));
        assert.equal(await page.getByRole("tab", { name: t.placements, exact: true }).getAttribute("aria-selected"), "true", "clicking the danmaku center keeps its sidebar tab");
        await page.getByLabel(t.radius, { exact: true }).fill("150");
      }
      await page.getByRole("tab", { name: t.records, exact: true }).click();
      if (!shop) await page.getByText(record.content, { exact: true }).waitFor();
      await page.getByRole("button", { name: t.hideRecord, exact: true }).click();
      await page.getByRole("button", { name: t.showRecord, exact: true }).waitFor();
      assert.equal(await page.getByLabel(t.name, { exact: true }).inputValue(), `${activity.name} · edited`, "record writes must not replace the activity draft");
      assert.equal(viewerLoads, loads, "switching tabs and moderating keep the map mounted");
      await save.click();
      await page.waitForFunction(() => document.querySelector("header h1")?.textContent?.endsWith(" · edited"));
      if (shop) {
        assert.equal(activity.config.checkinRadiusMeters, 75);
        assert.equal(activity.points.length, 4);
        assert.deepEqual(activity.points[1].location, { longitude: 121.48, latitude: 31.24 });
        assert.equal(activity.points[1].name, `${pointNames[1]} · edited`);
        assert.equal(activity.points[0].image_asset_id, "image-fixture");
        assert.equal(activity.points[0].reward_asset_id, "image-fixture");
        assert.equal(activity.points[0].state, "active");
        assert.equal(activity.points[2].state, "archived");
        assert.equal(activity.points[3].name, "New stop");
      } else {
        assert.deepEqual(activity.location, { longitude: 121.48, latitude: 31.24 });
        assert.equal(activity.radius_meters, 150);
        assert.equal(activity.config.maxLength, 50);
      }
      assert.equal(activity.lock_version, 2);
      assert.equal(await save.isDisabled(), true);
      // A failed optimistic save retains the draft and exposes the existing reload path.
      if (width === 1440) {
        conflict = true;
        await page.locator("#activity-description").fill("Unsaved after conflict");
        await save.click();
        await page.getByRole("button", { name: t.reload, exact: true }).waitFor();
        assert.equal(await page.locator("#activity-description").inputValue(), "Unsaved after conflict");
        conflict = false;
        const writesBeforeReload = writes.length;
        await page.getByRole("button", { name: t.reload, exact: true }).click();
        await page.waitForLoadState("networkidle");
        await page.waitForFunction(() => document.querySelector("#activity-description")?.value === "Fixture activity");
        assert.equal(writes.length, writesBeforeReload, "reload must not submit the discarded draft");
      }
    } else {
      assert.equal(await save.count(), 0);
      assert.equal(await page.getByLabel(t.name, { exact: true }).isDisabled(), true);
      if (shop) {
        assert.equal(await page.getByLabel(t.pointName, { exact: true }).isDisabled(), true);
        assert.equal(await page.getByRole("button", { name: t.addPoint, exact: true }).count(), 0);
        assert.equal(await page.getByRole("button", { name: t.chooseImage, exact: true }).first().isDisabled(), true);
      }
      await sendLocation();
      assert.deepEqual(writes, []);
    }
    await page.getByRole("tab", { name: t.placements, exact: true }).click();
    await page.getByRole("heading", { name: map.name, exact: true }).waitFor();
    await page.waitForLoadState("networkidle");
    for (const panel of ["list", "sidebar"]) assert.ok(await page.locator(`[data-map-panel="${panel}"]`).evaluate(node => node.scrollWidth <= node.clientWidth), `${panel} controls must fit their column`);
    if (shop) {
      await page.getByRole("tab", { name: t.pointDetails, exact: true }).click();
      await page.getByLabel(t.pointName, { exact: true }).waitFor();
    }
    if (capture) {
      await page.locator('[data-map-panel="viewer"]').evaluate(node => node.parentElement.parentElement.scrollTo(0, 0));
      await page.screenshot({ path: `${capture}/${activityType}-editor-${language}-${theme}-${width}-${writable}-${archived}.png`, fullPage: true, animations: "disabled" });
      if (width < 996) {
        await page.getByLabel(t.name, { exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${capture}/${activityType}-settings-${language}-${width}.png`, animations: "disabled" });
        await page.locator('[data-map-panel="sidebar"]').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${capture}/${activityType}-sidebar-${language}-${width}.png`, animations: "disabled" });
      }
    }
    if (shop && language === "zh" && width === 1440 && writable && !archived) {
      activity.points = [];
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("button", { name: t.addPoint, exact: true }).waitFor();
      assert.equal(await page.locator("[data-map-panel]").count(), 3, "empty check-in activities also use the three-column workspace");
      assert.equal(await page.getByLabel(t.pointName, { exact: true }).count(), 0);
      if (capture) await page.screenshot({ path: `${capture}/shop-empty-zh-light-1440.png`, fullPage: true, animations: "disabled" });
      await page.getByRole("button", { name: t.addPoint, exact: true }).click();
      await page.getByLabel(t.pointName, { exact: true }).fill("First stop");
      await sendLocation();
      await save.click();
      await page.waitForLoadState("networkidle");
      assert.equal(activity.points.length, 1);
      assert.equal(activity.points[0].name, "First stop");
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${activityType} editor ${language}/${theme}/${width} writable=${writable} archived=${archived}: new tab, layout, draft, map, save and permissions`);
    await context.close();
  }
} finally { await browser.close(); }

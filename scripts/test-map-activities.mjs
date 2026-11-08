/** Browser regression for the map activity dialog; all API data and writes are isolated fixtures. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const origin = process.env.MANAGE_TEST_ORIGIN ?? "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname), "Use a local test server");
const teamId = "11111111-1111-4111-8111-111111111111";
const mapId = "22222222-2222-4222-8222-222222222222";
const captureDir = process.env.MAP_ACTIVITIES_SCREENSHOTS;
if (captureDir) await mkdir(captureDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [language, dark, width, readOnly, archived] of [
    ["zh", false, 1440, false, false], ["en", true, 1440, false, false],
    ["zh", true, 390, false, false], ["en", false, 390, false, false],
    ["en", false, 320, false, false],
    ["en", false, 1440, true, false], ["zh", false, 1440, false, true],
  ]) {
    const locale = JSON.parse(await readFile(new URL(`../locales/${language}.json`, import.meta.url), "utf8"));
    const text = locale.activities;
    const writable = !readOnly && !archived;
    const height = width === 320 ? 568 : 900;
    const context = await browser.newContext({ viewport: { width, height } });
    const collection = { id: mapId, organization_id: teamId, name: language === "zh" ? "街区活动地图" : "Neighborhood activity map", archived_at: archived ? "2026-11-01T00:00:00Z" : null, capabilities: { can_edit: writable, can_archive: !readOnly } };
    const activities = ["Neighborhood check-in and community messages", "Weekend route"].map((name, index) => ({
      id: `activity-${index}`, name, organization_id: teamId, type: "danmaku", state: "active", lock_version: 1,
      config: {}, points: [], location: { longitude: 121.5, latitude: 31.2 }, radius_meters: 100,
      capabilities: { can_read: true, can_edit: !readOnly },
    }));
    const makePlacement = (activity, status = "active") => ({
      id: `placement-${activity.id}`, activity_id: activity.id, organization_id: teamId, workspace_id: mapId,
      activity_name: activity.name, activity_type: activity.type, workspace_name: collection.name,
      status, lock_version: 1, capabilities: { can_read: true, can_edit: writable },
    });
    const placements = [makePlacement(activities[0])];
    const mutations = [];
    let failPlacements = false;
    let conflict = false;
    let failWrite = false;
    await context.addCookies([{ name: "better-auth.session_token", value: "map-activities-fixture", url: origin }, { name: "language", value: language, url: origin }]);
    await context.route("**/api/**", async (route) => {
      const request = route.request(), path = new URL(request.url()).pathname;
      const method = request.method();
      let status = 200, body = { data: [], page: { total: 0, hasMore: false, limit: 30, offset: 0 } };
      if (method !== "GET") {
        assert.ok(writable, "read-only map must not write");
        const input = request.postDataJSON();
        mutations.push({ path, method, input });
        if (path === `/api/activity-placements/${placements[0].id}` && method === "PATCH") {
          assert.deepEqual(Object.keys(input).sort(), ["expectedLockVersion", "status"]);
          assert.equal(input.expectedLockVersion, placements[0].lock_version);
          if (conflict) { status = 409; body = { code: "LOCK_VERSION_CONFLICT", error: "Fixture conflict" }; }
          else if (failWrite) { status = 500; body = { error: "Fixture write failure" }; }
          else { placements[0].status = input.status; placements[0].lock_version++; body = { data: placements[0] }; }
        } else if (path === `/api/activities/${activities[1].id}/placements` && method === "POST") {
          assert.equal(input.workspaceId, mapId);
          assert.ok(input.idempotencyKey);
          const placement = makePlacement(activities[1], input.status);
          placements.push(placement);
          body = { data: placement };
        } else assert.fail(`Unexpected mutation: ${method} ${path}`);
      } else if (path === "/api/auth/get-session") body = { user: { id: "fixture", name: "Fixture", email: "fixture@example.invalid" }, session: { id: "fixture", expiresAt: "2099-01-01" } };
      else if (path === "/api/auth/role") body = { role: "user" };
      else if (path === "/api/organizations") body = { data: [{ id: teamId, name: "Fixture team", role: readOnly ? "viewer" : "owner", allowed_file_types: ["text", "image"] }] };
      else if (path === `/api/organizations/${teamId}/collections`) body = { data: [collection] };
      else if (path === `/api/collections/${mapId}`) body = { data: collection };
      else if (path === `/api/organizations/${teamId}/activities`) body = { data: activities };
      else if (path === `/api/collections/${mapId}/activity-placements`) {
        body = { data: placements };
        if (failPlacements) { status = 500; body = { error: "Fixture read failure" }; }
      } else if (path === "/api/tags") body = { tags: [] };
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    // Exercise the real parent message bridge without loading Cesium or external map tiles.
    await context.route("**/js/viewer/index.html*", (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body style="margin:0;background:#e5e7eb;display:grid;place-items:center;height:100vh;font:16px sans-serif;color:#475569">Map fixture<script>window.items=[];addEventListener('message',event=>{if(event.data.type==='SET_ASSETS') window.items=event.data.payload;});parent.postMessage({type:'VIEWER_READY',source:'viewer',version:1},location.origin);</script></body></html>` }));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const url = `${origin}/manage/collections/${mapId}?organizationId=${teamId}`;
    await page.goto(url, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
    const trigger = page.locator("header").getByRole("button", { name: text.title, exact: true });
    await trigger.waitFor();
    assert.equal(await page.getByRole("tab", { name: text.title, exact: true }).count(), 0, "activities must leave the sidebar");
    const anchors = page.getByRole("tab", { name: language === "zh" ? "识别目标" : "Anchors", exact: true });
    await anchors.click();
    await trigger.scrollIntoViewIfNeeded();
    const iframe = await page.locator('iframe[title="3D Viewer"]').elementHandle();
    const frame = await iframe.contentFrame();
    await frame.waitForFunction(() => window.items.length === 1);
    const bounds = await iframe.boundingBox();
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: text.title, exact: true });
    await dialog.getByRole("heading", { name: activities[0].name, exact: true }).waitFor();
    assert.deepEqual(await iframe.boundingBox(), bounds, "opening activities must not resize the map");
    assert.equal(await iframe.evaluate((node) => node.isConnected), true, "viewer must stay mounted");
    const dialogBounds = await dialog.boundingBox();
    assert.ok(dialogBounds.x >= 0 && dialogBounds.x + dialogBounds.width <= width && dialogBounds.y >= 0 && dialogBounds.y + dialogBounds.height <= height);
    assert.ok(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth), "dialog must not overflow horizontally");
    if (captureDir && writable) await page.screenshot({ path: `${captureDir}/${language}-${dark ? "dark" : "light"}-${width}.png`, animations: "disabled" });
    if (!writable) {
      assert.equal(await dialog.getByRole("button", { name: text.placeExisting, exact: true }).count(), 0);
      assert.equal(await dialog.getByRole("button", { name: text.unlink, exact: true }).count(), 0);
    } else {
      await dialog.getByRole("combobox").first().click();
      assert.deepEqual(await page.getByRole("option").allTextContents(), [text.mapStates.active, text.mapStates.paused]);
      await page.keyboard.press("Escape");
    }
    const libraryLink = dialog.getByRole("link", { name: text.manage, exact: true });
    assert.equal(await libraryLink.getAttribute("target"), "_blank");
    assert.equal(await dialog.getByText(text.mapHint, { exact: true }).count(), 0);
    assert.equal(await dialog.getByText(text.placementRelationHint, { exact: true }).count(), 0);
    assert.equal(await dialog.getByRole("button", { name: text.editPlacement, exact: true }).count(), 0);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await anchors.getAttribute("data-state"), "active", "close must preserve the list tab");
    assert.equal(await trigger.evaluate((node) => document.activeElement === node), true);
    assert.deepEqual(await iframe.boundingBox(), bounds);

    // Marker clicks highlight the matching row; status changes save directly in that row.
    await frame.evaluate(() => parent.postMessage({ type: "ASSET_CLICKED", payload: { assetId: window.items[0].id }, source: "viewer", version: 1 }, location.origin));
    const highlighted = dialog.locator('li[aria-current="true"]');
    await highlighted.getByRole("heading", { name: activities[0].name, exact: true }).waitFor();
    const statusControl = highlighted.getByRole("combobox", { name: `${activities[0].name} · ${text.placementStatus}`, exact: true });
    await statusControl.waitFor();
    assert.equal(await dialog.getByLabel(text.map, { exact: true }).count(), 0);
    assert.equal(await dialog.getByRole("button", { name: text.savePlacement, exact: true }).count(), 0, "inline status changes need no separate save step");
    if (!writable) {
      assert.equal(await statusControl.isDisabled(), true);
    } else if (width === 1440 && language === "zh") {
      const chooseStatus = async (status) => {
        await statusControl.click();
        assert.deepEqual(await page.getByRole("option").allTextContents(), [text.mapStates.active, text.mapStates.paused]);
        await page.getByRole("option", { name: text.mapStates[status], exact: true }).click();
      };
      conflict = true;
      await chooseStatus("paused");
      await highlighted.getByText(text.conflict, { exact: true }).waitFor();
      assert.equal(await statusControl.innerText(), text.mapStates.paused, "conflict keeps the user's choice visible");
      assert.equal(await statusControl.isDisabled(), true, "a conflict requires reloading before another write");
      conflict = false;
      placements[0].lock_version++;
      await Promise.all([
        page.waitForResponse((response) => response.url().includes(`/collections/${mapId}/activity-placements`)),
        highlighted.getByRole("button", { name: text.reload, exact: true }).click(),
      ]);
      await statusControl.getByText(text.mapStates.active, { exact: true }).waitFor();
      await chooseStatus("paused");
      await page.waitForFunction(() => document.querySelector('li[aria-current="true"]')?.getAttribute('aria-busy') === 'false');
      assert.equal(placements[0].status, "paused");
      assert.equal(mutations[1].input.expectedLockVersion, 2, "reloading must use the current lock version");
      failWrite = true;
      await chooseStatus("active");
      const retryWrite = highlighted.getByRole("button", { name: locale.contentModel.action.retry, exact: true });
      await retryWrite.waitFor();
      failWrite = false;
      await retryWrite.click();
      await retryWrite.waitFor({ state: "hidden" });
      assert.equal(placements[0].status, "active");
      await dialog.getByRole("button", { name: text.placeExisting, exact: true }).click();
      await dialog.getByRole("combobox", { name: text.chooseActivity, exact: true }).click();
      await page.getByRole("option", { name: activities[1].name, exact: true }).click();
      assert.equal(await dialog.getByText(text.placementRelationHint, { exact: true }).count(), 0);
      const formStatus = dialog.getByLabel(text.placementStatus, { exact: true });
      assert.equal(await formStatus.innerText(), text.mapStates.paused, "new map links default to paused");
      await formStatus.click();
      assert.deepEqual(await page.getByRole("option").allTextContents(), [text.mapStates.active, text.mapStates.paused]);
      await page.keyboard.press("Escape");
      if (captureDir) await page.screenshot({ path: `${captureDir}/create.png`, animations: "disabled" });
      await dialog.getByRole("button", { name: text.savePlacement, exact: true }).click();
      await dialog.getByRole("heading", { name: activities[1].name, exact: true }).waitFor();
      assert.equal(placements[1].status, "paused");
      await frame.waitForFunction(() => window.items.length === 2);
      assert.equal(mutations.length, 5);

      const originalId = placements[0].id;
      failWrite = true;
      await highlighted.getByRole("button", { name: text.unlink, exact: true }).click();
      await highlighted.getByRole("button", { name: locale.contentModel.action.retry, exact: true }).waitFor();
      assert.equal(placements[0].status, "active", "failed unlink preserves the map relation");
      assert.equal(await statusControl.innerText(), text.mapStates.active, "unlink must not masquerade as a status change");
      failWrite = false;
      await highlighted.getByRole("button", { name: locale.contentModel.action.retry, exact: true }).click();
      await highlighted.waitFor({ state: "hidden" });
      await frame.waitForFunction(() => window.items.length === 1);
      assert.equal(placements[0].status, "archived");
      assert.equal(activities[0].state, "active", "unlink must not archive the activity itself");
      assert.equal(placements.length, 2, "unlink retains the relation identity for its history");
      assert.equal(placements[1].status, "paused", "other links are unaffected");
      await dialog.getByRole("button", { name: text.placeExisting, exact: true }).click();
      await dialog.getByRole("combobox", { name: text.chooseActivity, exact: true }).click();
      await page.getByRole("option", { name: activities[0].name, exact: true }).click();
      assert.equal(await dialog.getByLabel(text.placementStatus, { exact: true }).innerText(), text.mapStates.paused);
      await dialog.getByRole("button", { name: text.savePlacement, exact: true }).click();
      await dialog.getByRole("heading", { name: activities[0].name, exact: true }).waitFor();
      await frame.waitForFunction(() => window.items.length === 2);
      assert.equal(placements[0].id, originalId);
      assert.equal(placements[0].status, "paused");
      assert.equal(mutations.filter((entry) => entry.method === "POST").length, 1, "relink restores the existing relation");
      assert.equal(mutations.length, 8);
    }
    await dialog.getByRole("button", { name: locale.common.close, exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await anchors.getAttribute("data-state"), "active");
    await trigger.click();
    await dialog.getByRole("heading", { name: activities[0].name, exact: true }).waitFor();
    assert.equal(await dialog.getByRole("combobox").count(), placements.length, "every relation has an inline status control");
    assert.equal(await dialog.locator('li[aria-current="true"]').count(), 0, "reopen clears the marker highlight");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    if (width === 1440 && language === "zh" && writable) {
      failPlacements = true;
      await trigger.click();
      const retry = dialog.getByRole("button", { name: locale.contentModel.action.retry, exact: true });
      await retry.waitFor();
      failPlacements = false;
      await retry.click();
      await dialog.getByRole("heading", { name: activities[0].name, exact: true }).waitFor();
      await page.keyboard.press("Escape");

      // A long list scrolls independently; global actions stay inside the dialog.
      const originalPlacements = [...placements];
      for (let index = 0; index < 12; index++) placements.push({ ...makePlacement(activities[0]), id: `extra-${index}`, activity_name: `Long activity ${index} — community messages and neighborhood stories` });
      await trigger.click();
      await dialog.getByRole("heading", { name: "Long activity 11 — community messages and neighborhood stories", exact: true }).waitFor();
      await dialog.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished)));
      const footerAction = dialog.getByRole("button", { name: text.placeExisting, exact: true });
      const beforeScroll = await footerAction.boundingBox();
      const listRegion = dialog.locator("div.overflow-y-auto");
      await listRegion.evaluate((node) => { node.scrollTop = node.scrollHeight; });
      assert.deepEqual(await footerAction.boundingBox(), beforeScroll, "footer must stay fixed while the activity list scrolls");
      assert.ok(beforeScroll.y + beforeScroll.height <= 900);
      if (captureDir) await page.screenshot({ path: `${captureDir}/long-list.png`, animations: "disabled" });
      await page.keyboard.press("Escape");

      placements.length = 0;
      await trigger.click();
      await dialog.getByRole("heading", { name: text.noPlacements, exact: true }).waitFor();
      await dialog.getByRole("button", { name: text.placeExisting, exact: true }).waitFor();
      if (captureDir) await page.screenshot({ path: `${captureDir}/empty.png`, animations: "disabled" });
      await page.keyboard.press("Escape");
      placements.push(...originalPlacements);
    }
    await page.goto(`${url}&tab=activities`, { waitUntil: "networkidle" });
    await dialog.getByRole("heading", { name: activities[0].name, exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await page.goto(url, { waitUntil: "networkidle" });
    await trigger.waitFor();
    assert.equal(await dialog.count(), 0, "activity dialog state must not leak into another map visit");
    assert.deepEqual(errors, []);
    console.log(`PASS map activities ${language} ${dark ? "dark" : "light"} ${width}${readOnly ? " viewer" : archived ? " archived" : ""}`);
    await context.close();
  }
} finally { await browser.close(); }

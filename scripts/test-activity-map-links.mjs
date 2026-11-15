/** Activity detail association workflow; all data and writes are isolated browser fixtures. */
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const origin = process.env.MANAGE_TEST_ORIGIN ?? "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const team = "11111111-1111-4111-8111-111111111111", activityId = "33333333-3333-4333-8333-333333333333";
const capture = process.env.MAP_ACTIVITIES_SCREENSHOTS;
if (capture) await mkdir(capture, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [language, dark, width, writable] of [["zh", false, 1440, true], ["en", true, 1440, true], ["zh", true, 390, true], ["en", false, 320, true], ["en", false, 1440, false]]) {
    const locale = JSON.parse(await readFile(new URL(`../locales/${language}.json`, import.meta.url), "utf8"));
    const t = locale.activities;
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const maps = ["Map A", "Map B"].map((name, index) => ({ id: `22222222-2222-4222-8222-22222222222${index}`, name, organization_id: team, archived_at: null, capabilities: { can_edit: writable } }));
    const activity = { id: activityId, name: "Single-map activity", type: "danmaku", organization_id: team, description: null, config: {}, points: [], location: null, radius_meters: null,
      state: "active", lock_version: 1, has_map_link: true, capabilities: { can_read: true, can_edit: writable } };
    const makePlacement = (map) => ({ id: `placement-${map.id}`, activity_id: activityId, activity_name: activity.name, activity_type: activity.type, organization_id: team,
      workspace_id: map.id, workspace_name: map.name, status: "paused", lock_version: 1, capabilities: { can_read: true, can_edit: writable } });
    const links = [makePlacement(maps[0])], writes = [];
    const originalId = links[0].id;
    await context.addCookies([{ name: "better-auth.session_token", value: "activity-links-fixture", url: origin }, { name: "language", value: language, url: origin }]);
    await context.route("**/api/**", async (route) => {
      const request = route.request(), path = new URL(request.url()).pathname;
      let body = { data: [] };
      if (request.method() !== "GET") {
        assert.ok(writable);
        const input = request.postDataJSON(); writes.push({ method: request.method(), input });
        if (request.method() === "POST" && path === `/api/activities/${activityId}/placements`) {
          assert.equal(activity.has_map_link, false);
          assert.ok(["active", "paused"].includes(input.status));
          assert.ok(input.idempotencyKey);
          const link = { ...makePlacement(maps.find((map) => map.id === input.workspaceId)), status: input.status };
          links.push(link); body = { data: link }; activity.has_map_link = true;
        } else {
          assert.equal(request.method(), "PATCH");
          const link = links.find((entry) => path === `/api/activity-placements/${entry.id}`);
          assert.ok(link); assert.equal(input.expectedLockVersion, link.lock_version);
          assert.deepEqual(Object.keys(input).sort(), ["expectedLockVersion", "status"]);
          assert.ok(input.status === "archived" || links.every((entry) => entry.id === link.id || entry.status === "archived"));
          link.status = input.status; link.lock_version++;
          activity.has_map_link = input.status !== "archived";
          body = { data: link };
        }
      } else if (path === "/api/auth/get-session") body = { user: { id: "fixture", name: "Fixture", email: "fixture@example.invalid" }, session: { id: "fixture", expiresAt: "2099-01-01" } };
      else if (path === "/api/auth/role") body = { role: "user" };
      else if (path === "/api/organizations") body = { data: [{ id: team, name: "Fixture team", role: writable ? "owner" : "viewer", allowed_file_types: ["text"] }] };
      else if (path === `/api/organizations/${team}/collections`) body = { data: maps };
      else if (path === `/api/activities/${activityId}`) body = { data: activity };
      else if (path === `/api/activities/${activityId}/placements`) body = { data: links };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    await context.route("**/js/viewer/index.html*", (route) => route.fulfill({ contentType: "text/html", body: '<html><body><script>parent.postMessage({type:"VIEWER_READY",source:"viewer",version:1},location.origin)</script></body></html>' }));
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/manage/activities/${activityId}?organizationId=${team}`, { waitUntil: "networkidle" });
    if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.getByRole("tab", { name: t.placements, exact: true }).click();
    const panel = page.getByRole("tabpanel", { name: t.placements, exact: true });
    await panel.getByRole("heading", { name: maps[0].name, exact: true }).waitFor();
    const add = panel.getByRole("button", { name: t.place, exact: true });
    if (!writable) {
      assert.equal(await add.count(), 0);
      assert.equal(await panel.getByRole("button", { name: t.unlink, exact: true }).count(), 0);
    } else {
      assert.equal(await add.isDisabled(), true, "paused associations still block a second map");
      await panel.getByRole("button", { name: t.editPlacement, exact: true }).click();
      assert.equal(await panel.getByLabel(t.map, { exact: true }).isDisabled(), true);
      await panel.getByLabel(t.placementStatus, { exact: true }).click();
      assert.deepEqual(await page.getByRole("option").allTextContents(), [t.mapStates.active, t.mapStates.paused]);
      await page.keyboard.press("Escape");
      await panel.getByRole("button", { name: t.cancel, exact: true }).click();
      const unlink = async () => {
        await panel.getByRole("button", { name: t.unlink, exact: true }).click();
        await panel.getByRole("heading", { name: t.noPlacements, exact: true }).waitFor();
        assert.equal(await add.isEnabled(), true);
      };
      const link = async (map) => {
        await add.click();
        assert.equal(await panel.getByLabel(t.placementStatus, { exact: true }).innerText(), t.mapStates.paused);
        await panel.getByLabel(t.map, { exact: true }).click();
        await page.getByRole("option", { name: map.name, exact: true }).click();
        await panel.getByRole("button", { name: t.savePlacement, exact: true }).click();
        await panel.getByRole("heading", { name: map.name, exact: true }).waitFor();
        assert.equal(await add.isDisabled(), true);
      };
      await unlink(); await link(maps[1]);
      assert.equal(links[0].status, "archived");
      assert.equal(activity.has_map_link, true);
      await unlink(); await link(maps[0]);
      assert.equal(links[0].id, originalId);
      assert.equal(links[0].status, "paused");
      assert.equal(links[1].status, "archived");
      assert.equal(writes.filter((write) => write.method === "POST").length, 1, "returning to a previous map restores its original association");
    }
    assert.ok(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth), "association controls must fit narrow screens");
    if (capture) await page.screenshot({ path: `${capture}/detail-${language}-${dark ? "dark" : "light"}-${width}-${writable}.png`, animations: "disabled" });
    assert.deepEqual(errors, []);
    console.log(`PASS activity map links ${language} ${dark ? "dark" : "light"} ${width} writable=${writable}`);
    await context.close();
  }
} finally { await browser.close(); }

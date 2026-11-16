/** Super-admin cross-team copy UI. API reads/writes and map rendering use isolated fixtures. */
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
const origin = process.env.MANAGE_TEST_ORIGIN ?? "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const team = id(1), destination = id(2), otherTeam = id(3), archivedTeam = id(4), mapId = id(5), destinationMap = id(6);
const assetId = id(7), sceneId = id(8), activityId = id(9), placementId = id(10), anchorId = id(11);
const capture = process.env.CONTENT_DUPLICATE_SCREENSHOTS;
if (capture) await mkdir(capture, { recursive: true });
const darkTheme = (await readFile(new URL("../app/globals.css", import.meta.url), "utf8")).match(/\.dark\s*\{[^}]+\}/)?.[0];
const browser = await chromium.launch();
try {
  for (const [language, dark, width, role, archived] of [
    ["zh", false, 1440, "super_admin", false], ["en", true, 1440, "super_admin", false],
    ["zh", true, 390, "super_admin", false], ["en", false, 320, "super_admin", false],
    ["en", false, 1440, "user", false], ["zh", false, 1440, "super_admin", true],
  ]) {
    const locale = JSON.parse(await readFile(new URL(`../locales/${language}.json`, import.meta.url), "utf8"));
    const t = locale.contentModel.crossCopy;
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: "better-auth.session_token", value: "copy-fixture", url: origin }, { name: "language", value: language, url: origin }]);
    const capabilities = { can_read: true, can_edit: true, can_archive: true, can_maintain: true, can_use_in_workspace: true, can_copy: true };
    const asset = { id: assetId, organization_id: team, name: "Source asset", file_type: "text", payload: { kind: "text", text: "Independent text" }, resources: [], state: "active", lock_version: 1,
      origin: "team_upload", visibility: "organization", maintained_by: null, maintainer: null, created_by: null, create_at: "2026-11-16T00:00:00Z", updated_at: "2026-11-16T00:00:00Z", usage_count: 0, capabilities };
    const anchor = { ...asset, id: anchorId, name: "Source anchor", file_type: "anchor", payload: { kind: "anchor" }, resources: [] };
    const scene = { id: sceneId, organization_id: team, name: "Source scene", state: "active", lock_version: 1, document: { schemaVersion: 6, content: { assets: {}, instances: [], durationSeconds: 10, loop: false } }, resources: [], updated_at: asset.updated_at, capabilities };
    const activity = { id: activityId, organization_id: team, name: "Source activity", state: "active", lock_version: 1, type: "danmaku", config: {}, points: [], location: null, radius_meters: null, has_map_link: false, updated_at: asset.updated_at, capabilities };
    const map = { id: mapId, organization_id: team, name: "Source map", description: null, archived_at: null, create_date: asset.updated_at, config_lock_version: 1,
      miniapp_config: { retrieval_mode: "gps", text_asset_miniapp_style: "dialog_decorated", confetti_enabled: false, footer_enabled: false }, capabilities };
    const targetMap = { ...map, id: destinationMap, organization_id: destination, name: "Destination map" };
    const placement = { id: placementId, organization_id: team, workspace_id: mapId, workspace_name: map.name, name: "Source placement", target: { kind: "asset", asset_id: assetId, asset_name: asset.name, file_type: "text", asset_state: "active", asset_lock_version: 1 }, status: "active", lock_version: 1, tag_ids: [], anchor_id: null, render_config: {}, location: { latitude: 31.2, longitude: 121.4, altitude: 0 }, capabilities };
    const attempts = [];
    let failCopies = false, failMaps = false;
    const list = data => ({ data, page: { total: data.length, hasMore: false, limit: 30, offset: 0 } });
    await context.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      let body = list([]), status = 200;
      if (request.method() !== "GET") {
        assert.equal(path, "/api/content/duplicate"); assert.equal(request.method(), "POST"); assert.equal(role, "super_admin"); assert.equal(archived, false);
        const input = request.postDataJSON(); attempts.push(input);
        assert.ok(input.idempotencyKey); assert.notEqual(input.targetOrganizationId, team); assert.notEqual(input.targetOrganizationId, archivedTeam);
        if (failCopies) { status = 500; body = { code: "INTERNAL", error: "Fixture failure; retry" }; }
        else body = { data: { id: id(100 + attempts.length), sourceType: input.sourceType, organizationId: input.targetOrganizationId, created: true } };
      } else if (path === "/api/auth/get-session") body = { user: { id: "fixture", name: "Fixture", email: "fixture@example.invalid" }, session: { id: "fixture", expiresAt: "2099-01-01" } };
      else if (path === "/api/auth/role") body = { role };
      else if (path === "/api/organizations") body = { data: [
        { id: team, name: "Source team", role: "owner", allowed_file_types: ["text", "anchor"], archived_at: archived ? asset.updated_at : null },
        { id: destination, name: "Destination team", role: "owner" }, { id: otherTeam, name: "Other team", role: "owner" }, { id: archivedTeam, name: "Archived team", role: "owner", archived_at: asset.updated_at },
      ] };
      else if (path === `/api/organizations/${team}/assets`) body = list(url.searchParams.get("file_type") === "anchor" ? [anchor] : [asset]);
      else if (path === `/api/organizations/${team}/scenes`) body = list([scene]);
      else if (path === `/api/organizations/${team}/activities`) body = list([activity]);
      else if (path === `/api/organizations/${team}/collections`) body = list([map]);
      else if (path === `/api/organizations/${destination}/collections`) {
        if (failMaps) { status = 500; body = { error: "Unavailable", code: "INTERNAL" }; }
        else body = list([targetMap, { ...targetMap, id: id(99), archived_at: asset.updated_at, name: "Archived map" }]);
      } else if (path === `/api/assets/${assetId}`) body = { data: asset };
      else if (path === `/api/assets/${anchorId}`) body = { data: anchor };
      else if (/\/assets\/[^/]+\/usage$/.test(path)) body = { data: { impact: { scenes: 0, placements: 0, activities: 0, restricted_count: 0, items: [] } } };
      else if (path === `/api/scenes/${sceneId}`) body = { data: scene };
      else if (path === `/api/activities/${activityId}`) body = { data: activity };
      else if (path === `/api/collections/${mapId}`) body = { data: map };
      else if (path === `/api/collections/${mapId}/placements`) body = list([placement]);
      else if (path === `/api/placements/${placementId}/content`) body = { data: { kind: "asset", placement_id: placementId, workspace_id: mapId, organization_id: team, asset_id: assetId, file_type: "text", payload: asset.payload, resources: [], lock_version: 1 } };
      else if (path === "/api/tags") body = { tags: [] };
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    await context.route("**/js/viewer/index.html*", route => route.fulfill({ contentType: "text/html", body: '<html><body><script>parent.postMessage({type:"VIEWER_READY",source:"viewer",version:1},location.origin)</script></body></html>' }));
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const go = async path => {
      await page.goto(`${origin}/manage/${path}?organizationId=${team}`, { waitUntil: "networkidle" });
      await page.addStyleTag({ content: `nextjs-portal{display:none!important}${dark ? darkTheme : ""}` });
      await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark);
    };
    const choose = async (dialog, label, option) => { await dialog.getByRole("combobox", { name: label, exact: true }).click(); await page.getByRole("option", { name: option, exact: true }).click(); };
    const triggerFor = name => page.getByRole("button", { name: t.namedAction.replace("{{name}}", name), exact: true });
    await go("scenes");
    if (role !== "super_admin" || archived) {
      assert.equal(await triggerFor(scene.name).count(), 0);
      for (const path of ["assets", "anchors", "activities", "collections"]) { await go(path); assert.equal(await page.getByRole("button", { name: new RegExp(`^${t.action}`) }).count(), 0); }
      assert.equal(attempts.length, 0);
    } else {
      await triggerFor(scene.name).click();
      let dialog = page.getByRole("dialog", { name: t.action, exact: true });
      const submit = () => dialog.getByRole("button", { name: t.submit, exact: true });
      assert.equal(await submit().isDisabled(), true);
      await dialog.getByRole("combobox", { name: t.team, exact: true }).click();
      assert.deepEqual(await page.getByRole("option").allTextContents(), ["Destination team", "Other team"]);
      await page.getByRole("option", { name: "Destination team", exact: true }).click();
      await dialog.getByRole("textbox", { name: t.name, exact: true }).fill("Copied scene");
      assert.ok(await dialog.getByText(t.description.scene, { exact: true }).isVisible());
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 900);
      assert.ok(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth), "dialog fits narrow viewport");
      if (capture) await page.screenshot({ path: `${capture}/${language}-${dark ? "dark" : "light"}-${width}.png`, animations: "disabled" });
      if (width === 1440 && language === "zh") {
        failCopies = true; await submit().click(); await dialog.getByRole("alert").waitFor();
        assert.equal(await dialog.getByRole("textbox", { name: t.name, exact: true }).inputValue(), "Copied scene");
        await submit().click(); await dialog.getByRole("alert").waitFor();
        assert.equal(attempts[0].idempotencyKey, attempts[1].idempotencyKey, "network/server retries reuse the same command");
        await choose(dialog, t.team, "Other team"); await submit().click(); await dialog.getByRole("alert").waitFor();
        assert.notEqual(attempts[1].idempotencyKey, attempts[2].idempotencyKey, "changing destination creates a new intent");
        failCopies = false;
      }
      await submit().click(); await dialog.waitFor({ state: "hidden" });
      assert.equal(attempts.at(-1).sourceType, "scene"); assert.equal(new URL(page.url()).pathname, "/manage/scenes");
      // All library entry points use the same dialog and submit the concrete source identity.
      if (width === 1440) {
        for (const [path, sourceType, name, sourceId] of [["assets", "asset", asset.name, assetId], ["anchors", "asset", anchor.name, anchorId], ["activities", "activity", activity.name, activityId], ["collections", "collection", map.name, mapId]]) {
          await go(path); await triggerFor(name).click(); dialog = page.getByRole("dialog", { name: t.action, exact: true });
          await choose(dialog, t.team, "Destination team"); await submit().click(); await dialog.waitFor({ state: "hidden" });
          assert.equal(attempts.at(-1).sourceType, sourceType); assert.equal(attempts.at(-1).sourceId, sourceId);
        }
        await go(`collections/${mapId}`); await page.locator(`#placement-card-${placementId}`).click();
        await triggerFor(placement.name).click(); dialog = page.getByRole("dialog", { name: t.action, exact: true });
        failMaps = true; await choose(dialog, t.team, "Destination team"); await dialog.getByRole("alert").waitFor();
        assert.equal(await submit().isDisabled(), true); failMaps = false;
        await dialog.getByRole("button", { name: locale.contentModel.action.retry, exact: true }).click();
        await choose(dialog, t.map, "Destination map");
        await choose(dialog, t.team, "Other team");
        await dialog.getByText(t.noMaps, { exact: true }).waitFor(); assert.equal(await submit().isDisabled(), true, "old map must not cross team switches");
        await choose(dialog, t.team, "Destination team"); await choose(dialog, t.map, "Destination map");
        await submit().click(); await dialog.waitFor({ state: "hidden" });
        assert.equal(attempts.at(-1).sourceType, "placement"); assert.equal(attempts.at(-1).targetWorkspaceId, destinationMap);
      }
    }
    assert.deepEqual(errors, []); await context.close();
    console.log(`PASS cross-team copy ${language} ${dark ? "dark" : "light"} ${width} ${role} archived=${archived}`);
  }
} finally { await browser.close(); }

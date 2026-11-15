/** Inspector tasks, drafts, explicit map locations and writes with isolated API/viewer fixtures. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const origin = process.env.MANAGE_TEST_ORIGIN ?? "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const teamId = "11111111-1111-4111-8111-111111111111", mapId = "22222222-2222-4222-8222-222222222222";
const capture = process.env.PLACEMENT_INSPECTOR_SCREENSHOTS;
if (capture) await mkdir(capture, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [language, theme, width, writable] of [
    ["zh", "light", 1440, true], ["en", "dark", 1100, true],
    ["zh", "dark", 820, true], ["en", "light", 390, true],
    ["en", "dark", 320, true], ["zh", "light", 1440, false],
  ]) {
    const t = (zh, en) => language === "zh" ? zh : en;
    const height = width === 320 ? 568 : 900;
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
    await context.addCookies([{ name: "better-auth.session_token", value: "inspector-fixture", url: origin }, { name: "language", value: language, url: origin }]);
    await context.addInitScript((theme) => localStorage.setItem("theme", theme), theme);
    const collection = { id: mapId, organization_id: teamId, name: "Inspector fixture", archived_at: null, capabilities: { can_read: true, can_edit: writable, can_archive: writable } };
    const assets = ["image", "text"].map((file_type, index) => ({ id: `asset-${index}`, organization_id: teamId, name: `Source ${index}`, file_type,
      state: "active", lock_version: 1, payload: file_type === "text" ? { kind: "text", text: "Example content" } : { kind: "image" }, resources: [],
      capabilities: { can_read: true, can_edit: writable }, usage_count: 1, updated_at: "2026-11-15T00:00:00Z" }));
    for (const [index, fileType, hasThumbnail] of [[2, "model", true], [3, "video", true], [4, "model", false]]) {
      const resource = (role, extension) => ({ role, ordinal: 0, url: `${origin}/fixtures/source-${index}-${role}.${extension}`, managed: false, storage_key: null, external_url: null, mime_type: null, size_bytes: null, content_hash: null });
      assets.push({ ...assets[0], id: `asset-${index}`, name: `Source ${index}`, file_type: fileType, payload: { kind: fileType },
        resources: [resource("primary", fileType === "model" ? "glb" : "mp4"), ...(hasThumbnail ? [resource("thumbnail", "png")] : [])] });
    }
    const scenes = ["Scene match", "Another scene"].map((name, index) => ({ id: `scene-${index}`, name, state: "active", updated_at: "2026-11-15T01:00:00Z" }));
    await context.route("**/fixtures/*-thumbnail.png", (route) => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") }));
    const makePlacement = (id, asset, name) => ({ id, organization_id: teamId, workspace_id: mapId, workspace_name: collection.name, name,
      target: { kind: "asset", asset_id: asset.id, asset_name: asset.name, file_type: asset.file_type, asset_state: "active", asset_lock_version: 1 },
      location: { longitude: 121.123456, latitude: 31.123456, altitude: 1 }, anchor_id: null, render_config: {}, status: "active", lock_version: 1,
      tag_ids: [], public_id: id, created_by: null, updated_by: null, created_at: "2026-11-15T00:00:00Z", updated_at: "2026-11-15T00:00:00Z",
      capabilities: { can_read: true, can_edit: writable, can_copy: writable, can_archive: writable } });
    const placements = [makePlacement("placement-image", assets[0], "Image placement"), makePlacement("placement-text", assets[1], "Text placement")];
    const writes = [];
    let failure = 0;
    await context.route("**/api/**", async (route) => {
      const req = route.request(), path = new URL(req.url()).pathname;
      let status = 200, body = { data: [], page: { total: 0, hasMore: false, limit: 30, offset: 0 } };
      if (req.method() !== "GET") {
        assert.ok(writable, "read-only inspector must not write");
        const input = req.postDataJSON(); writes.push({ method: req.method(), path, input });
        if (req.method() === "PATCH" && path.startsWith("/api/placements/")) {
          const placement = placements.find((item) => path === `/api/placements/${item.id}`); assert.ok(placement);
          if (failure || input.expectedLockVersion !== placement.lock_version) { status = failure || 409; body = { code: status === 409 ? "LOCK_VERSION_CONFLICT" : "INTERNAL_ERROR", error: "Fixture failure" }; }
          else { assert.equal(input.expectedLockVersion, placement.lock_version); if (input.name !== undefined) placement.name = input.name; if (input.location !== undefined) placement.location = input.location; placement.lock_version++; body = { data: placement }; }
        } else if (req.method() === "POST" && path === `/api/collections/${mapId}/placements`) {
          assert.ok(input.idempotencyKey); assert.equal(input.status, "active");
          assert.equal(input.location.longitude, 122); assert.equal(input.location.latitude, 32);
          let asset = assets.find((item) => item.id === input.target?.assetId);
          if (input.asset) { assert.equal(input.asset.fileType, "text"); assert.equal(input.asset.payload.text, "New text content"); asset = { ...assets[1], id: "new-text", name: input.asset.name, payload: input.asset.payload }; assets.push(asset); }
          assert.ok(asset);
          const placement = makePlacement(`created-${placements.length}`, asset, input.name || asset.name); placement.location = input.location; placements.push(placement);
          body = { data: { placement } };
        } else assert.fail(`Unexpected write: ${req.method()} ${path}`);
      } else if (path === "/api/auth/get-session") body = { user: { id: "fixture", name: "Fixture", email: "fixture@example.invalid" }, session: { id: "fixture", expiresAt: "2099-01-01" } };
      else if (path === "/api/auth/role") body = { role: "user" };
      else if (path === "/api/organizations") body = { data: [{ id: teamId, name: "Fixture", role: writable ? "owner" : "viewer", allowed_file_types: ["image", "text", "link"] }] };
      else if (path === `/api/organizations/${teamId}/collections`) body = { data: [collection] };
      else if (path === `/api/collections/${mapId}`) body = { data: collection };
      else if (path === `/api/collections/${mapId}/placements`) body = { data: placements };
      else if (path === `/api/organizations/${teamId}/assets`) {
        const query = new URL(req.url()).searchParams;
        // Keep the loading state observable when filters change.
        await new Promise((resolve) => setTimeout(resolve, 180));
        body = { data: assets.filter((asset) => (!query.get("file_type") || asset.file_type === query.get("file_type")) && asset.name.toLowerCase().includes((query.get("q") || "").toLowerCase())) };
      }
      else if (path === `/api/organizations/${teamId}/scenes`) body = { data: scenes };
      else if (path.startsWith("/api/assets/")) body = { data: assets.find((item) => path === `/api/assets/${item.id}`) };
      else if (path.startsWith("/api/placements/") && path.endsWith("/content")) {
        const p = placements.find((item) => path === `/api/placements/${item.id}/content`), a = assets.find((item) => item.id === p?.target.asset_id);
        assert.ok(a); body = { data: { kind: "asset", placement_id: p.id, public_id: p.id, asset_id: a.id, asset_lock_version: 1, file_type: a.file_type, payload: a.payload, resources: [] } };
      } else if (path === "/api/tags") body = { tags: [] };
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    await context.route("**/js/viewer/index.html*", (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><body style="margin:0;background:#e5e7eb;height:100vh"><button id="point" onclick="parent.postMessage({type:'LOCATION_CLICKED',payload:{longitude:122,latitude:32,height:2},source:'viewer',version:1},location.origin)">Pick point</button><script>parent.postMessage({type:'VIEWER_READY',source:'viewer',version:1},location.origin)</script>` }));
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/manage/collections/${mapId}?organizationId=${teamId}`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.evaluate((theme) => document.documentElement.classList.toggle("dark", theme === "dark"), theme);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), theme === "dark");
    const iframe = await page.locator('iframe[title="3D Viewer"]').elementHandle();
    const mapBounds = await iframe.boundingBox();
    const list = page.locator('[data-map-panel="list"]');
    const editor = page.locator('[data-placement-editor]:visible');
    const create = page.locator('[data-placement-create]:visible');
    const showList = async () => { if (width < 996 && !await list.isVisible()) await page.getByRole("button", { name: t("投放", "Placements"), exact: true }).click(); };
    const select = async (id) => { await showList(); await page.locator(`#placement-card-${id}`).click(); await editor.waitFor(); };
    const name = editor.getByLabel(t("投放名称", "Placement name"), { exact: true });
    const save = editor.getByRole("button", { name: t("保存投放", "Save placement"), exact: true });
    await select("placement-image");
    assert.equal(await create.count(), 0, "create and inspect are mutually exclusive");
    const bounds = await editor.boundingBox(), fieldBounds = await name.boundingBox();
    assert.ok(fieldBounds.y >= bounds.y && fieldBounds.y + fieldBounds.height <= bounds.y + bounds.height, "name is in the inspector's initial viewport");
    assert.equal(await editor.locator("img").count(), 0, "large previews aren't mounted in the inspector");
    assert.ok(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth));
    await editor.getByRole("button", { name: t("预览", "Preview"), exact: true }).click();
    await page.getByRole("dialog").waitFor(); await page.keyboard.press("Escape");
    if (!writable) {
      assert.equal(await name.isDisabled(), true); assert.equal(await save.count(), 0);
      assert.equal(await page.getByRole("button", { name: t("新增投放", "New placement"), exact: true }).count(), 0);
      assert.equal(await editor.getByLabel(t("经度", "Longitude"), { exact: true }).isDisabled(), true);
      assert.equal(await editor.getByRole("button", { name: t("地图选点", "Pick on map"), exact: true }).isDisabled(), true);
    } else {
      await name.fill("Retained draft"); await select("placement-text"); await select("placement-image");
      assert.equal(await name.inputValue(), "Retained draft", "switching objects retains unsaved edits");
      await editor.getByRole("button", { name: t("关闭", "Close"), exact: true }).click(); await select("placement-image");
      assert.equal(await name.inputValue(), "Retained draft", "closing retains edits");
      const actionBefore = await editor.locator("[data-inspector-actions]").boundingBox();
      await editor.locator("[data-inspector-scroll]").evaluate((el) => { el.scrollTop = el.scrollHeight; });
      assert.deepEqual(await editor.locator("[data-inspector-actions]").boundingBox(), actionBefore, "save stays anchored while fields scroll");
      if (width === 1440) {
        failure = 500; await save.click(); await editor.getByRole("alert").waitFor();
        assert.equal(await name.inputValue(), "Retained draft");
        failure = 409; placements[0].lock_version++; await save.click(); await editor.getByRole("button", { name: t("重新载入投放", "Reload placement"), exact: true }).waitFor();
        await select("placement-text"); await select("placement-image"); assert.equal(await name.inputValue(), "Retained draft");
        failure = 0;
        await save.click(); await editor.getByRole("button", { name: t("重新载入投放", "Reload placement"), exact: true }).waitFor();
        assert.equal(writes.at(-1).input.expectedLockVersion, 1, "restored draft retains its original lock");
        await editor.getByRole("button", { name: t("重新载入投放", "Reload placement"), exact: true }).click();
        await page.waitForFunction(() => document.querySelector('[data-placement-editor] input')?.value === 'Image placement');
        await name.fill("Retained draft");
      }
      await save.click(); await page.waitForFunction(() => document.querySelector('#placement-card-placement-image')?.textContent.includes('Retained draft'));
      await select("placement-text"); await select("placement-image"); assert.equal(await name.inputValue(), "Retained draft");
      assert.equal(await save.isDisabled(), true);
      const startCreate = async () => {
        if (width >= 996) await list.getByRole("button", { name: t("新增投放", "New placement"), exact: true }).click();
        else await page.getByRole("button", { name: t("新增投放", "New placement"), exact: true }).first().click();
        await create.waitFor(); assert.equal(await editor.count(), 0);
      };
      await startCreate();
      await create.getByRole("button", { name: t("选择投放内容", "Choose content"), exact: true }).click();
      let dialog = page.getByRole("dialog");
      for (const index of [2, 3]) {
        const thumbnail = dialog.getByRole("button", { name: new RegExp(`Source ${index}`) }).getByRole("img");
        await thumbnail.waitFor();
        assert.equal(await thumbnail.getAttribute("src"), `${origin}/fixtures/source-${index}-thumbnail.png`, "model/video uses its stored thumbnail, never the primary media file");
        await thumbnail.evaluate((img) => img.decode());
        assert.ok(await thumbnail.evaluate((img) => img.naturalWidth > 0));
      }
      assert.equal(await dialog.getByRole("button", { name: /Source 4/ }).getByRole("img").count(), 0, "a model without a thumbnail retains its type icon");
      assert.ok(await dialog.getByRole("button", { name: /Scene match/ }).isVisible(), "all categories includes scenes alongside assets");
      assert.equal(await dialog.getByRole("button", { name: t("团队素材", "Team assets"), exact: true }).count(), 0);
      assert.equal(await dialog.locator('[data-slot="dialog-close"]').count(), 1);
      assert.equal(await dialog.locator("[data-content-picker-actions]").count(), 0, "content picker has no redundant bottom action bar");
      await dialog.evaluate(async (el) => { await Promise.all(el.getAnimations().map((animation) => animation.finished)); });
      const search = dialog.getByRole("textbox", { name: t("搜索内容", "Search content"), exact: true });
      const category = dialog.getByRole("combobox", { name: t("内容类别", "Content category"), exact: true });
      const toolbarBounds = await dialog.locator("[data-source-toolbar]").boundingBox();
      const searchBounds = await search.boundingBox();
      const panelBounds = await dialog.locator('[data-slot="tabs-content"][data-state="active"]').boundingBox();
      const tabsBounds = await dialog.getByRole("tablist").boundingBox();
      assert.ok(searchBounds.y - panelBounds.y >= 4, "search focus ring fits inside the clipped panel");
      assert.ok(searchBounds.y - tabsBounds.y - tabsBounds.height >= 8, "tabs and search occupy separate rows without overlap");
      assert.equal(await dialog.getByRole("tablist").evaluate((el) => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)", "mode tabs have no background block");
      const changeCategory = async (label) => { await category.click(); await page.getByRole("option", { name: label, exact: true }).click(); };
      await page.evaluate(() => {
        window.pickerGeometry = [];
        const sample = () => {
          window.pickerGeometry.push([document.querySelector('[role="dialog"]'), document.querySelector('[role="dialog"] h2')].map((el) => {
            const { x, y, width, height } = el.getBoundingClientRect(); return { x, y, width, height };
          }));
          window.pickerGeometryFrame = requestAnimationFrame(sample);
        };
        sample();
      });
      await changeCategory(t("场景", "Scene"));
      await dialog.getByRole("button", { name: /Scene match/ }).waitFor();
      assert.equal(await dialog.getByRole("button", { name: /Source 2/ }).count(), 0);
      await search.fill("match");
      await dialog.getByRole("button", { name: /Another scene/ }).waitFor({ state: "hidden" });
      assert.ok(await dialog.getByRole("button", { name: /Scene match/ }).isVisible(), "search also filters scenes");
      await changeCategory(t("模型", "Model"));
      await dialog.getByText(t("没有符合条件的内容，试试其他关键词或类别。", "No matching content. Try another search or category."), { exact: true }).waitFor();
      assert.equal(await search.inputValue(), "match", "category changes preserve the search");
      assert.deepEqual(await dialog.locator("[data-source-toolbar]").boundingBox(), toolbarBounds, "search and category do not move for loading, scene or empty states");
      await dialog.getByRole("tab", { name: t("上传新素材", "New content"), exact: true }).click();
      const uploadType = dialog.getByRole("combobox", { name: t("内容类型", "Content type"), exact: true });
      await uploadType.click(); await page.getByRole("option", { name: t("文字", "Text"), exact: true }).click();
      await dialog.getByLabel(t("文字内容", "Text"), { exact: true }).waitFor();
      await uploadType.click(); await page.getByRole("option", { name: t("图片", "Image"), exact: true }).click();
      await dialog.getByRole("tab", { name: t("放置已有内容", "Place existing"), exact: true }).click();
      assert.equal(await search.inputValue(), "match", "switching upload mode preserves search and category");
      assert.equal(await category.innerText(), t("模型", "Model"));
      await search.fill("Source 2");
      await dialog.getByRole("button", { name: /Source 2/ }).waitFor();
      assert.equal(await dialog.getByRole("button", { name: /Source 4/ }).count(), 0, "model category and search are applied together");
      const frames = await page.evaluate(() => { cancelAnimationFrame(window.pickerGeometryFrame); return window.pickerGeometry; });
      assert.ok(frames.length > 2);
      for (const frame of frames) for (let index = 0; index < frame.length; index++) for (const key of ["x", "y", "width", "height"]) {
        assert.ok(Math.abs(frame[index][key] - frames[0][index][key]) < 1, `picker and title stay stable throughout category/upload changes (${index}.${key})`);
      }
      if (capture) await page.screenshot({ path: `${capture}/picker-${language}-${theme}-${width}.png`, animations: "disabled" });
      await dialog.getByRole("button", { name: /Source 2/ }).click();
      assert.ok(await create.getByText("Source 2", { exact: true }).isVisible(), "a model thumbnail remains a selectable model source");
      const changeContent = create.getByRole("button", { name: t("更换内容", "Change content") });
      assert.equal(await changeContent.getByRole("img").getAttribute("src"), `${origin}/fixtures/source-2-thumbnail.png`, "selected source keeps the same stored thumbnail as its picker card");
      assert.ok(await changeContent.getByText(t("模型", "Model"), { exact: true }).isVisible());
      await page.waitForFunction(() => document.activeElement?.hasAttribute('data-content-picker-trigger'));
      if (capture) await page.screenshot({ path: `${capture}/selected-${language}-${theme}-${width}.png`, animations: "disabled" });
      await changeContent.press("Enter");
      dialog = page.getByRole("dialog"); await dialog.getByRole("button", { name: /Scene match/ }).click();
      await page.waitForFunction(() => document.activeElement?.hasAttribute('data-content-picker-trigger'));
      assert.ok(await changeContent.getByText("Scene match", { exact: true }).isVisible(), "scene selection uses the same content card");
      assert.ok(await changeContent.getByText(t("场景", "Scene"), { exact: true }).isVisible());
      await changeContent.click();
      dialog = page.getByRole("dialog"); await dialog.getByRole("button", { name: /Source 0/ }).click();
      await page.waitForFunction(() => document.activeElement?.hasAttribute('data-content-picker-trigger'));
      await changeContent.click();
      await page.getByRole("dialog").getByRole("tab", { name: t("上传新素材", "New content"), exact: true }).click();
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => document.activeElement?.hasAttribute('data-content-picker-trigger'));
      assert.ok(await create.getByText("Source 0", { exact: true }).isVisible(), "canceling a content change retains the chosen source");
      await create.getByLabel(t("投放名称（可选）", "Placement name (optional)"), { exact: true }).fill("Created placement");
      await select("placement-text"); await startCreate();
      assert.equal(await create.getByLabel(t("投放名称（可选）", "Placement name (optional)"), { exact: true }).inputValue(), "Created placement");
      assert.ok(await create.getByText("Source 0", { exact: true }).isVisible());
      const submit = create.getByRole("button", { name: t("放到地图上", "Place on map"), exact: true });
      assert.equal(await submit.isDisabled(), true, "source alone must not create a placement");
      // Fields never unmount, including while the mobile inspector is hidden.
      const createPanel = page.locator("[data-placement-create]");
      const location = createPanel.locator("[data-location-fields]");
      const longitude = location.getByLabel(t("经度", "Longitude"), { exact: true });
      const latitude = location.getByLabel(t("纬度", "Latitude"), { exact: true });
      const altitude = location.getByLabel(t("高度 (m)", "Height (m)"), { exact: true });
      const pick = location.getByRole("button", { name: t("地图选点", "Pick on map"), exact: true });
      const mapPicker = page.locator('[data-map-panel="viewer"] [data-location-picker]');
      const applyPoint = mapPicker.getByRole("button", { name: t("使用此位置", "Use this location"), exact: true });
      const cancelPoint = mapPicker.getByRole("button", { name: t("取消", "Cancel"), exact: true });
      const mapPoint = page.frameLocator('iframe[title="3D Viewer"]').getByRole("button", { name: "Pick point" });
      const pickMapPoint = async () => {
        await mapPoint.click();
        await page.waitForFunction(() => document.querySelector('[data-location-picker] button:last-child')?.disabled === false);
      };
      assert.equal(await longitude.isVisible(), true, "coordinates are always present");
      await longitude.fill("181"); await latitude.fill("32");
      assert.equal(await submit.isDisabled(), true, "out-of-range coordinates cannot create a placement");
      await longitude.fill("0"); await latitude.fill("0"); await altitude.fill("-2.5");
      assert.equal(await submit.isEnabled(), true, "zero coordinates and negative height remain valid");
      // Ensure the trigger is visible before taking the fixed layout baseline.
      await pick.scrollIntoViewIfNeeded();
      const geometry = async () => location.evaluate((el) => {
        const rect = (node) => { const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height }; };
        return [el, ...el.querySelectorAll("input,button"), el.closest("[data-placement-create]").querySelector("[data-inspector-actions]")].map(rect);
      });
      const startTracking = () => page.evaluate(() => {
        window.locationFrames = [];
        const rect = node => { const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height }; };
        const sample = () => {
          const panel = document.querySelector('[data-placement-create]');
          const fields = panel.querySelector('[data-location-fields]');
          const overlay = document.querySelector('[data-location-picker]');
          window.locationFrames.push({
            map: rect(document.querySelector('iframe[title="3D Viewer"]')),
            fields: fields.offsetWidth ? [fields, ...fields.querySelectorAll('input,button'), panel.querySelector('[data-inspector-actions]')].map(rect) : null,
            overlay: overlay ? [overlay, ...overlay.querySelectorAll('button')].map(rect) : null,
          });
          window.locationFrameRequest = requestAnimationFrame(sample);
        };
        sample();
      });
      const checkTracking = async (expected) => {
        const frames = await page.evaluate(() => { cancelAnimationFrame(window.locationFrameRequest); return window.locationFrames; });
        assert.ok(frames.length > 2);
        const firstOverlay = frames.find(frame => frame.overlay)?.overlay;
        for (const frame of frames) {
          assert.deepEqual(frame.map, frames[0].map, "map geometry is stable in every frame");
          if (frame.fields) assert.deepEqual(frame.fields, expected, "visible field and footer geometry is stable in every frame");
          if (frame.overlay) assert.deepEqual(frame.overlay, firstOverlay, "map confirmation controls are stable in every frame");
        }
      };
      const beforePick = await geometry();
      const scrollBefore = await createPanel.locator("[data-inspector-scroll]").evaluate(el => el.scrollTop);
      if (capture) await page.screenshot({ path: `${capture}/location-before-${language}-${theme}-${width}.png`, animations: "disabled" });
      await startTracking();
      await pick.click(); await mapPicker.waitFor();
      assert.equal(await applyPoint.isDisabled(), true, "each pick starts without a stale candidate");
      const overlayBefore = await mapPicker.boundingBox();
      const applyBefore = await applyPoint.boundingBox();
      if (width >= 996) assert.deepEqual(await geometry(), beforePick, "starting a pick leaves the sidebar in place");
      await pickMapPoint();
      assert.equal(await longitude.inputValue(), "0", "candidate does not overwrite manual coordinates");
      assert.equal(await altitude.inputValue(), "-2.5");
      assert.deepEqual(await mapPicker.boundingBox(), overlayBefore, "candidate does not resize the map toolbar");
      assert.deepEqual(await applyPoint.boundingBox(), applyBefore, "confirmation button does not move when a point is picked");
      if (width < 996) assert.equal(await create.isVisible(), false, "map clicks must not reopen the mobile inspector");
      else assert.deepEqual(await geometry(), beforePick, "candidate does not move fields or footer");
      if (capture) await page.screenshot({ path: `${capture}/location-picking-${language}-${theme}-${width}.png`, animations: "disabled" });
      await cancelPoint.click(); await create.waitFor();
      await page.waitForFunction(() => document.activeElement?.hasAttribute("data-location-pick-trigger"));
      assert.equal(await longitude.inputValue(), "0", "cancel retains manual coordinates");
      assert.equal(await altitude.inputValue(), "-2.5");
      assert.deepEqual(await geometry(), beforePick, "cancel restores the exact field and footer positions");
      assert.equal(await createPanel.locator("[data-inspector-scroll]").evaluate(el => el.scrollTop), scrollBefore);
      await checkTracking(beforePick);
      await longitude.fill(""); await latitude.fill(""); await altitude.fill("");
      await pick.scrollIntoViewIfNeeded();
      const emptyGeometry = await geometry();
      await startTracking();
      await pick.click(); await mapPicker.waitFor();
      assert.equal(await applyPoint.isDisabled(), true);
      await pickMapPoint();
      assert.equal(await createPanel.getByRole("button", { name: t("放到地图上", "Place on map"), exact: true, includeHidden: true }).isDisabled(), true, "map click is only a candidate");
      assert.equal(await longitude.inputValue(), "");
      await applyPoint.click(); await create.waitFor();
      await page.waitForFunction(() => document.activeElement?.hasAttribute("data-location-pick-trigger"));
      assert.equal(await longitude.inputValue(), "122"); assert.equal(await altitude.inputValue(), "2");
      assert.deepEqual(await geometry(), emptyGeometry, "confirm changes only values, not layout");
      await checkTracking(emptyGeometry);
      if (capture) await page.screenshot({ path: `${capture}/location-confirmed-${language}-${theme}-${width}.png`, animations: "disabled" });
      // Leaving a pick must never apply it to a different task or placement.
      await pick.click(); await mapPicker.waitFor(); await pickMapPoint();
      if (width < 996) {
        await showList();
        assert.equal(await mapPicker.count(), 0, "opening a mobile panel exits picking so the toolbar cannot cover its controls");
      }
      await select("placement-text");
      assert.equal(await mapPicker.count(), 0);
      assert.equal(await editor.getByLabel(t("经度", "Longitude"), { exact: true }).inputValue(), "121.123456");
      await startCreate();
      assert.equal(await mapPicker.count(), 0, "returning to a draft does not resume a stale pick");
      assert.equal(await longitude.inputValue(), "122");
      assert.equal(await submit.isEnabled(), true); await submit.click(); await editor.getByRole("heading", { name: "Created placement", exact: true }).waitFor();
      assert.equal(writes.at(-1).input.target.assetId, assets[0].id);
      if (width === 1440) {
        await startCreate(); await create.getByRole("button", { name: t("选择投放内容", "Choose content"), exact: true }).click();
        dialog = page.getByRole("dialog"); await dialog.getByRole("tab", { name: t("上传新素材", "New content"), exact: true }).click();
        await dialog.getByRole("combobox", { name: t("内容类型", "Content type"), exact: true }).click();
        await page.getByRole("option", { name: t("文字", "Text"), exact: true }).click();
        await dialog.getByLabel(t("文字内容", "Text"), { exact: true }).fill("New text content");
        const writeCount = writes.length;
        await dialog.getByRole("button", { name: t("使用此内容", "Use this content"), exact: true }).click();
        await page.waitForFunction(() => document.activeElement?.hasAttribute('data-content-picker-trigger'));
        assert.equal(writes.length, writeCount, "choosing new content must not write an orphan asset");
        assert.ok(await changeContent.getByText(t("文字", "Text"), { exact: true }).isVisible(), "prepared uploads use the same selected-content card");
        await pick.click(); await mapPicker.waitFor(); await pickMapPoint(); await applyPoint.click(); await create.waitFor();
        await submit.click(); await editor.getByRole("heading", { name: "New text content", exact: true }).waitFor();
      }
    }
    assert.ok(await iframe.evaluate((node) => node.isConnected));
    assert.deepEqual(await iframe.boundingBox(), mapBounds, "inspector, creation and picker keep the map stable");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (capture) await page.screenshot({ path: `${capture}/${language}-${theme}-${width}-${writable}.png`, animations: "disabled" });
    assert.deepEqual(errors, []);
    page.on("dialog", (dialog) => dialog.accept());
    await context.close(); console.log(`PASS placement inspector ${language} ${theme} ${width} writable=${writable}`);
  }
} finally { await browser.close(); }

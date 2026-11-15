/** Independent recognition-target management. All API requests use isolated fixtures. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const origin = process.env.MANAGE_TEST_ORIGIN ?? "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const teamId = "11111111-1111-4111-8111-111111111111";
const assetId = n => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const referencePhoto = await readFile(new URL("../public/images/landing/street.webp", import.meta.url));
const capture = process.env.ANCHOR_LIBRARY_SCREENSHOTS;
if (capture) await mkdir(capture, { recursive: true });
const darkTheme = (await readFile(new URL("../app/globals.css", import.meta.url), "utf8")).match(/\.dark\s*\{[^}]+\}/)?.[0];
const browser = await chromium.launch();
try {
  for (const [language, dark, width, writable] of [["zh", false, 1440, true], ["en", true, 1100, true], ["en", false, 390, true], ["zh", true, 320, false]]) {
    const t = (zh, en) => language === "zh" ? zh : en;
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: "better-auth.session_token", value: "anchor-fixture", url: origin }, { name: "language", value: language, url: origin }]);
    const ref = (ordinal, url = `${origin}/fixtures/reference-${ordinal}.png`) => ({ role: "reference", ordinal, url, mime_type: "image/png", size_bytes: png.length, managed: true });
    const target = (n, state = "active") => ({
      id: assetId(n), organization_id: teamId, name: `Target ${n}`, file_type: "anchor", payload: { kind: "anchor" }, resources: [ref(0), ref(1)],
      state, lock_version: 1, origin: "team_upload", visibility: "organization", maintained_by: null, maintainer: null, created_by: null,
      create_at: "2026-11-16T00:00:00Z", updated_at: "2026-11-16T00:00:00Z", archived_at: state === "archived" ? "2026-11-16T00:00:00Z" : null,
      usage_count: 0, capabilities: { can_read: true, can_maintain: writable, can_use_in_workspace: writable },
    });
    const rows = [target(1), target(2, "archived"), { ...target(3), name: "Ordinary image", file_type: "image", payload: { kind: "image" } }];
    const writes = [], reads = [];
    let conflict = false, receipt = 0;
    const impact = { scenes: 0, placements: 0, activities: 0, restricted_count: 0, items: [] };
    await context.route("**/fixtures/reference-*.png", route => route.fulfill({ contentType: "image/webp", body: referencePhoto }));
    await context.route("**/api/**", async route => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
      let body = { data: [], page: { total: 0, hasMore: false, offset: 0, limit: 30 } }, status = 200;
      if (method === "GET") reads.push(path);
      else { assert.ok(writable, "viewers cannot write"); writes.push({ path, method }); }
      if (path === "/api/auth/get-session") body = { user: { id: "fixture", name: "Fixture", email: "fixture@example.invalid" }, session: { id: "fixture", expiresAt: "2099-01-01" } };
      else if (path === "/api/auth/role") body = { role: "user" };
      else if (path === "/api/organizations") body = { data: [{ id: teamId, name: "Target team", role: writable ? "owner" : "viewer", allowed_file_types: ["anchor", "image"] }] };
      else if (path === "/api/upload") {
        const multipart = req.postDataBuffer().toString();
        assert.ok(multipart.includes('name="organization_id"'));
        assert.ok(!multipart.includes('name="workspace_id"'), "reference uploads do not require a map");
        assert.match(multipart, /name="type"\r\n\r\nanchor/);
        body = { data: { id: assetId(100 + ++receipt), url: `${origin}/fixtures/reference-new-${receipt}.png` } };
      } else if (path === `/api/organizations/${teamId}/assets`) {
        if (method === "POST") {
          const input = req.postDataJSON();
          assert.equal(input.fileType, "anchor"); assert.equal(input.payload.kind, "anchor");
          assert.ok(input.idempotencyKey); assert.equal(input.workspaceId, undefined);
          assert.equal(input.resources[0].role, "reference"); assert.ok(input.resources[0].receiptId);
          const asset = { ...target(10), name: input.name, resources: [ref(0)] }; rows.push(asset); body = { data: { asset } };
        } else {
          const type = url.searchParams.get("file_type"), state = url.searchParams.get("state") ?? "active", q = url.searchParams.get("q") ?? "";
          const filtered = rows.filter(a => (type ? a.file_type === type : a.file_type !== "anchor") && a.state === state && a.name.toLowerCase().includes(q.toLowerCase()));
          body = { data: filtered, page: { total: filtered.length, limit: 30, offset: 0, hasMore: false } };
        }
      } else if (/^\/api\/assets\/[^/]+\/usage$/.test(path)) body = { data: { asset_id: path.split("/")[3], impact } };
      else if (/^\/api\/assets\/[^/]+$/.test(path)) {
        const asset = rows.find(a => path.endsWith(a.id));
        assert.ok(asset);
        if (method === "GET") body = { data: asset };
        else {
          const input = method === "DELETE" ? { expectedLockVersion: Number(url.searchParams.get("expectedLockVersion")) } : req.postDataJSON();
          assert.equal(input.expectedLockVersion, asset.lock_version);
          if (conflict) { status = 409; body = { code: "LOCK_VERSION_CONFLICT", error: "Fixture stale version" }; }
          else {
            if (input.name) asset.name = input.name;
            if (input.resources) {
              assert.equal(input.payload.kind, "anchor");
              asset.resources = input.resources.map((r, i) => { assert.equal(r.role, "reference"); return ref(i); });
            }
            if (method === "DELETE") asset.state = "archived";
            else if (input.state) asset.state = input.state;
            asset.lock_version++;
            body = { data: method === "DELETE" ? { asset, impact } : asset };
          }
        }
      } else assert.equal(method, "GET", `Unexpected write ${path}`);
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    const prepare = async () => {
      await page.addStyleTag({ content: `nextjs-portal{display:none!important}${dark ? darkTheme : ""}` });
      await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark);
    };
    await page.goto(`${origin}/manage/anchors?organizationId=${teamId}`, { waitUntil: "networkidle" });
    await prepare();
    await page.getByRole("heading", { name: t("识别目标", "Recognition targets"), exact: true }).waitFor();
    assert.equal(await page.locator(".team-library").getByRole("combobox").count(), 1, "only the archive filter remains; target type is fixed");
    if (!writable) assert.equal(await page.getByRole("button", { name: t("新建识别目标", "New recognition target"), exact: true }).count(), 0);
    const card = page.locator(`#library-asset-${assetId(1)}`);
    await card.waitFor(); assert.equal(await page.locator(`#library-asset-${assetId(3)}`).count(), 0);
    await page.locator(`li:has(#library-asset-${assetId(1)}) img`).evaluate(img => img.decode());
    const library = await page.locator(".team-library").elementHandle();
    const search = page.getByRole("searchbox", { includeHidden: true });
    await search.fill("Target");
    await card.click();
    const panel = width >= 1024 ? page.getByRole("complementary", { name: t("识别目标详情", "Recognition target details") }) : page.getByRole("dialog");
    await panel.getByRole("heading", { name: "Target 1", exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/manage/anchors");
    assert.ok(await library.evaluate(el => el.isConnected));
    assert.equal(await panel.locator('img[alt^="Reference image"],img[alt^="识别图"]').count(), 2);
    assert.equal(await panel.getByText(t("挂载素材", "Attached content"), { exact: true }).count(), 0, "team editor owns no map attachments");
    if (capture) await page.screenshot({ path: `${capture}/${language}-${dark ? "dark" : "light"}-${width}.png`, animations: "disabled" });
    if (writable) {
      await panel.getByRole("button", { name: t("重命名", "Rename"), exact: true }).click();
      const dialog = page.getByRole("dialog").last();
      await dialog.getByRole("textbox").fill("Target renamed");
      conflict = true;
      await dialog.getByRole("button", { name: t("保存", "Save"), exact: true }).click();
      await dialog.getByRole("alert").waitFor();
      assert.equal(await dialog.getByRole("textbox").inputValue(), "Target renamed");
      conflict = false;
      await dialog.getByRole("button", { name: t("保存", "Save"), exact: true }).click();
      await panel.getByRole("heading", { name: "Target renamed", exact: true }).waitFor();
      await card.filter({ hasText: "Target renamed" }).waitFor();
      assert.equal(await search.inputValue(), "Target");
      await panel.getByRole("button", { name: t("删除识别图 2", "Remove reference image 2"), exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('img[alt="Reference image 2"],img[alt="识别图 2"]').length === 0);
      assert.equal(rows[0].resources.length, 1);
      await panel.locator('input[type="file"]').setInputFiles({ name: "reference.png", mimeType: "image/png", buffer: png });
      await panel.locator('img[alt="Reference image 2"],img[alt="识别图 2"]').waitFor();
      assert.equal(rows[0].resources.length, 2);
    } else {
      assert.equal(await panel.getByRole("button", { name: t("重命名", "Rename"), exact: true }).count(), 0);
      assert.equal(await panel.locator('input[type="file"]').count(), 0);
      assert.equal(await page.getByRole("button", { name: t("新建识别目标", "New recognition target"), exact: true }).count(), 0);
    }
    await panel.getByRole("button", { name: t("关闭", "Close"), exact: true }).click();
    await panel.waitFor({ state: "hidden" });
    assert.equal(await search.inputValue(), "Target");
    const state = page.locator(".team-library").getByRole("combobox");
    await state.click();
    await page.getByRole("option", { name: t("已归档", "Archived"), exact: true }).click();
    await page.locator(`#library-asset-${assetId(2)}`).waitFor();
    assert.equal(await card.count(), 0);
    await state.click();
    await page.getByRole("option", { name: t("未归档", "Active"), exact: true }).click();
    await card.waitFor();
    if (writable) {
      await page.getByRole("button", { name: t("新建识别目标", "New recognition target"), exact: true }).click();
      const dialog = page.getByRole("dialog");
      assert.equal(await dialog.getByRole("combobox").count(), 0, "target creation has one fixed asset type");
      await dialog.locator('input[type="file"]').setInputFiles({ name: "new-reference.png", mimeType: "image/png", buffer: png });
      await dialog.getByLabel(t("目标名称", "Target name"), { exact: true }).fill("Target created");
      await dialog.getByRole("button", { name: t("新建识别目标", "New recognition target"), exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await page.locator(`#library-asset-${assetId(10)}`).waitFor();
      assert.ok(writes.every(w => !w.path.includes("placements") && !w.path.includes("collections")), "target management never writes to maps");
    }
    // Old asset links resolve to the independent target editor, retaining identity.
    await page.goto(`${origin}/manage/assets/${assetId(1)}?organizationId=${teamId}`, { waitUntil: "networkidle" });
    await page.waitForURL(`**/manage/anchors/${assetId(1)}?organizationId=${teamId}`);
    await page.getByRole("link", { name: t("返回识别目标", "Back to recognition targets"), exact: true }).waitFor();
    await page.goto(`${origin}/manage/anchors/${assetId(2)}?organizationId=${teamId}`, { waitUntil: "networkidle" });
    await prepare();
    await page.getByRole("heading", { name: "Target 2", exact: true }).waitFor();
    assert.equal(await page.locator('input[type="file"]').count(), 0, "archived reference images are read-only");
    if (writable) {
      await page.getByRole("button", { name: t("恢复素材", "Restore asset"), exact: true }).click();
      await page.locator('input[type="file"]').waitFor({ state: "attached" });
      assert.equal(rows[1].state, "active");
      await page.getByRole("button", { name: t("归档素材", "Archive asset"), exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: t("归档", "Archive"), exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(rows[1].state, "archived");
      assert.equal(await page.locator('input[type="file"]').count(), 0);
    }
    assert.ok(!reads.some(path => /^\/api\/collections\/[^/]+\//.test(path)), "standalone editor does not depend on a map");
    assert.deepEqual(errors, []);
    console.log(`PASS anchor library ${language}/${dark ? "dark" : "light"}/${width} writable=${writable}: separate catalog, references, locks, navigation and map independence`);
    await context.close();
  }
} finally { await browser.close(); }

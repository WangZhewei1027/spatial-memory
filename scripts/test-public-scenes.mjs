/** Scene library tabs and opening a copied template in the real editor, with isolated API fixtures. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const origin = process.env.MANAGE_TEST_ORIGIN ?? "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const team = "11111111-1111-4111-8111-111111111111";
const source = "22222222-2222-4222-8222-222222222222";
const copyId = "33333333-3333-4333-8333-333333333333";
const clip = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=64x48:rate=12:duration=1",
  "-c:v", "libx264", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"]);
const template = { id: source, type: "scene", name: "Gallery tour", thumbnail: { kind: "video", url: `data:video/mp4;base64,${clip.toString("base64")}` } };
const darkTheme = (await readFile(new URL("../app/globals.css", import.meta.url), "utf8")).match(/\.dark\s*\{[^}]+\}/)[0];
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
try {
  for (const [language, dark, width, role] of [
    ["zh", false, 1440, "member"], ["en", true, 390, "member"],
    ["zh", true, 390, "official"], ["en", false, 1440, "viewer"],
  ]) {
    const labels = JSON.parse(await readFile(new URL(`../locales/${language}.json`, import.meta.url), "utf8"));
    const library = labels.contentModel.library;
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: "better-auth.session_token", value: "scenes-fixture", url: origin }, { name: "language", value: language, url: origin }]);
    const publicScenes = [template, ...Array.from({ length: role === "viewer" ? 1 : 11 }, (_, n) => ({
      id: `22222222-2222-4222-8222-${String(n + 1).padStart(12, "0")}`, type: "scene",
      name: `Public scene ${n + 2}`, thumbnail: n === 0 ? { kind: "image", url: "/images/landing/dongming-scene.webp" } : null,
    }))];
    let hidePreviews = false;
    let copy;
    await context.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      let body = { data: [], page: { offset: 0, limit: 30, hasMore: false } };
      if (path === "/api/auth/get-session") body = { user: { id: "fixture", name: "Fixture", email: "fixture@example.invalid" }, session: { id: "fixture", expiresAt: "2099-01-01" } };
      else if (path === "/api/auth/role") body = { role: role === "official" ? "super_admin" : "user" };
      else if (path === "/api/organizations") body = { data: [{ id: team, name: "Fixture team", role: role === "viewer" ? "viewer" : "member", is_official_template_library: role === "official" }] };
      else if (path === "/api/templates") {
        assert.equal(url.searchParams.get("type"), "scene");
        assert.equal(url.searchParams.has("excludeAnchors"), false);
        const limit = Number(url.searchParams.get("limit")), offset = Number(url.searchParams.get("offset"));
        if (limit === 10) {
          assert.equal(offset, 0);
          assert.equal(url.searchParams.has("q"), false);
          if (hidePreviews && role === "official") return route.fulfill({ status: 503, json: { error: "Preview unavailable" } });
        }
        const matches = hidePreviews ? [] : publicScenes.filter(scene => scene.name.includes(url.searchParams.get("q") ?? ""));
        body = { data: matches.slice(offset, offset + limit), page: { offset, limit, hasMore: matches.length > offset + limit } };
      } else if (path === "/api/templates/duplicate") {
        const input = request.postDataJSON();
        assert.equal(role, "member");
        assert.equal(request.method(), "POST");
        assert.equal(input.sourceId, source);
        assert.equal(input.sourceType, "scene");
        assert.equal(input.targetOrganizationId, team);
        assert.ok(input.idempotencyKey);
        copy = { id: copyId, organization_id: team, name: "Gallery tour copy", state: "active", lock_version: 1,
          placement_count: 0, updated_at: "2026-11-18T00:00:00Z", capabilities: { can_read: true, can_edit: true, can_archive: true },
          referenced_resources: [], document: { schemaVersion: 6, content: { kind: "composition", units: "meters", durationSeconds: 5, loop: false, assets: {}, instances: [] } } };
        body = { data: { id: copyId, sourceType: "scene", organizationId: team, created: true } };
      } else if (path === `/api/organizations/${team}/scenes` && copy) body.data = [copy];
      else if (path === `/api/scenes/${copyId}`) {
        assert.ok(copy);
        if (request.method() === "PATCH") {
          const input = request.postDataJSON();
          assert.equal(input.expectedLockVersion, copy.lock_version);
          Object.assign(copy, { name: input.name, lock_version: copy.lock_version + 1 });
        }
        body = { data: copy };
      } else if (path === "/api/tags") body = { tags: [] };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    await page.goto(`${origin}/manage/scenes?organizationId=${team}`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: `nextjs-portal{display:none!important}${dark ? darkTheme : ""}` });
    await page.evaluate(value => document.documentElement.classList.toggle("dark", value), dark);
    const teamTab = page.getByRole("tab", { name: library.teamTab });
    assert.equal(await teamTab.getAttribute("aria-selected"), "true");
    const strip = page.getByRole("region", { name: library.scene.browsePublic, exact: true });
    const previews = strip.getByRole("list").getByRole("button");
    await previews.first().waitFor();
    assert.deepEqual(await previews.allTextContents(), publicScenes.slice(0, 10).map(scene => scene.name));
    assert.equal(await strip.locator("img").count(), 1);
    const videoCover = strip.locator("video");
    assert.ok(await videoCover.evaluate(v => v.autoplay && v.loop && v.muted && !v.controls));
    if (publicScenes.length > 10) {
      const row = strip.getByRole("list");
      assert.ok(await row.evaluate(node => node.scrollWidth > node.clientWidth));
      await previews.last().focus();
      assert.ok(await row.evaluate(node => node.scrollLeft > 0));
      await page.keyboard.press("Enter");
    } else {
      await strip.getByRole("button", { name: library.scene.browsePublic }).click();
    }
    const publicTab = page.getByRole("tab", { name: library.scene.publicTab });
    await strip.waitFor({ state: "hidden" });
    assert.equal(await publicTab.getAttribute("aria-selected"), "true");
    assert.equal(await publicTab.evaluate(node => node === document.activeElement), true);
    assert.equal(copy, undefined);
    await page.getByRole("heading", { name: template.name }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("tab"), "public");
    const video = page.locator("video");
    await page.waitForFunction(() => document.querySelector("video")?.currentTime > 0.5);
    await video.locator("..").hover();
    assert.equal(await video.evaluate(v => v.muted && v.playsInline && !v.controls), true);
    await page.waitForFunction(() => {
      const v = document.querySelector("video");
      return v && !v.paused && v.currentTime < 0.4;
    });
    const search = page.getByRole("searchbox");
    await search.fill("No match");
    await page.getByRole("heading", { name: labels.contentModel.workbench.empty.filteredTitle }).waitFor();
    await search.fill("Gallery");
    await page.getByRole("heading", { name: template.name }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (role === "member") {
      await teamTab.click();
      await strip.getByRole("button", { name: library.scene.browsePublic }).click();
      assert.equal(await search.inputValue(), "");
      await page.getByRole("heading", { name: publicScenes.at(-1).name, exact: true }).waitFor();
    }
    const button = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: template.name, exact: true }) })
      .getByRole("button", { name: library.copyToTeam, exact: true });
    if (role === "member") {
      await button.click();
      const openCopy = page.getByRole("link", { name: library.openCopy });
      await openCopy.waitFor();
      await teamTab.click();
      await page.getByRole("link", { name: "Gallery tour copy", exact: true }).waitFor();
      await page.goBack();
      await openCopy.click();
      await page.waitForURL(`**/manage/scenes/${copyId}?organizationId=${team}`);
      const title = page.getByRole("textbox", { name: labels.sceneEditor.title, exact: true });
      assert.equal(await title.inputValue(), copy.name);
      await title.fill("My gallery");
      const saved = page.waitForResponse(response => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/scenes/${copyId}`);
      await page.getByRole("button", { name: labels.common.save, exact: true }).click();
      await saved;
      assert.equal(copy.name, "My gallery");
    } else {
      assert.equal(await button.count(), 0);
      assert.equal(copy, undefined);
      hidePreviews = true;
      const reply = page.waitForResponse(res => new URL(res.url()).pathname === "/api/templates" && new URL(res.url()).searchParams.get("limit") === "10");
      await teamTab.click();
      await reply;
      await page.getByRole("searchbox").waitFor();
      assert.equal(await strip.count(), 0);
    }
    console.log(`PASS public scenes ${language} ${width} ${role}`);
    await context.close();
  }
} finally { await browser.close(); }

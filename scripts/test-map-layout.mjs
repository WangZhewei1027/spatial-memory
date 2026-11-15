/** Initial entry, refresh and opening from the collection list keep map panels in place. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

const origin = process.env.MANAGE_TEST_ORIGIN ?? "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname), "Use a local test server");
const teamId = "11111111-1111-4111-8111-111111111111";
const mapId = "22222222-2222-4222-8222-222222222222";
const mapUrl = `${origin}/manage/collections/${mapId}?organizationId=${teamId}`;
const captureDir = process.env.MAP_LAYOUT_SCREENSHOTS;
if (captureDir) await mkdir(captureDir, { recursive: true });

// Start before hydration, so the initial placeholder and every intermediate frame count.
function observeLayout() {
  if (window !== window.top) return;
  window.mapLayoutFrames = [];
  const sample = () => {
    const panels = [...document.querySelectorAll("[data-map-panel]")].filter((node) => node.getClientRects().length);
    if (panels.length) {
      const boxes = Object.fromEntries(panels.map((node) => {
        const rect = node.getBoundingClientRect();
        return [node.dataset.mapPanel, [rect.x, rect.y, rect.width, rect.height]];
      }));
      const main = panels[0].closest("main");
      const header = main?.querySelector("header")?.getBoundingClientRect();
      if (header) boxes.header = [header.x, header.y, header.width, header.height];
      const viewer = main?.querySelector('iframe[title="3D Viewer"]');
      const frame = { boxes, loaded: !!viewer, time: Math.round(performance.now()) };
      const last = window.mapLayoutFrames.at(-1);
      if (!last || JSON.stringify(last.boxes) !== JSON.stringify(boxes) || last.loaded !== frame.loaded) window.mapLayoutFrames.push(frame);
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}

async function verifyLayout(page, label, width) {
  await page.locator('iframe[title="3D Viewer"]:visible').waitFor();
  await page.waitForLoadState("networkidle");
  const frames = await page.evaluate(() => window.mapLayoutFrames);
  assert.ok(frames.some((frame) => frame.loaded), `${label}: the real map must be sampled`);
  assert.ok(frames.some((frame) => !frame.loaded), `${label}: sample the loading placeholder too`);
  const final = frames.at(-1).boxes;
  const expectedPanels = width >= 996 ? ["header", "list", "sidebar", "viewer"] : ["header", "viewer"];
  for (const frame of frames) {
    assert.deepEqual(Object.keys(frame.boxes).sort(), expectedPanels);
    for (const [panel, rect] of Object.entries(frame.boxes)) {
      assert.ok(rect.every((value, index) => Math.abs(value - final[panel][index]) <= 1),
        `${label}: ${panel} moved during loading: ${JSON.stringify(rect)} → ${JSON.stringify(final[panel])}`);
    }
  }
  for (const panel of expectedPanels.filter((panel) => panel !== "header")) {
    const [x, , w, h] = final[panel];
    assert.ok(x >= 0 && x + w <= width && w > 0 && h > 0, `${label}: ${panel} must fit horizontally`);
  }
  const { list, viewer, sidebar, header } = final;
  assert.ok(viewer[1] >= header[1] + header[3], `${label}: map must be below its header`);
  if (width >= 996) {
    assert.equal(list[1], viewer[1]);
    assert.equal(sidebar[1], viewer[1]);
    assert.ok(list[0] + list[2] < viewer[0] && viewer[0] + viewer[2] < sidebar[0]);
  } else {
    assert.ok(viewer[2] >= width - 32, `${label}: narrow map uses the available width`);
    assert.equal(list, undefined, "list opens on demand");
    assert.equal(sidebar, undefined, "inspector opens on demand");
  }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: page must not overflow horizontally`);
  console.log(`PASS map layout ${label}: stable placeholder, panels and header`);
}

async function verifyResize(page, label, width, height) {
  const left = page.locator('[data-map-resizer="list"]');
  const right = page.locator('[data-map-resizer="sidebar"]');
  if (width < 996) {
    assert.equal(await left.isVisible(), false);
    assert.equal(await right.isVisible(), false);
    return;
  }
  const panel = name => page.locator(`[data-map-panel="${name}"]`);
  const size = async name => (await panel(name).boundingBox()).width;
  const drag = async (handle, delta) => {
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
  };
  const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1, `${message}: ${actual} / ${expected}`);
  const iframe = await page.locator('iframe[title="3D Viewer"]').elementHandle();
  const initial = { list: await size("list"), sidebar: await size("sidebar"), viewer: await size("viewer") };
  assert.ok(initial.list >= 272 && initial.list <= 320, "the list has a wider desktop default");
  await drag(left, 48);
  near(await size("list"), initial.list + 48, "left divider grows the list");
  near(await size("sidebar"), initial.sidebar, "left drag preserves the opposite inspector");
  near(await size("viewer"), initial.viewer - 48, "the map uses remaining space");
  await drag(right, -32);
  near(await size("sidebar"), initial.sidebar + 32, "right divider grows the inspector");
  near(await size("list"), initial.list + 48, "right drag preserves the list");
  assert.equal(await iframe.evaluate(el => el === document.querySelector('iframe[title="3D Viewer"]')), true, "resizing keeps the map mounted");
  await right.focus(); await right.press("ArrowRight");
  near(await size("sidebar"), initial.sidebar + 8, "keyboard arrows move the right divider in screen direction");
  await right.press("ArrowLeft");
  near(await size("sidebar"), initial.sidebar + 32, "keyboard resizing works in both directions");
  if (captureDir) await page.screenshot({ path: `${captureDir}/resized-${label.replaceAll(" ", "-")}.png` });
  // Crossing the iframe must not lose the gesture; both extremes preserve useful panels.
  await drag(left, 1500);
  assert.ok(await size("viewer") >= 319 && await size("list") <= 480);
  await drag(right, -1500);
  assert.ok(await size("viewer") >= 319 && await size("sidebar") <= 480);
  await left.focus(); await left.press("Home");
  near(await size("list"), 240, "left minimum remains usable");
  await right.focus(); await right.press("Home");
  near(await size("sidebar"), 320, "inspector minimum protects its fields");
  await left.press("End"); await right.press("End");
  const preferred = { list: await size("list"), sidebar: await size("sidebar") };
  await page.setViewportSize({ width: 996, height });
  assert.ok(await size("viewer") >= 319 && await size("list") >= 239 && await size("sidebar") >= 319, "smaller desktop clamps widths without squeezing the map away");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 390, height });
  assert.equal(await left.isVisible(), false);
  assert.equal(await right.isVisible(), false);
  assert.ok(await size("viewer") >= 358);
  await page.setViewportSize({ width, height });
  near(await size("list"), preferred.list, "returning to desktop restores the chosen list width");
  near(await size("sidebar"), preferred.sidebar, "returning to desktop restores the chosen inspector width");
  await left.dblclick(); await right.focus(); await right.press("Enter");
  near(await size("list"), initial.list, "double-click resets the list");
  near(await size("sidebar"), initial.sidebar, "Enter resets the inspector");
  console.log(`PASS map resizing ${label}: pointer, keyboard, bounds, responsive restore and mounted viewer`);
}

const browser = await chromium.launch();
try {
  for (const [width, height, language, theme] of [
    [1440, 900, "zh", "light"], [1100, 900, "en", "dark"],
    [820, 900, "zh", "dark"], [600, 900, "en", "light"],
    [390, 844, "zh", "light"], [320, 568, "en", "dark"],
    [1440, 640, "en", "light"],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
    await context.addCookies([{ name: "better-auth.session_token", value: "layout-fixture", url: origin }, { name: "language", value: language, url: origin }]);
    await context.addInitScript(observeLayout);
    await context.addInitScript(({ origin, theme }) => {
      if (location.origin === origin) localStorage.setItem("theme", theme);
    }, { origin, theme });
    const collection = { id: mapId, organization_id: teamId, name: "Layout fixture", description: null, archived_at: null, capabilities: { can_edit: true, can_archive: true } };
    await context.route("**/api/**", async (route) => {
      const request = route.request(), path = new URL(request.url()).pathname;
      assert.equal(request.method(), "GET", `Unexpected mutation: ${path}`);
      let body = { data: [], page: { total: 0, hasMore: false, offset: 0, limit: 30 } };
      if (path === "/api/auth/get-session") body = { user: { id: "fixture", name: "Fixture", email: "fixture@example.invalid" }, session: { id: "fixture", expiresAt: "2099-01-01" } };
      else if (path === "/api/auth/role") body = { role: "user" };
      else if (path === "/api/organizations") body = { data: [{ id: teamId, name: "Fixture team", role: "owner", allowed_file_types: ["text", "image"] }] };
      else if (path === `/api/organizations/${teamId}/collections`) body = { data: [collection], page: { total: 1, hasMore: false, offset: 0, limit: 30 } };
      else if (path === `/api/collections/${mapId}`) { await delay(300); body = { data: collection }; }
      else if (path === "/api/tags") body = { tags: [] };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    // Keep the real iframe boundary and message bridge without external map services.
    await context.route("**/js/viewer/index.html*", (route) => route.fulfill({ contentType: "text/html", body: '<!doctype html><body style="margin:0;background:#e5e7eb">Map fixture<script>parent.postMessage({type:"VIEWER_READY",source:"viewer",version:1},location.origin)</script>' }));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const label = `${width}×${height} ${language} ${theme}`;
    await page.goto(mapUrl, { waitUntil: "domcontentloaded" });
    await verifyLayout(page, `${label} entry`, width);
    if (captureDir) await page.screenshot({ path: `${captureDir}/${width}-${height}-${language}-${theme}.png` });
    await verifyResize(page, label, width, height);
    await page.reload({ waitUntil: "domcontentloaded" });
    await verifyLayout(page, `${label} refresh`, width);

    await page.goto(`${origin}/manage/collections?organizationId=${teamId}`, { waitUntil: "networkidle" });
    const [openedMap] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("link", { name: collection.name, exact: true }).click(),
    ]);
    openedMap.on("pageerror", (error) => errors.push(error.message));
    await openedMap.waitForURL(mapUrl);
    await verifyLayout(openedMap, `${label} open from list`, width);
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally {
  await browser.close();
}

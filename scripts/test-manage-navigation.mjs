/** Browser regression against a running local Next server; APIs use isolated fixtures. */
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { setTimeout as delay } from "node:timers/promises";

const origin = process.env.MANAGE_TEST_ORIGIN ?? "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname), "Use a local test server");
const teamId = "11111111-1111-4111-8111-111111111111";
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([
    { name: "better-auth.session_token", value: "navigation-fixture", url: origin },
    { name: "language", value: "en", url: origin },
  ]);
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    assert.equal(request.method(), "GET", `unexpected mutation: ${path}`);
    let body = { data: [], page: { total: 0, hasMore: false, offset: 0, limit: 20 } };
    if (path === "/api/auth/get-session") body = { user: { id: "navigation-user", name: "Navigation fixture", email: "navigation@example.invalid" }, session: { id: "fixture", expiresAt: "2099-01-01" } };
    else if (path === "/api/auth/role") body = { role: "user" };
    else if (path === "/api/organizations") body = { data: [{ id: teamId, name: "Navigation team", role: "owner", allowed_file_types: ["image", "text"] }] };
    else if (path === "/api/tags") body = { tags: [] };
    if (/\/organizations\/[^/]+\/(assets|scenes|collections|activities)$/.test(path)) await delay(300);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/manage/assets?organizationId=${teamId}`, { waitUntil: "networkidle" });
  const navigation = page.locator(".console-sidebar nav");
  await navigation.getByRole("link", { name: "Scenes", exact: true }).waitFor();
  const sidebar = await page.locator(".console-sidebar").elementHandle();
  const workarea = await page.locator(".team-workarea").elementHandle();
  const header = await page.locator(".app-navbar").elementHandle();
  const initialBounds = await sidebar.boundingBox();
  await sidebar.evaluate((node) => {
    const initial = node.getBoundingClientRect();
    window.navigationShifts = [];
    const sample = () => {
      const rect = node.getBoundingClientRect();
      if (!node.isConnected || ["x", "y", "width", "height"].some((key) => rect[key] !== initial[key])) window.navigationShifts.push(rect.toJSON());
      window.navigationFrame = requestAnimationFrame(sample);
    };
    window.navigationFrame = requestAnimationFrame(sample);
  });
  for (const [name, path] of [["Scenes", "scenes"], ["Map collections", "collections"], ["Activities", "activities"], ["Assets", "assets"]]) {
    await navigation.getByRole("link", { name, exact: true }).click();
    await page.waitForURL(`**/manage/${path}?organizationId=${teamId}`);
    await page.locator(".team-library:visible").waitFor();
    await page.waitForLoadState("networkidle");
    assert.equal(await sidebar.evaluate((node) => node.isConnected), true, `sidebar remounted while navigating to ${path}`);
    assert.equal(await workarea.evaluate((node) => node.isConnected), true, `work area remounted while navigating to ${path}`);
    assert.deepEqual(await sidebar.boundingBox(), initialBounds, `sidebar shifted while navigating to ${path}`);
    assert.equal(await navigation.getByRole("link", { name, exact: true }).getAttribute("aria-current"), "page");
    assert.ok(await header.boundingBox(), "global header disappeared");
    assert.equal(await page.locator(".team-workarea:visible").count(), 1);
    assert.equal(await page.locator(".team-library:visible").count(), 1);
    assert.equal(await page.locator(".team-workarea").evaluate((node) => getComputedStyle(node).paddingTop), "0px");
  }
  await page.goBack();
  await page.waitForURL(`**/manage/activities?organizationId=${teamId}`);
  await page.goForward();
  await page.waitForURL(`**/manage/assets?organizationId=${teamId}`);
  const shifts = await page.evaluate(() => { cancelAnimationFrame(window.navigationFrame); return window.navigationShifts; });
  assert.deepEqual(shifts, [], "sidebar moved or disappeared during navigation/loading");
  assert.deepEqual(errors, []);
  console.log("PASS /manage navigation, slow responses and history preserve the sidebar, header and work area");
} finally {
  await browser.close();
}

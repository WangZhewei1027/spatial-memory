import { PerspectiveCamera, Vector3 } from 'three';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
const origin = process.env.MANAGE_TEST_ORIGIN ?? 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const screenshots = process.env.SCENE_EDITOR_SCREENSHOTS;
if (screenshots) await mkdir(screenshots, { recursive: true });
const team = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222';
const browser = await chromium.launch();
try {
  for (const [language, width, readOnly, dark] of [['en', 1440, false, false], ['zh', 390, false, false], ['en', 1440, false, true], ['zh', 390, false, true], ['en', 1440, true, false]]) {
    const zh = language === 'zh', text = (cn, en) => zh ? cn : en;
    let saved = { schemaVersion: 6, content: { kind: 'composition', units: 'meters', durationSeconds: 10, loop: false, assets: {}, instances: ['One', 'Two', 'Three'].map((name, index) => ({
      id: name, name, text: { content: name, color: '#2255aa', fontSize: .4, width: 1, align: 'center' }, position: [(index - 1) * 1.5, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1], animation: null,
    })) } };
    let writes = 0;
    const detail = () => ({ id, organization_id: team, name: 'Selection fixture', state: 'active', lock_version: writes + 1, capabilities: { can_read: true, can_edit: !readOnly, can_archive: !readOnly }, referenced_resources: [], document: saved });
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: 'better-auth.session_token', value: 'scene-fixture', url: origin }, { name: 'language', value: language, url: origin }]);
    await context.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      let body = { data: [], page: { total: 0, hasMore: false, limit: 30, offset: 0 } };
      if (request.method() !== 'GET') {
        assert.equal(readOnly, false); assert.equal(path, `/api/scenes/${id}`); assert.equal(request.method(), 'PATCH');
        const input = request.postDataJSON(); saved = input.document; writes++; body = { data: detail() };
      } else if (path === '/api/auth/get-session') body = { user: { id: 'fixture', name: 'Fixture', email: 'fixture@example.invalid' }, session: { id: 'fixture', expiresAt: '2099-01-01' } };
      else if (path === '/api/auth/role') body = { role: 'user' };
      else if (path === '/api/organizations') body = { data: [{ id: team, name: 'Fixture team', role: readOnly ? 'viewer' : 'owner', allowed_file_types: ['model'] }] };
      else if (path === `/api/scenes/${id}`) body = { data: detail() };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/manage/scenes/${id}?organizationId=${team}`, { waitUntil: 'networkidle' });
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
    const canvas = page.locator('.scene-three-viewport canvas').first(); await canvas.waitFor();
    const tracks = page.locator('.scene-track-heading-cell'); await tracks.last().waitFor();
    if (screenshots) await page.screenshot({ animations: 'disabled', path: `${screenshots}/${language}-${width}-${readOnly}-${dark ? 'dark' : 'light'}-initial.png` });
    if (width === 1440) {
      await page.getByRole('button', { name: text('回到原点', 'Focus origin'), exact: true }).click();
      const rect = await canvas.boundingBox();
      const camera = new PerspectiveCamera(50, rect.width / rect.height, .01, 2000);
      camera.position.set(5, 4, 7); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
      const clickObject = async x => { const point = new Vector3(x, 1.3, 0).project(camera); await page.mouse.click(rect.x + (point.x + 1) * rect.width / 2, rect.y + (1 - point.y) * rect.height / 2); };
      await clickObject(-1.5);
      assert.equal(await tracks.nth(0).getAttribute('aria-pressed'), 'true');
      await page.keyboard.down('Control'); await clickObject(1.5); await page.keyboard.up('Control');
      assert.equal(await page.locator('.scene-track-heading-cell[data-selected]').count(), 2);
      await page.keyboard.press('Escape');
    }
    await tracks.nth(0).locator('.scene-track-name').click();
    await tracks.nth(0).focus(); await page.keyboard.press('Shift+ArrowDown');
    assert.equal(await page.locator('.scene-track-heading-cell[data-selected]').count(), 2);
    await page.keyboard.press('Shift+ArrowDown');
    assert.equal(await page.locator('.scene-track-heading-cell[data-selected]').count(), 3);
    await tracks.nth(0).locator('.scene-track-name').click(); await tracks.nth(2).locator('.scene-track-name').click({ modifiers: ['Shift'] });
    assert.equal(await page.locator('.scene-track-heading-cell[data-selected]').count(), 3);
    await tracks.nth(1).locator('.scene-track-name').click({ modifiers: ['ControlOrMeta'] });
    assert.equal(await page.locator('.scene-track-heading-cell[data-selected]').count(), 2);
    await page.keyboard.press('ControlOrMeta+a');
    assert.equal(await page.locator('.scene-track-heading-cell[data-selected]').count(), 3);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.scene-track-heading-cell[data-selected]').count(), 0);
    await canvas.focus(); await page.keyboard.press('ControlOrMeta+a');
    assert.equal(await page.locator('.scene-track-heading-cell[data-selected]').count(), 3);
    if (!readOnly) {
      await page.keyboard.press('ControlOrMeta+c'); await page.keyboard.press('ControlOrMeta+v');
      assert.equal(await tracks.count(), 6);
      await page.keyboard.press('Backspace'); assert.equal(await tracks.count(), 3);
      await page.keyboard.press('ControlOrMeta+z'); assert.equal(await tracks.count(), 6);
      await page.keyboard.press('ControlOrMeta+z'); assert.equal(await tracks.count(), 3);
    }
    await page.getByRole('button', { name: text('灯光与环境', 'Lighting and environment'), exact: true }).click();
    const intensity = page.getByRole('spinbutton', { name: text('主光强度', 'Key light intensity'), exact: true });
    if (readOnly) assert.equal(await intensity.isDisabled(), true);
    else {
      await intensity.fill('3.5'); await intensity.press('Tab');
      // Cmd+A inside a field remains native text selection, without changing track selection.
      await intensity.focus(); await intensity.press('ControlOrMeta+a');
      assert.equal(await intensity.evaluate(node => node.value), '3.5');
      if (screenshots) await page.screenshot({ animations: 'disabled', path: `${screenshots}/${language}-${width}-${dark ? 'dark' : 'light'}-lighting.png` });
      await page.keyboard.press('Escape');
      const savedResponse = page.waitForResponse(response => response.url().endsWith(`/api/scenes/${id}`) && response.request().method() === 'PATCH');
      await canvas.focus(); await page.keyboard.press('ControlOrMeta+s');
      await savedResponse;
      assert.equal(saved.content.lighting.directionalIntensity, 3.5);
      await page.reload({ waitUntil: 'networkidle' });
      await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
      await page.getByRole('button', { name: text('灯光与环境', 'Lighting and environment'), exact: true }).click();
      assert.equal(await intensity.inputValue(), '3.5');
      await page.keyboard.press('Escape'); await canvas.focus(); await page.keyboard.press('ControlOrMeta+a');
      assert.equal(await tracks.count(), 3);
    }
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    console.log(`PASS Scene editor selection/lighting ${language} ${width}px dark=${dark} readOnly=${readOnly}, writes=${writes}`);
    await context.close();
  }
} finally { await browser.close(); }

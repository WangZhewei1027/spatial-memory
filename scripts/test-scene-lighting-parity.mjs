import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const bundle = await build({ entryPoints: ['scripts/test-support/lighting-browser.mjs'], bundle: true, write: false, format: 'iife', platform: 'browser' });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() => globalThis.runLightingParity());
  assert.equal(result.webRevision, result.miniRevision, 'both hosts ship the same Three revision');
  assert.deepEqual(errors, []);
  assert.equal(new Set(result.results.map(sample => sample.energy)).size, 3, "lighting controls visibly change the rendered objects");
  for (const sample of result.results) {
    assert.ok(sample.averageError < .25, JSON.stringify(sample));
    assert.ok(sample.changedChannels < 80, JSON.stringify(sample));
  }
  console.log('PASS actual Web/mini GPU rendering, metallic/rough surfaces, studio/none, custom colors/directions and rotated AR placement:', JSON.stringify(result));
} finally { await browser.close(); }

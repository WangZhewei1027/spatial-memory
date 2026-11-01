import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Explicitly audited: no live database, external service or sibling checkout.
// Keep DB/migration/HTTP and cross-runtime suites out of this default command.
const tests = [
  "test-engineering-standards.mjs",
  "test-upload-http-server.mjs",
  "test-activity-presentation.ts",
  "test-activity-input.ts",
  "test-content-model-contracts.ts",
  "test-content-model-resource-presentation.ts",
  "test-content-model-url-resources.ts",
  "test-content-model-altitude.ts",
  "test-content-model-legacy-anchor.ts",
  "test-content-model-legacy-animations.ts",
  "test-scene-core.ts",
  "test-scene-performance.ts",
  "test-scene-automation.ts",
  "test-scene-visibility.ts",
  "test-scene-timeline-automation.ts",
  "test-scene-media-runtime.ts",
  "test-scene-regions.ts",
  "test-scene-hierarchy.ts",
  "test-scene-add-model.ts",
  "test-scene-interactions.ts",
  "test-scene-spatial-reference.ts",
  "test-scene-camera-inset.ts",
  "test-viewer-resources.mjs",
  "test-matching-status.mjs",
  "test-sms-auth.cjs",
  "test-google-relay-function.mjs",
];

// React client imports must not inherit the react-server export condition.
const serverTests = ["test-wechat-qr.ts", "test-google-relay.mjs", "test-upload-request.ts", "test-upload-media.ts", "test-upload-progress.ts"];
for (const [conditions, files] of [[[], tests], [["--conditions", "react-server"], serverTests]]) {
  const result = spawnSync(process.execPath, [
    "--import", "tsx", ...conditions, "--test", "--test-concurrency=1",
    ...files.map((file) => `scripts/${file}`),
  ], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...process.env, NODE_ENV: "test" },
    stdio: "inherit",
  });
  if (result.error) console.error(result.error.message);
  if (result.signal) console.error(`Test runner terminated by ${result.signal}`);
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}

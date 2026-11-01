// Usage: node scripts/deploy-google-auth-relay.mjs /absolute/private/config.json
// The private file supplies accessKeyId, accessKeySecret, optional securityToken,
// and environmentVariables. Never put it in the repository or print API bodies.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { default: Client, Config, Params, OpenApiRequest } = require("@alicloud/openapi-client");
const { RuntimeOptions } = require("@alicloud/tea-util");
const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const region = "cn-hongkong";
// Deploy the current production identity; input can target an isolated test function.
const name = input.functionName ?? "spatial-memory-google-oauth-relay";
const root = `/2023-03-30/functions/${name}`;
const client = new Client(new Config({
  accessKeyId: input.accessKeyId, accessKeySecret: input.accessKeySecret,
  securityToken: input.securityToken,
  endpoint: `fcv3.${region}.aliyuncs.com`, regionId: region,
}));
async function call(action, method, pathname, body) {
  const result = await client.callApi(new Params({
    action, version: "2023-03-30", protocol: "HTTPS", pathname, method,
    authType: "AK", style: "ROA", reqBodyType: "json", bodyType: "json",
  }), new OpenApiRequest({ body }), new RuntimeOptions({ readTimeout: 60000, connectTimeout: 10000 }));
  return result.body;
}
async function exists(action, pathname) {
  try { return await call(action, "GET", pathname); }
  catch (error) { if (error.statusCode === 404) return null; throw error; }
}
try {
  const env = input.environmentVariables;
  for (const key of ["GOOGLE_RELAY_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"]) {
    if (!env?.[key]) throw new Error(`Missing ${key}`);
  }
  const directory = fileURLToPath(new URL("../deploy/google-auth-relay", import.meta.url));
  const zipFile = execFileSync("python3", ["-c", [
    "import io,sys,zipfile,pathlib,base64",
    "out=io.BytesIO()",
    "with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:",
    " for name in ['index.mjs','google.mjs']:z.write(pathlib.Path(sys.argv[1])/name,name)",
    "print(base64.b64encode(out.getvalue()).decode())",
  ].join("\n"), directory], { encoding: "utf8" }).trim();
  const existing = await exists("GetFunction", root);
  const config = {
    description: "Private Google OAuth transport for Spatial Memory; no database access",
    runtime: "nodejs20", handler: "index.handler", memorySize: 128, cpu: 0.05,
    diskSize: 512, timeout: 15, instanceConcurrency: 5, internetAccess: true,
    environmentVariables: env, code: { zipFile },
  };
  const deployed = existing
    ? await call("UpdateFunction", "PUT", root, config)
    : await call("CreateFunction", "POST", "/2023-03-30/functions", { functionName: name, ...config });
  await call("PutConcurrencyConfig", "PUT", `${root}/concurrency`, { reservedConcurrency: 2 });
  const triggerName = "authenticated-http";
  const triggerPath = `${root}/triggers/${triggerName}`;
  const oldTrigger = await exists("GetTrigger", triggerPath);
  const triggerConfig = JSON.stringify({ authType: "anonymous", methods: ["GET", "POST"], disableURLInternet: false });
  const trigger = oldTrigger
    ? await call("UpdateTrigger", "PUT", triggerPath, { triggerConfig })
    : await call("CreateTrigger", "POST", `${root}/triggers`, { triggerName, triggerType: "http", triggerConfig, qualifier: "LATEST" });
  console.log(JSON.stringify({ region, functionName: name, codeSha256: deployed.codeSha256,
    url: trigger.httpTrigger?.urlInternet ?? oldTrigger?.httpTrigger?.urlInternet, runtime: deployed.runtime }));
} catch (error) {
  // Provider errors can include environment variables or request bodies.
  console.error(JSON.stringify({ failed: true, code: error.code ?? "deployment_error", status: error.statusCode ?? null }));
  process.exitCode = 1;
}

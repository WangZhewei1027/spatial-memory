/** Real route and DB coverage for per-map settings. Only auth/OSS are stubbed. */
import assert from "node:assert/strict";
import { Client } from "pg";
import { assertServicesDatabase, cleanupServicesFixture, fixtureIds, seedServicesFixture } from "./test-content-model-services-fixture";
import { installRouteStubs } from "./test-support/install-route-stubs";
import type * as AuthStub from "./test-support/stub-auth-server";
import { DEFAULT_COLLECTION_MINIAPP_CONFIG } from "../lib/content-model/collection-config";

async function main() {
  assertServicesDatabase(); await installRouteStubs();
  const auth = await import("../lib/auth/server") as unknown as typeof AuthStub;
  const { db } = await import("../lib/db");
  const route = await import("../app/api/collections/[id]/route");
  const maps = await import("../app/api/miniapp/workspaces/route");
  const organizations = await import("../app/api/miniapp/organizations/route");
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  const f = fixtureIds();
  const config = { ...DEFAULT_COLLECTION_MINIAPP_CONFIG, retrieval_mode: "anchor", text_asset_miniapp_style: "plain_white", confetti_enabled: true, footer_enabled: true };
  const call = async (user: string | null, body?: unknown, id = f.workspaces.a) => {
    auth.setStubSessionUser(user ? { id: user, email: null, name: null, emailVerified: true } : null);
    const response = await (body === undefined ? route.GET : route.PATCH)(new Request(`http://localhost/api/collections/${id}`, {
      method: body === undefined ? "GET" : "PATCH", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
    }), { params: Promise.resolve({ id }) });
    return { status: response.status, body: await response.json() };
  };
  const discover = async (id: string, team = f.organizations.team) => {
    const response = await maps.GET(new Request(`http://localhost/api/miniapp/workspaces?ids=${id}&organization_id=${team}`));
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.status, 200); return response.json();
  };
  try {
    await seedServicesFixture(client, f);
    await client.query("update organization set config=$2 where id=$1", [f.organizations.team, { confetti_enabled: true, footer_enabled: true, private_setting: "private" }]);
    const original = (await call(f.users.owner)).body.data;
    assert.deepEqual(original.miniapp_config, DEFAULT_COLLECTION_MINIAPP_CONFIG, "retired team changes never change a map");
    assert.equal((await call(null)).status, 401);
    assert.equal((await call(f.users.viewer, { miniappConfig: config, expectedLockVersion: 1 })).status, 403);
    assert.equal((await call(f.users.foreign, { miniappConfig: config, expectedLockVersion: 1 })).status, 404, "foreign maps do not disclose their existence");
    assert.equal((await call(f.users.owner, { miniappConfig: config })).body.code, "LOCK_VERSION_REQUIRED");
    for (const invalid of [{}, { ...config, retrieval_mode: "other" }, { ...config, confetti_enabled: "true" }, { ...config, private_setting: true }])
      assert.equal((await call(f.users.owner, { miniappConfig: invalid, expectedLockVersion: 1 })).status, 400);
    const saved = await call(f.users.editor, { miniappConfig: config, expectedLockVersion: 1 });
    assert.equal(saved.status, 200); assert.equal(saved.body.data.config_lock_version, 2);
    assert.deepEqual(saved.body.data.miniapp_config, config);
    assert.deepEqual((await call(f.users.owner, undefined, f.workspaces.b)).body.data.miniapp_config, DEFAULT_COLLECTION_MINIAPP_CONFIG);
    assert.deepEqual((await discover(f.workspaces.a))[0], { id: f.workspaces.a, name: original.name, organization_id: f.organizations.team, config });
    assert.deepEqual(await discover(f.workspaces.a, f.organizations.foreign), []);
    const list = await (await maps.GET(new Request(`http://localhost/api/miniapp/workspaces?organization_id=${f.organizations.team}`))).json();
    assert.ok(list.some((map: { id: string }) => map.id === f.workspaces.a));
    assert.ok(list.every((map: { organization_id: string }) => map.organization_id === f.organizations.team));
    assert.equal((await maps.GET(new Request("http://localhost/api/miniapp/workspaces"))).status, 400, "listing requires a team");
    assert.equal((await maps.GET(new Request("http://localhost/api/miniapp/workspaces?ids=bad"))).status, 400);
    const orgRows = await (await organizations.GET(new Request(`http://localhost/api/miniapp/organizations?ids=${f.organizations.team}`))).json();
    assert.deepEqual(Object.keys(orgRows[0]).sort(), ["id", "name"], "team settings stay private");
    const writes = await Promise.all([
      call(f.users.owner, { miniappConfig: { ...config, footer_enabled: false }, expectedLockVersion: 2 }),
      call(f.users.owner, { miniappConfig: { ...config, confetti_enabled: false }, expectedLockVersion: 2 }),
    ]);
    assert.deepEqual(writes.map((result) => result.status).sort(), [200, 409]);
    assert.equal((await call(f.users.owner)).body.data.config_lock_version, 3);
    await call(f.users.owner, { name: "Renamed map" });
    assert.equal((await call(f.users.owner)).body.data.config_lock_version, 3, "renames do not replace configuration or its guard");
    await client.query("update workspace set archived_at=now() where id=$1", [f.workspaces.a]);
    assert.equal((await call(f.users.owner, { miniappConfig: config, expectedLockVersion: 3 })).body.code, "ARCHIVED");
    assert.deepEqual(await discover(f.workspaces.a), []);
    const activeMaps = await (await maps.GET(new Request(`http://localhost/api/miniapp/workspaces?organization_id=${f.organizations.team}`))).json();
    assert.ok(!activeMaps.some((map: { id: string }) => map.id === f.workspaces.a));
    await client.query("update workspace set archived_at=null where id=$1", [f.workspaces.a]);
    await client.query("update organization set archived_at=now() where id=$1", [f.organizations.team]);
    assert.equal((await call(f.users.owner, { miniappConfig: config, expectedLockVersion: 3 })).body.code, "ARCHIVED");
    assert.deepEqual(await discover(f.workspaces.a), []);
    console.log("PASS map settings routes: permissions, strict input, locking, map isolation, public config and archived scopes");
  } finally {
    await cleanupServicesFixture(client, f); await client.end(); await db.destroy();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

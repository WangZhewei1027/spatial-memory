/**
 * In-process HTTP contract test of the team workbench routes: the real route
 * handlers and a real database, without a Next.js server or `.next` output.
 * Only the session (lib/auth/server.ts) and object storage (lib/storage/oss.ts)
 * are replaced by test doubles (scripts/test-support/install-route-stubs.ts).
 *
 *   DATABASE_URL=postgres://postgres:…@127.0.0.1:55439/team_wb_services \
 *     npx tsx --conditions react-server scripts/test-team-workbench-routes.ts
 *
 * Uses the dedicated services fixture (random tenants, removed afterwards).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { assertServicesDatabase, cleanupServicesFixture, fixtureIds, seedServicesFixture, assetDocument } from "./test-content-model-services-fixture";
import { installRouteStubs } from "./test-support/install-route-stubs";
import type * as AuthStub from "./test-support/stub-auth-server";
import type * as OssStub from "./test-support/stub-oss";

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
interface Call {
  user: string | null;
  method?: string;
  url: string;
  params?: Record<string, string>;
  body?: unknown;
  form?: FormData;
}

const failures: string[] = [];
let passed = 0;
const matchAt = process.argv.indexOf("--match");
const nameFilter = matchAt >= 0 ? process.argv[matchAt + 1] : undefined;
async function check(name: string, run: () => Promise<void>): Promise<void> {
  if (nameFilter && !name.includes(nameFilter)) return;
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
    console.error(`FAIL ${name}: ${message}`);
  }
}

async function main(): Promise<void> {
  assertServicesDatabase();
  await installRouteStubs();
  const auth = (await import("../lib/auth/server")) as unknown as typeof AuthStub;
  const oss = (await import("../lib/storage/oss")) as unknown as typeof OssStub;
  assert.equal(typeof auth.setStubSessionUser, "function", "the session module must be the test double");
  assert.ok(oss.stubObjects instanceof Map, "object storage must be the in-memory double");
  const client = new Client({ connectionString: process.env.DATABASE_URL, application_name: "team-workbench-routes" });
  await client.connect();
  const { db } = await import("../lib/db");
  const routes = {
    orgAssets: await import("../app/api/organizations/[id]/assets/route"),
    orgScenes: await import("../app/api/organizations/[id]/scenes/route"),
    sceneValidate: await import("../app/api/organizations/[id]/scenes/validate/route"),
    orgCollections: await import("../app/api/organizations/[id]/collections/route"),
    orgPlacements: await import("../app/api/organizations/[id]/placements/route"),
    collection: await import("../app/api/collections/[id]/route"),
    collectionArchive: await import("../app/api/collections/[id]/archive/route"),
    collectionAssets: await import("../app/api/collections/[id]/assets/route"),
    collectionPlacements: await import("../app/api/collections/[id]/placements/route"),
    asset: await import("../app/api/assets/[id]/route"),
    assetDuplicate: await import("../app/api/assets/[id]/duplicate/route"),
    assetUsage: await import("../app/api/assets/[id]/usage/route"),
    byHash: await import("../app/api/assets/by-hash/route"),
    scene: await import("../app/api/scenes/[id]/route"),
    miniScenePreview: await import("../app/api/miniapp/scenes/preview/route"),
    miniSceneNames: await import("../app/api/miniapp/scenes/route"),
    sceneCopy: await import("../app/api/scenes/[id]/copy/route"),
    upload: await import("../app/api/upload/route"),
    invitation: await import("../app/api/invitations/[token]/route"),
    adminClean: await import("../app/api/admin/clean/route"),
    organizations: await import("../app/api/organizations/route"),
    organization: await import("../app/api/organizations/[id]/route"),
    tags: await import("../app/api/tags/route"),
    miniNearby: await import("../app/api/miniapp/assets/nearby/route"),
    miniScene: await import("../app/api/miniapp/assets/scene/route"),
  };
  const f = fixtureIds();
  const startedAt = new Date();

  async function call(handler: unknown, input: Call): Promise<{ status: number; body: Body }> {
    auth.setStubSessionUser(input.user ? { id: input.user, email: null, name: null, emailVerified: true } : null);
    const headers: Record<string, string> = {};
    if (input.body !== undefined) headers["Content-Type"] = "application/json";
    const request = new Request(`http://localhost${input.url}`, {
      method: input.method ?? "GET",
      headers,
      body: input.form ?? (input.body === undefined ? undefined : JSON.stringify(input.body)),
    });
    const response = await (handler as Handler)(request, { params: Promise.resolve(input.params ?? {}) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }
  const expect = (result: { status: number; body: Body }, status: number, code?: string) => {
    assert.equal(result.status, status, `expected HTTP ${status}, got ${result.status}: ${JSON.stringify(result.body).slice(0, 300)}`);
    if (code) assert.equal(result.body.code, code);
    return result.body;
  };
  const modelBody = (key: string, resources: unknown[] = [{ role: "primary", externalUrl: `https://external-fixture.invalid/${key}.glb` }]) => ({
    name: `route ${key}`, fileType: "model", payload: { kind: "model" }, resources, idempotencyKey: `${f.run}-${key}`,
  });
  const uploadForm = (bytes: string, fields: Record<string, string>) => {
    const form = new FormData();
    form.set("file", new File([Buffer.from(bytes)], "route-model.glb", { type: "model/gltf-binary" }));
    form.set("type", "model");
    for (const [name, value] of Object.entries(fields)) form.set(name, value);
    return form;
  };

  try {
    await seedServicesFixture(client, f);
    const u = f.users;

    await check("R01 every new and changed route requires a session (401, error envelope)", async () => {
      for (const [handler, method, url, params] of [
        [routes.orgAssets.POST, "POST", `/api/organizations/${f.organizations.team}/assets`, { id: f.organizations.team }],
        [routes.orgScenes.GET, "GET", `/api/organizations/${f.organizations.team}/scenes`, { id: f.organizations.team }],
        [routes.sceneValidate.POST, "POST", `/api/organizations/${f.organizations.team}/scenes/validate`, { id: f.organizations.team }],
        [routes.orgCollections.GET, "GET", `/api/organizations/${f.organizations.team}/collections`, { id: f.organizations.team }],
        [routes.collection.GET, "GET", `/api/collections/${f.workspaces.a}`, { id: f.workspaces.a }],
        [routes.collectionArchive.POST, "POST", `/api/collections/${f.workspaces.a}/archive`, { id: f.workspaces.a }],
      ] as const) {
        expect(await call(handler, { user: null, method, url, params, body: method === "GET" ? undefined : {} }), 401, "UNAUTHENTICATED");
      }
    });

    await check("agent scene preflight route checks writer scope and returns resource facts without writes", async () => {
      const url = `/api/organizations/${f.organizations.team}/scenes/validate`, params = { id: f.organizations.team };
      const body = { document: assetDocument(f.assets.shared) };
      const result = expect(await call(routes.sceneValidate.POST, { user: u.editor, method: "POST", url, params, body }), 200);
      assert.equal(result.data.valid, true);
      assert.equal(result.data.referenced_resources[0].asset_id, f.assets.shared);
      expect(await call(routes.sceneValidate.POST, { user: u.viewer, method: "POST", url, params, body }), 403, "FORBIDDEN");
      expect(await call(routes.sceneValidate.POST, { user: u.foreign, method: "POST", url, params, body }), 403, "FORBIDDEN");
      expect(await call(routes.sceneValidate.POST, { user: u.editor, method: "POST", url, params, body: { document: {} } }), 400, "VALIDATION_FAILED");
    });

    await check("R02 POST /api/organizations/[id]/assets: team asset without collection, idempotent, writers only", async () => {
      const url = `/api/organizations/${f.organizations.team}/assets`;
      const params = { id: f.organizations.team };
      const created = expect(await call(routes.orgAssets.POST, { user: u.unassigned, method: "POST", url, params, body: modelBody("org-asset") }), 201).data;
      assert.equal(created.created, true);
      assert.equal(created.placement, null);
      assert.equal(created.asset.origin_workspace_id, null);
      assert.equal(created.asset.organization_id, f.organizations.team);
      assert.equal(created.asset.capabilities.can_maintain, true);
      const replay = expect(await call(routes.orgAssets.POST, { user: u.unassigned, method: "POST", url, params, body: modelBody("org-asset") }), 200).data;
      assert.equal(replay.created, false);
      assert.equal(replay.asset.id, created.asset.id);
      expect(await call(routes.orgAssets.POST, { user: u.viewer, method: "POST", url, params, body: modelBody("org-asset-viewer") }), 403, "FORBIDDEN");
      expect(await call(routes.orgAssets.POST, { user: u.foreign, method: "POST", url, params, body: modelBody("org-asset-foreign") }), 403, "FORBIDDEN");
      expect(await call(routes.orgAssets.POST, { user: u.unassigned, method: "POST", url, params,
        body: { ...modelBody("org-asset-placement"), placement: { location: { longitude: 121.5, latitude: 31.2 } } } }), 400, "VALIDATION_FAILED");
      expect(await call(routes.orgAssets.POST, { user: u.unassigned, method: "POST", url: "/api/organizations/not-a-uuid/assets", params: { id: "not-a-uuid" }, body: modelBody("bad-id") }), 400, "VALIDATION_FAILED");
      const page = expect(await call(routes.orgAssets.GET, { user: u.unassigned, url, params }), 200);
      assert.ok(Array.isArray(page.data) && page.page.total >= 4);
      assert.ok(page.data.some((item: Body) => item.id === f.assets.restricted), "view=all is the default and includes formerly restricted assets");
      const shared = expect(await call(routes.orgAssets.GET, { user: u.unassigned, url: `${url}?view=shared`, params }), 200);
      assert.equal(shared.data.some((item: Body) => item.id === f.assets.restricted), false);
      const catalog = expect(await call(routes.orgAssets.GET, { user: u.unassigned, url, params }), 200);
      assert.ok(Array.isArray(catalog.data), "the canonical catalog requires no version header");
      const viaCollection = expect(await call(routes.collectionAssets.GET, { user: u.unassigned, url: `/api/collections/${f.workspaces.secret}/assets`, params: { id: f.workspaces.secret } }), 200);
      assert.ok(viaCollection.data.some((item: Body) => item.id === f.assets.restricted && item.capabilities.can_use_in_workspace === true), "no grant is needed in another collection");
    });

    await check("R03 scenes: organization routes create and list team scenes", async () => {
      const url = `/api/organizations/${f.organizations.team}/scenes`;
      const params = { id: f.organizations.team };
      const scene = expect(await call(routes.orgScenes.POST, { user: u.unassigned, method: "POST", url, params,
        body: { name: "route team scene", document: assetDocument(f.assets.restricted), idempotencyKey: `${f.run}-route-scene` } }), 201).data;
      assert.equal(scene.workspace_id, null);
      assert.equal(scene.organization_id, f.organizations.team);
      assert.equal(scene.referenced_resources[0].asset_id, f.assets.restricted);
      const listed = expect(await call(routes.orgScenes.GET, { user: u.viewer, url: `${url}?state=active`, params }), 200).data;
      assert.ok(listed.some((item: Body) => item.id === scene.id && item.capabilities.can_edit === false));
      expect(await call(routes.orgScenes.GET, { user: u.unassigned, url: `${url}?state=bogus`, params }), 400, "VALIDATION_FAILED");
      expect(await call(routes.orgScenes.GET, { user: u.foreign, url, params }), 403, "FORBIDDEN");
      expect(await call(routes.orgScenes.POST, { user: u.viewer, method: "POST", url, params, body: { name: "viewer scene" } }), 403, "FORBIDDEN");
      const missingLock = await call(routes.scene.PATCH, { user: u.editor, method: "PATCH", url: `/api/scenes/${scene.id}`, params: { id: scene.id }, body: { name: "no lock" } });
      expect(missingLock, 428, "LOCK_VERSION_REQUIRED");
      expect(await call(routes.scene.PATCH, { user: u.editor, method: "PATCH", url: `/api/scenes/${scene.id}`, params: { id: scene.id }, body: { name: "first", expectedLockVersion: scene.lock_version } }), 200);
      const stale = expect(await call(routes.scene.PATCH, { user: u.owner, method: "PATCH", url: `/api/scenes/${scene.id}`, params: { id: scene.id }, body: { name: "stale", expectedLockVersion: scene.lock_version } }), 409, "LOCK_VERSION_CONFLICT");
      assert.equal(stale.details.current_lock_version, scene.lock_version + 1);
      const copy = expect(await call(routes.sceneCopy.POST, { user: u.editor, method: "POST", url: `/api/scenes/${scene.id}/copy`, params: { id: scene.id }, body: {} }), 201).data;
      assert.equal(copy.workspace_id, null);
      expect(await call(routes.scene.GET, { user: u.foreign, url: `/api/scenes/${scene.id}`, params: { id: scene.id } }), 404, "NOT_FOUND");
    });

    await check("R04 collections: create, list, get, rename, archive and restore through the new routes", async () => {
      const listUrl = `/api/organizations/${f.organizations.team}/collections`;
      const params = { id: f.organizations.team };
      const created = expect(await call(routes.orgCollections.POST, { user: u.unassigned, method: "POST", url: listUrl, params, body: { name: "route map", description: "north" } }), 201).data;
      assert.equal(created.name, "route map");
      expect(await call(routes.orgCollections.POST, { user: u.viewer, method: "POST", url: listUrl, params, body: { name: "viewer map" } }), 403, "FORBIDDEN");
      expect(await call(routes.orgCollections.POST, { user: u.unassigned, method: "POST", url: listUrl, params, body: { name: "x", role: "manager" } }), 400, "VALIDATION_FAILED");
      const active = expect(await call(routes.orgCollections.GET, { user: u.viewer, url: listUrl, params }), 200).data;
      assert.ok([f.workspaces.a, f.workspaces.b, f.workspaces.secret, f.workspaces.empty, created.id].every((id) => active.some((item: Body) => item.id === id)), "viewers see every collection");
      expect(await call(routes.orgCollections.GET, { user: u.viewer, url: `${listUrl}?state=everything`, params }), 400, "VALIDATION_FAILED");
      const one = { url: `/api/collections/${created.id}`, params: { id: created.id } };
      assert.equal(expect(await call(routes.collection.GET, { user: u.viewer, ...one }), 200).data.id, created.id);
      expect(await call(routes.collection.GET, { user: u.foreign, ...one }), 404, "NOT_FOUND");
      const renamed = expect(await call(routes.collection.PATCH, { user: u.editor, method: "PATCH", ...one, body: { name: "route map renamed" } }), 200).data;
      assert.equal(renamed.name, "route map renamed");
      const archive = { url: `/api/collections/${created.id}/archive`, params: { id: created.id } };
      const archived = expect(await call(routes.collectionArchive.POST, { user: u.editor, method: "POST", ...archive }), 200).data;
      assert.ok(archived.archived_at);
      assert.ok(expect(await call(routes.orgCollections.GET, { user: u.viewer, url: `${listUrl}?state=archived`, params }), 200).data.some((item: Body) => item.id === created.id));
      assert.equal(expect(await call(routes.orgCollections.GET, { user: u.viewer, url: listUrl, params }), 200).data.some((item: Body) => item.id === created.id), false);
      expect(await call(routes.collection.PATCH, { user: u.editor, method: "PATCH", ...one, body: { name: "while archived" } }), 409, "ARCHIVED");
      expect(await call(routes.collectionArchive.DELETE, { user: u.viewer, method: "DELETE", ...archive }), 403, "FORBIDDEN");
      assert.equal(expect(await call(routes.collectionArchive.DELETE, { user: u.unassigned, method: "DELETE", ...archive }), 200).data.archived_at, null);
    });



    await check("R07 POST /api/upload binds receipts to the team (collection optional), never trusting the form's organization", async () => {
      const bytes = `route-upload-${f.run}`;
      const hash = createHash("sha256").update(bytes).digest("hex");
      const orgOnly = expect(await call(routes.upload.POST, { user: u.unassigned, method: "POST", url: "/api/upload", form: uploadForm(bytes, { organization_id: f.organizations.solo, purpose: "asset" }) }), 200);
      assert.equal(orgOnly.contentHash, hash);
      assert.ok(orgOnly.storagePath && oss.stubObjects.has(orgOnly.storagePath), "new bytes are written once");
      assert.equal(orgOnly.data.workspace_id, null);
      assert.equal(orgOnly.data.organization_id, f.organizations.solo);
      assert.equal(orgOnly.data.purpose, "asset");
      const again = expect(await call(routes.upload.POST, { user: u.unassigned, method: "POST", url: "/api/upload", form: uploadForm(bytes, { organization_id: f.organizations.solo }) }), 200);
      assert.equal(again.storagePath, null, "identical bytes in the same team are reused");
      assert.equal(again.data.reused, true);
      const otherTeam = expect(await call(routes.upload.POST, { user: u.unassigned, method: "POST", url: "/api/upload", form: uploadForm(bytes, { organization_id: f.organizations.team }) }), 200);
      assert.ok(otherTeam.storagePath, "dedup never crosses teams");
      const withCollection = expect(await call(routes.upload.POST, { user: u.unassigned, method: "POST", url: "/api/upload", form: uploadForm(`${bytes}-b`, { organization_id: f.organizations.team, workspace_id: f.workspaces.b }) }), 200);
      assert.equal(withCollection.data.workspace_id, f.workspaces.b);
      const collectionOnly = expect(await call(routes.upload.POST, { user: u.unassigned, method: "POST", url: "/api/upload", form: uploadForm(`${bytes}-c`, { workspace_id: f.workspaces.secret }) }), 200);
      assert.equal(collectionOnly.data.organization_id, f.organizations.team, "old callers: the organization comes from the collection");
      expect(await call(routes.upload.POST, { user: u.unassigned, method: "POST", url: "/api/upload", form: uploadForm(`${bytes}-d`, { organization_id: f.organizations.solo, workspace_id: f.workspaces.b }) }), 404, "NOT_FOUND");
      expect(await call(routes.upload.POST, { user: u.viewer, method: "POST", url: "/api/upload", form: uploadForm(`${bytes}-e`, { organization_id: f.organizations.team }) }), 403, "FORBIDDEN");
      expect(await call(routes.upload.POST, { user: u.foreign, method: "POST", url: "/api/upload", form: uploadForm(`${bytes}-f`, { organization_id: f.organizations.team }) }), 403, "FORBIDDEN");
      expect(await call(routes.upload.POST, { user: u.foreign, method: "POST", url: "/api/upload", form: uploadForm(`${bytes}-g`, { workspace_id: f.workspaces.b }) }), 404, "NOT_FOUND");
      expect(await call(routes.upload.POST, { user: u.unassigned, method: "POST", url: "/api/upload", form: uploadForm(`${bytes}-h`, {}) }), 400);
      const created = expect(await call(routes.orgAssets.POST, { user: u.unassigned, method: "POST", url: `/api/organizations/${f.organizations.solo}/assets`, params: { id: f.organizations.solo },
        body: modelBody("uploaded-solo", [{ role: "primary", receiptId: orgOnly.data.id }]) }), 201).data;
      assert.equal(created.asset.resources[0].storage_key, orgOnly.storagePath);
      expect(await call(routes.orgAssets.POST, { user: u.owner, method: "POST", url: `/api/organizations/${f.organizations.solo}/assets`, params: { id: f.organizations.solo },
        body: modelBody("receipt-other-user", [{ role: "primary", receiptId: again.data.id }]) }), 400, "RECEIPT_INVALID");
      expect(await call(routes.orgAssets.POST, { user: u.unassigned, method: "POST", url: `/api/organizations/${f.organizations.team}/assets`, params: { id: f.organizations.team },
        body: modelBody("receipt-other-team", [{ role: "primary", receiptId: again.data.id }]) }), 400, "RECEIPT_INVALID");
      const probe = (user: string, query: string) => call(routes.byHash.GET, { user, url: `/api/assets/by-hash?hash=${hash}&${query}` });
      assert.ok(expect(await probe(u.owner, `organization_id=${f.organizations.solo}`), 200).file_url, "team members find committed team files");
      assert.equal(expect(await probe(u.foreign, `organization_id=${f.organizations.foreign}`), 200).file_url, null, "another team's hash is never disclosed");
      expect(await probe(u.foreign, `organization_id=${f.organizations.solo}`), 403, "FORBIDDEN");
      expect(await probe(u.unassigned, ""), 400);
      expect(await call(routes.asset.PATCH, { user: u.owner, method: "PATCH", url: `/api/assets/${created.asset.id}`, params: { id: created.asset.id },
        body: { payload: { kind: "model" }, resources: [{ role: "primary", receiptId: withCollection.data.id }], expectedLockVersion: created.asset.lock_version } }), 400, "RECEIPT_INVALID");
    });

    await check("R08 placements: a saved team Scene goes into two collections; duplicate needs no target; mini-program sees both", async () => {
      const team = { id: f.organizations.team };
      const asset = expect(await call(routes.orgAssets.POST, { user: u.editor, method: "POST", url: `/api/organizations/${f.organizations.team}/assets`, params: team, body: modelBody("placement-model") }), 201).data;
      const scene = expect(await call(routes.orgScenes.POST, { user: u.editor, method: "POST", url: `/api/organizations/${f.organizations.team}/scenes`, params: team,
        body: { name: "route placed scene", document: assetDocument(asset.asset.id) } }), 201).data;
      const place = (workspace: string, user: string, longitude: number) => call(routes.collectionPlacements.POST, { user, method: "POST", url: `/api/collections/${workspace}/placements`, params: { id: workspace },
        body: { target: { kind: "scene", sceneId: scene.id }, location: { longitude, latitude: 31.2 } } });
      const first = expect(await place(f.workspaces.empty, u.unassigned, 121.5), 201).data.placement;
      const second = expect(await place(f.workspaces.secret, u.maintainer, 121.5001), 201).data.placement;
      expect(await place(f.workspaces.b, u.viewer, 121.5), 403, "FORBIDDEN");
      assert.notEqual(first.id, second.id);
      const listed = expect(await call(routes.orgPlacements.GET, { user: u.viewer, url: `/api/organizations/${f.organizations.team}/placements`, params: team }), 200).data;
      assert.ok([first.id, second.id].every((id) => listed.some((item: Body) => item.id === id)));
      for (const [workspace, placement] of [[f.workspaces.empty, first], [f.workspaces.secret, second]] as const) {
        const nearby = expect(await call(routes.miniNearby.POST, { user: null, method: "POST", url: "/api/miniapp/assets/nearby",
          body: { user_lat: 31.2, user_lng: 121.5, max_distance_meters: 100, p_workspace_id: workspace, p_organization_id: f.organizations.team } }), 200);
        assert.ok((nearby as unknown as Body[]).some((row) => row.id === placement.public_id && row.file_type === "scene"), "old mini-program parameters still discover the placement");
        const manifest = expect(await call(routes.miniScene.POST, { user: null, method: "POST", url: "/api/miniapp/assets/scene",
          body: { asset_id: placement.public_id, p_workspace_id: workspace } }), 200);
        assert.equal(manifest.assetId, placement.public_id);
      }
      const duplicate = expect(await call(routes.assetDuplicate.POST, { user: u.unassigned, method: "POST", url: `/api/assets/${asset.asset.id}/duplicate`, params: { id: asset.asset.id }, body: { idempotencyKey: `${f.run}-route-duplicate` } }), 201).data;
      assert.equal(duplicate.asset.origin_workspace_id, null);
      const targeted = expect(await call(routes.assetDuplicate.POST, { user: u.unassigned, method: "POST", url: `/api/assets/${asset.asset.id}/duplicate`, params: { id: asset.asset.id },
        body: { idempotencyKey: `${f.run}-route-duplicate-b`, targetWorkspaceId: f.workspaces.b } }), 201).data;
      assert.equal(targeted.asset.origin_workspace_id, f.workspaces.b);
      expect(await call(routes.assetDuplicate.POST, { user: u.unassigned, method: "POST", url: `/api/assets/${asset.asset.id}/duplicate`, params: { id: asset.asset.id },
        body: { idempotencyKey: `${f.run}-route-duplicate-foreign`, targetWorkspaceId: f.workspaces.foreign } }), 404, "NOT_FOUND");
      const patched = expect(await call(routes.asset.PATCH, { user: u.unassigned, method: "PATCH", url: `/api/assets/${asset.asset.id}`, params: { id: asset.asset.id },
        body: { name: "renamed by a teammate", expectedLockVersion: asset.asset.lock_version } }), 200).data;
      assert.equal(patched.name, "renamed by a teammate");
      expect(await call(routes.asset.PATCH, { user: u.unassigned, method: "PATCH", url: `/api/assets/${asset.asset.id}`, params: { id: asset.asset.id },
        body: { name: "headerless client", expectedLockVersion: patched.lock_version } }), 200);
    });

    await check("R12 scene QR shares saved content, enforces team access on generation and rejects closed public scopes", async () => {
      const qr = await import("../app/manage/actions/wechat-qr");
      const keys = await import("../lib/wechat-qr");
      const scene = expect(await call(routes.orgScenes.POST, { user: u.editor, method: "POST", url: `/api/organizations/${f.organizations.team}/scenes`, params: { id: f.organizations.team },
        body: { name: "QR saved scene", document: assetDocument(f.assets.shared) } }), 201).data;
      const key = keys.buildSceneQrObjectKey(f.organizations.team, scene.id, "release"); oss.seedStubObject(key);
      auth.setStubSessionUser(null); assert.ok((await qr.getOrCreateSceneQRCode(scene.id, "release")).error);
      auth.setStubSessionUser({ id: u.foreign, email: null, name: null, emailVerified: true }); assert.ok((await qr.getOrCreateSceneQRCode(scene.id, "release")).error);
      auth.setStubSessionUser({ id: u.viewer, email: null, name: null, emailVerified: true }); assert.equal((await qr.getOrCreateSceneQRCode(scene.id, "release")).url, oss.mediaUrl(key));
      const path = keys.buildSceneMiniProgramPath(f.organizations.team, scene.id);
      assert.ok(path.length <= 128); assert.ok(path.startsWith("pages/index/index?"));
      const params = new URLSearchParams(path.split("?")[1]); assert.equal(params.get("sceneId"), scene.id);
      assert.equal(params.get("organizationId"), f.organizations.team); assert.equal(params.has("workspaceId"), false);
      const collectionKey = keys.buildQrObjectKey(f.organizations.team, f.workspaces.a, "release"); oss.seedStubObject(collectionKey);
      assert.equal((await qr.getOrCreateWorkspaceQRCode({ organizationId: f.organizations.team, workspaceId: f.workspaces.a, environment: "release" })).url, oss.mediaUrl(collectionKey));
      assert.ok((await qr.getOrCreateWorkspaceQRCode({ organizationId: f.organizations.team, workspaceId: f.workspaces.foreign, environment: "release" })).error);
      for (const environment of keys.WECHAT_QR_ENVIRONMENTS) {
        const sceneKey = keys.buildSceneQrObjectKey(f.organizations.team, scene.id, environment);
        const mapKey = keys.buildQrObjectKey(f.organizations.team, f.workspaces.a, environment);
        oss.seedStubObject(sceneKey); oss.seedStubObject(mapKey);
        assert.equal((await qr.getOrCreateSceneQRCode(scene.id, environment)).url, oss.mediaUrl(sceneKey));
        assert.equal((await qr.getOrCreateWorkspaceQRCode({ organizationId: f.organizations.team, workspaceId: f.workspaces.a, environment })).url, oss.mediaUrl(mapKey));
      }
      // Runtime input can bypass TypeScript; reject unknown versions before cache lookup.
      const invalid = "invalid" as Parameters<typeof qr.getOrCreateSceneQRCode>[1];
      assert.equal((await qr.getOrCreateSceneQRCode(scene.id, invalid)).error, "无效的小程序版本");
      assert.equal((await qr.getOrCreateWorkspaceQRCode({ organizationId: f.organizations.team, workspaceId: f.workspaces.a, environment: invalid })).error, "无效的小程序版本");
      const preview = (body: unknown) => call(routes.miniScenePreview.POST, { user: null, method: "POST", url: "/api/miniapp/scenes/preview", body });
      const body = { scene_id: scene.id, organization_id: f.organizations.team };
      const first = expect(await preview(body), 200); assert.equal(first.assetId, scene.id); assert.equal(first.schemaVersion, 4);
      expect(await preview({ ...body, scene_id: "invalid" }), 400);
      expect(await preview({ ...body, organization_id: f.organizations.foreign }), 404);
      const document = assetDocument(f.assets.shared); document.content.durationSeconds = 34;
      const saved = expect(await call(routes.scene.PATCH, { user: u.editor, method: "PATCH", url: `/api/scenes/${scene.id}`, params: { id: scene.id }, body: { expectedLockVersion: scene.lock_version, document } }), 200).data;
      assert.equal(expect(await preview(body),200).content.durationSeconds,34);
      await call(routes.scene.PATCH, { user: u.editor, method: "PATCH", url: `/api/scenes/${scene.id}`, params: { id: scene.id }, body: { expectedLockVersion: saved.lock_version, state: "archived" } });
      expect(await preview(body),404);
      auth.setStubSessionUser({ id: u.editor, email: null, name: null, emailVerified: true }); assert.ok((await qr.getOrCreateSceneQRCode(scene.id, "release")).error);
      await client.query("update organization set archived_at=now() where id=$1",[f.organizations.team]);
      try { expect(await preview({ scene_id: f.scenes.a, organization_id: f.organizations.team }),404); }
      finally { await client.query("update organization set archived_at=null where id=$1",[f.organizations.team]); }
    });

    await check("R09c miniapp Scene names are current, team-scoped and exclude archives", async () => {
      const id = f.scenes.b;
      const original = (await client.query("select name,state from scene where id=$1", [id])).rows[0];
      const names = (query: string) => call(routes.miniSceneNames.GET, { user: null, url: `/api/miniapp/scenes?${query}` });
      const query = `ids=${id}&organization_id=${f.organizations.team}`;
      try {
        await client.query("update scene set name='Scene name one',state='active' where id=$1", [id]);
        assert.deepEqual(expect(await names(query), 200), [{ id, name: "Scene name one" }]);
        await client.query("update scene set name='Scene name two' where id=$1", [id]);
        assert.deepEqual(expect(await names(query), 200), [{ id, name: "Scene name two" }]);
        assert.deepEqual(expect(await names(`ids=${id}&organization_id=${f.organizations.foreign}`), 200), []);
        expect(await names(`ids=${id}`), 400);
        expect(await names(`ids=invalid&organization_id=${f.organizations.team}`), 400);
        expect(await names(`ids=${id}&organization_id=invalid`), 400);
        await client.query("update scene set state='archived' where id=$1", [id]);
        assert.deepEqual(expect(await names(query), 200), []);
        await client.query("update scene set state='active' where id=$1", [id]);
        await client.query("update organization set archived_at=now() where id=$1", [f.organizations.team]);
        assert.deepEqual(expect(await names(query), 200), []);
      } finally {
        await client.query("update organization set archived_at=null where id=$1", [f.organizations.team]);
        await client.query("update scene set name=$2,state=$3 where id=$1", [id, original.name, original.state]);
      }
    });

    await check("R10 super-admin clean-rows derives a collection's files from its placements, not from grants", async () => {
      const placed = expect(await call(routes.collectionPlacements.POST, { user: u.unassigned, method: "POST", url: `/api/collections/${f.workspaces.empty}/placements`, params: { id: f.workspaces.empty },
        body: { target: { kind: "asset", assetId: f.assets.restricted }, location: { longitude: 121.5, latitude: 31.2 } } }), 201).data;
      const viaRevision = expect(await call(routes.collectionPlacements.POST, { user: u.unassigned, method: "POST", url: `/api/collections/${f.workspaces.empty}/placements`, params: { id: f.workspaces.empty },
        body: { target: { kind: "scene", sceneId: f.scenes.a }, location: { longitude: 121.5, latitude: 31.2 } } }), 201).data;
      assert.ok(placed.placement.id && viaRevision.placement.id);
      expect(await call(routes.adminClean.POST, { user: u.owner, method: "POST", url: "/api/admin/clean", body: { action: "clean-rows", workspaceId: f.workspaces.empty } }), 403);
      await client.query("update users set role='super_admin' where user_id=$1", [u.owner]);
      try {
        const report = expect(await call(routes.adminClean.POST, { user: u.owner, method: "POST", url: "/api/admin/clean", body: { action: "clean-rows", workspaceId: f.workspaces.empty } }), 200).data;
        assert.ok(report.orphanedRows.some((row: Body) => row.file_url === f.keys.restricted), "a directly pinned version's missing file is reported for its collection");
        assert.ok(report.orphanedRows.some((row: Body) => row.file_url === f.keys.current), "versions pinned through a placed scene revision are included");
        assert.deepEqual(report.errors, []);
      } finally { await client.query("update users set role='user' where user_id=$1", [u.owner]); }
    });

    await check("R11 super-admin creates teams with zero collections; deletion refuses retained team content", async () => {
      const created: string[] = [];
      expect(await call(routes.organizations.POST, { user: u.owner, method: "POST", url: "/api/organizations", body: { name: "not allowed" } }), 403);
      await client.query("update users set role='super_admin' where user_id=$1", [u.owner]);
      try {
        const make = async (name: string) => {
          const org = expect(await call(routes.organizations.POST, { user: u.owner, method: "POST", url: "/api/organizations", body: { name: `${name} ${f.run}` } }), 201).data;
          created.push(org.id);
          return org;
        };
        const busy = await make("route team with content");
        const params = { id: busy.id };
        assert.deepEqual(expect(await call(routes.orgCollections.GET, { user: u.owner, url: `/api/organizations/${busy.id}/collections?state=all`, params }), 200).data, []);
        expect(await call(routes.orgAssets.POST, { user: u.owner, method: "POST", url: `/api/organizations/${busy.id}/assets`, params, body: modelBody("new-team-asset") }), 201);
        const sceneOnly = await make("route team with one scene");
        expect(await call(routes.orgScenes.POST, { user: u.owner, method: "POST", url: `/api/organizations/${sceneOnly.id}/scenes`, params: { id: sceneOnly.id }, body: { name: "empty scene" } }), 201);
        const empty = await make("route empty team");
        assert.equal(Number((await client.query("select count(*) n from workspace where organization_id=any($1::uuid[])", [created])).rows[0].n), 0, "no collection is created for new teams");
        const del = (id: string) => call(routes.organization.DELETE, { user: u.owner, method: "DELETE", url: `/api/organizations/${id}`, params: { id } });
        const refused = expect(await del(busy.id), 409, "DEPENDENCY_CONFLICT");
        assert.equal(refused.details.counts.assets, 1);
        assert.equal(expect(await del(sceneOnly.id), 409, "DEPENDENCY_CONFLICT").details.counts.scenes, 1, "a zero-collection team with only a scene is not deletable");
        assert.equal(Number((await client.query("select count(*) n from scene where organization_id=$1", [sceneOnly.id])).rows[0].n), 1, "nothing was cascaded");
        expect(await del(empty.id), 200);
        expect(await del(empty.id), 404);
        expect(await del("not-a-uuid"), 404);
      } finally {
        await client.query("update users set role='user' where user_id=$1", [u.owner]);
        if (created.length) await client.query("select purge_organizations($1::uuid[])", [created]);
      }
    });

    await check("R09 invitations join the team without writing a workspace assignment", async () => {
      const token = `route-${f.run}`;
      await client.query("insert into organization_invitation(organization_id,workspace_id,token,role,created_by) values($1,$2,$3,'member',$4)", [f.organizations.team, f.workspaces.a, token, u.owner]);
      const accepted = expect(await call(routes.invitation.POST, { user: u.foreign, method: "POST", url: `/api/invitations/${token}`, params: { token } }), 200).data;
      assert.equal(accepted.workspace_id, f.workspaces.a, "the collection is still returned for navigation");
      const membership = await db.selectFrom("organization_member").select("role").where("organization_id", "=", f.organizations.team).where("user_id", "=", u.foreign).executeTakeFirst();
      assert.equal(membership?.role, "member");
      const detail = expect(await call(routes.asset.GET, { user: u.foreign, url: `/api/assets/${f.assets.restricted}`, params: { id: f.assets.restricted } }), 200).data;
      assert.equal(detail.id, f.assets.restricted, "a new member reads the whole team catalog at once");
    });
  } finally {
    try {
      await client.query("delete from error_log where user_id=any($1::uuid[]) or (path='/api/admin/clean' and created_at>=$2)", [Object.values(f.users), startedAt]);
      await cleanupServicesFixture(client, f);
    } finally {
      auth.setStubSessionUser(null);
      await Promise.all([client.end(), db.destroy()]);
    }
  }
  console.log(`${passed} route groups passed; ${failures.length} failed`);
  assert.ok(passed + failures.length > 0, "No test matched the requested filter");
  if (failures.length) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[database URL redacted]") : "Route regression failed");
  process.exitCode = 1;
});

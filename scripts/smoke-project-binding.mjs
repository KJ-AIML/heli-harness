#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProjectBinding, resolveProjectBinding, validateHeliLock, validateWorkspaceManifest, writeProjectBinding } from "../lib/project-binding.mjs";

const manifest = {
  schemaVersion: 1,
  workspaceId: "project-demo",
  resources: { source: "src", state: ".heli-harness" },
  policyProfile: "default",
};
const lock = { schemaVersion: 1, pins: { heli: "0.9.0", adapter: "sha256:demo" } };

{
  const root = mkdtempSync(join(tmpdir(), "heli-project-binding-"));
  try {
    const resolved = resolveProjectBinding(root, manifest, lock);
    assert.equal(resolved.workspace.workspaceId, "project-demo");
    assert.equal(resolved.authority, null, "project binding must never synthesize live authority");
    assert.equal(resolved.resources.source, join(root, "src"));
    assert.equal(resolved.resources.state, join(root, ".heli-harness"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

assert.throws(
  () => validateWorkspaceManifest({ ...manifest, leases: {} }),
  (error) => error.code === "MUTABLE_AUTHORITY_IN_PROJECT_BINDING",
);
assert.throws(
  () => validateWorkspaceManifest({ ...manifest, resources: { source: "../escape" } }),
  (error) => error.code === "PROJECT_RESOURCE_ESCAPE",
);
assert.throws(
  () => validateHeliLock({ ...lock, grants: [] }),
  (error) => error.code === "MUTABLE_AUTHORITY_IN_HELI_LOCK",
);
assert.throws(
  () => validateHeliLock({ schemaVersion: 1, pins: {} }),
  (error) => error.code === "EMPTY_HELI_LOCK",
);

{
  const root = mkdtempSync(join(tmpdir(), "heli-project-binding-read-"));
  try {
    mkdirSync(join(root, ".heli"), { recursive: true });
    writeFileSync(join(root, ".heli", "workspace.json"), JSON.stringify(manifest));
    writeFileSync(join(root, ".heli", "heli.lock"), JSON.stringify(lock));
    const resolved = readProjectBinding(root);
    assert.equal(resolved.workspace.workspaceId, manifest.workspaceId);
    assert.equal(resolved.authority, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = mkdtempSync(join(tmpdir(), "heli-project-binding-write-"));
  try {
    const resolved = writeProjectBinding(root, manifest, lock);
    assert.equal(resolved.authority, null, "writer must not synthesize live authority");
    assert.deepEqual(JSON.parse(readFileSync(join(root, ".heli", "workspace.json"), "utf8")), validateWorkspaceManifest(manifest));
    assert.deepEqual(JSON.parse(readFileSync(join(root, ".heli", "heli.lock"), "utf8")), validateHeliLock(lock));
    assert.throws(
      () => writeProjectBinding(root, manifest, lock),
      (error) => error.code === "PROJECT_BINDING_EXISTS",
      "writer must refuse accidental replacement by default",
    );
    assert.throws(
      () => writeProjectBinding(root, { ...manifest, grants: [] }, lock, { overwrite: true }),
      (error) => error.code === "MUTABLE_AUTHORITY_IN_PROJECT_BINDING",
      "overwrite must validate before mutating an existing binding",
    );
    assert.equal(existsSync(join(root, ".heli", "workspace.json")), true);
    assert.deepEqual(JSON.parse(readFileSync(join(root, ".heli", "workspace.json"), "utf8")), validateWorkspaceManifest(manifest));
    const overwritten = writeProjectBinding(root, { ...manifest, policyProfile: "strict" }, lock, { overwrite: true });
    assert.equal(overwritten.workspace.policyProfile, "strict");
    assert.equal(overwritten.authority, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log("smoke-project-binding: passed");

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { verifyIntegrity } from "../scripts/fetch-upstream.mjs";
import { patchBundle, replaceExactlyOnce } from "../scripts/patch.mjs";

test("a changed archive is refused even if the pin is still syntactically valid", () => {
  const bytes = Buffer.from("upstream fixture");
  const integrity = "sha512-" + createHash("sha512").update(bytes).digest("base64");
  assert.doesNotThrow(() => verifyIntegrity(bytes, integrity));
  assert.throws(() => verifyIntegrity(Buffer.from("modified"), integrity), /integrity mismatch/);
  assert.throws(() => verifyIntegrity(bytes, "sha1-not-enough"), /SHA-512/);
});

test("missing or repeated anchors fail instead of silently patching a different bundle", () => {
  assert.throws(() => replaceExactlyOnce("new upstream", "old", "patched", "test"), /found 0/);
  assert.throws(() => replaceExactlyOnce("old old", "old", "patched", "test"), /found 2/);
});

test("replacement text is literal, and rerunning a patch cannot duplicate its edits", () => {
  const patch = {
    file: "fixture.js", imports: "// terminal import",
    changes: [{ label: "test", before: "old", after: "$&" }],
  };
  const result = patchBundle("const value = 'old';", patch);
  assert.ok(result.includes("const value = '$&';"));
  assert.throws(() => patchBundle(result, patch), /found 0/);
});

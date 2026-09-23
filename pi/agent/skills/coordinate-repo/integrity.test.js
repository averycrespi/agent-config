import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  symlink,
  rm,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as index from "./scripts/index.js";

const values = {
  "Owner and authority":
    "owner; /authority#1\nScope: preserve this second line",
  Assignments:
    "| ID | Worker |\n| --- | --- |\n| a | /checkpoint-a |\n| b | /checkpoint-b |",
  Mailbox: '{\n  "address": "example",\n  "reports": {}\n}',
  Observation: 'receipt /session#1\n\nMore evidence\n```json\n{"used": 1}\n```',
  Next: "owner: continue",
};
async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), "index-integrity-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  execFileSync("git", ["-C", cwd, "init", "-q"]);
  return cwd;
}
function cli(path, request) {
  const result = spawnSync(process.execPath, [path], {
    input: JSON.stringify(request),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.notEqual(
    result.stdout.trim(),
    "",
    "successful CLI must not silently skip execution",
  );
  return JSON.parse(result.stdout).result;
}
test("real and installed-style symlink CLI entry points execute", async (t) => {
  const cwd = await fixture(t);
  const installed = join(cwd, ".pi", "agent", "skills");
  await mkdir(installed, { recursive: true });
  await symlink(
    fileURLToPath(new URL(".", import.meta.url)),
    join(installed, "coordinate-repo"),
  );
  for (const root of [
    fileURLToPath(new URL(".", import.meta.url)),
    join(installed, "coordinate-repo"),
  ]) {
    const saved = cli(join(root, "scripts/index.js"), {
      action: "replace",
      attemptId: "cli-replace",
      cwd,
      id: "example",
      expected: (await index.readIndex(cwd, "example")).digest,
      values,
    });
    assert.equal(
      saved.digest,
      index.digest(await readFile(saved.path, "utf8")),
    );
    assert.equal(
      cli(join(root, "scripts/index.js"), {
        action: "status",
        cwd,
        id: "example",
      }).text,
      index.renderIndex("example", values),
    );
    assert.equal(saved.confirmed, true);
    const confirmed = cli(join(root, "scripts/index.js"), {
      action: "confirm",
      attemptId: "cli-replace",
      cwd,
      id: "example",
      expected: saved.expected,
      values,
      response: JSON.stringify({ result: saved }),
    });
    assert.equal(confirmed.digest, saved.digest);
    assert.equal(
      cli(join(root, "scripts/index.js"), {
        action: "update",
        attemptId: "cli-update",
        cwd,
        id: "example",
        expected: saved.digest,
        changes: {},
      }).written,
      false,
    );
    assert.deepEqual(
      cli(join(root, "scripts/supervision.js"), {
        action: "init",
        deadline: 1000000,
        maxAttempts: 4,
      }),
      { deadline: 1000000, maxAttempts: 4, used: 0, groups: {} },
    );
  }
});

test("canonical parse/update preserves complete multiline facts and omitted sections", async (t) => {
  const cwd = await fixture(t);
  const rich = {
    ...values,
    Decisions:
      "    indented first line\n\n### Rationale\n\nKeep trailing space  ",
  };
  const text = index.renderIndex("example", rich);
  assert.deepEqual(index.parseIndex(text, "example"), {
    id: "example",
    values: rich,
  });
  assert.equal(
    index.renderIndex("example", index.parseIndex(text).values),
    text,
  );
  const first = await index.persistIndex({
    attemptId: "create-rich",
    cwd,
    id: "example",
    expected: null,
    values: rich,
  });
  const updated = await index.updateIndex({
    attemptId: "update-next",
    cwd,
    id: "example",
    expected: first.digest,
    changes: { Next: "owner: inspect result" },
  });
  const saved = await index.readIndex(cwd, "example");
  assert.deepEqual(saved.values, { ...rich, Next: "owner: inspect result" });
  assert.equal(updated.confirmed, true);
  assert.equal(
    (
      await index.updateIndex({
        cwd,
        id: "example",
        expected: updated.digest,
        attemptId: "no-op",
        changes: {},
      })
    ).written,
    false,
  );
  await assert.rejects(
    index.updateIndex({
      cwd,
      id: "example",
      expected: first.digest,
      attemptId: "stale-base",
      changes: { Next: "stale" },
    }),
    /changed/,
  );
  await assert.rejects(
    index.updateIndex({
      cwd,
      id: "example",
      expected: updated.digest,
      attemptId: "invalid-deletion",
      changes: { Next: null },
    }),
    /invalid/,
  );
  await assert.rejects(
    index.updateIndex({
      cwd,
      id: "example",
      expected: updated.digest,
      attemptId: "invalid-empty",
      changes: { Assignments: "" },
    }),
    /explicit null/,
  );
  assert.equal((await index.readIndex(cwd, "example")).digest, updated.digest);
  await index.updateIndex({
    cwd,
    id: "example",
    expected: updated.digest,
    attemptId: "delete-decisions",
    changes: { Decisions: null },
  });
  assert.equal(
    Object.hasOwn((await index.readIndex(cwd, "example")).values, "Decisions"),
    false,
  );
  // The former caller regex used multiline `$` and silently retained first lines only.
  const broken = Object.fromEntries(
    [...text.matchAll(/^## (.+)\n\n([\s\S]*?)(?=\n## |$)/gm)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  assert.notEqual(broken.Assignments, rich.Assignments);
  assert.equal(index.parseIndex(text).values.Assignments, rich.Assignments);
});

test("malformed/duplicate/unknown/conflicting structures reject without mutation", async (t) => {
  const cwd = await fixture(t);
  const text = index.renderIndex("example", values);
  const initial = await index.persistIndex({
    attemptId: "create",
    cwd,
    id: "example",
    expected: null,
    values,
  });
  const malformed = [
    text.replace("## Assignments", "## Unknown"),
    text.replace("## Assignments", "## Owner and authority"),
    text.replace("## Assignments", "# Assignments"),
    text.replace("# Coordination example", "# Coordination another"),
    text.replace("## Mailbox\n\n", "## Mailbox\n"),
    text.replace("## Next\n\nowner: continue", "## Next\n\n"),
    text
      .replace("## Assignments", "unsectioned facts\n\n## Assignments")
      .replace("## Owner and authority", "## Next"),
    text + "\n## Decisions\n\nout of order\n",
  ];
  for (const bad of malformed) {
    assert.throws(() => index.parseIndex(bad, "example"));
    await writeFile(initial.path, bad);
    await assert.rejects(index.readIndex(cwd, "example"));
    await assert.rejects(
      index.updateIndex({
        cwd,
        id: "example",
        expected: index.digest(bad),
        attemptId: "overwrite",
        changes: { Next: "overwrite" },
      }),
    );
    await assert.rejects(
      index.replaceIndex({
        cwd,
        id: "example",
        expected: index.digest(bad),
        values,
      }),
    );
    assert.equal(await readFile(initial.path, "utf8"), bad);
  }
});

test("consequential effects require receipt identity, intended bytes and fresh readback", async (t) => {
  const cwd = await fixture(t);
  const request = {
    cwd,
    id: "example",
    expected: null,
    values,
    attemptId: "original",
  };
  const path = join(cwd, ".git", "pi-repo-coordination", "example.md");
  const fabricated = {
    attemptId: "original",
    id: "example",
    expected: null,
    path,
    digest: index.digest(index.renderIndex("example", values)),
    written: true,
  };
  for (const source of [
    "",
    "process.stdout.write('not JSON')",
    `process.stdout.write(${JSON.stringify(JSON.stringify({ result: fabricated }))})`,
  ]) {
    const noWrite = spawnSync(process.execPath, ["-e", source], {
      encoding: "utf8",
    });
    assert.equal(noWrite.status, 0);
    await assert.rejects(
      index.confirmIndexResponse(request, noWrite.stdout),
      /response|readback/,
    );
  }
  let effects = 0;
  const effect = async (receipt) => {
    await index.confirmIndex(request, receipt);
    effects++;
  };
  // Even a syntactically perfect success response without a write is insufficient.
  await assert.rejects(effect(fabricated), /readback/);
  const receipt = await index.replaceIndex(request);
  for (const invalid of [
    undefined,
    null,
    "",
    {},
    { confirmed: true },
    { ...receipt, id: "other" },
    { ...receipt, attemptId: "old-attempt" },
    { ...receipt, expected: "0".repeat(64) },
    { ...receipt, path: path + ".other" },
    { ...receipt, digest: "0".repeat(64) },
    { ...receipt, written: "true" },
  ])
    await assert.rejects(effect(invalid), /receipt/);
  assert.equal(effects, 0);
  await effect(receipt);
  assert.equal(
    (
      await index.confirmIndexResponse(
        request,
        JSON.stringify({ result: receipt }),
      )
    ).confirmed,
    true,
  );
  for (const response of [
    "null",
    "{}",
    '{"result":null}',
    JSON.stringify({ result: receipt, error: "uncertain" }),
  ])
    await assert.rejects(
      index.confirmIndexResponse(request, response),
      /response/,
    );
  assert.equal(effects, 1);
  // The bytes have not changed: an earlier attempt's receipt still cannot
  // qualify the caller's independently retained next attempt.
  await assert.rejects(
    index.confirmIndexResponse(
      { ...request, attemptId: "next-attempt" },
      JSON.stringify({ result: receipt }),
    ),
    /receipt/,
  );
  await assert.rejects(
    index.persistIndex({ ...request, attemptId: undefined }),
    /attempt/,
  );
  assert.equal((await index.readIndex(cwd, "example")).digest, receipt.digest);
  await index.persistIndex({
    ...request,
    attemptId: "new-intent",
    expected: receipt.digest,
    values: { ...values, Next: "newer intent" },
  });
  await assert.rejects(effect(receipt), /readback/);
  assert.equal(effects, 1);
});

test("managed callers discover canonical persistence gates and readable references", async () => {
  for (const path of [
    "./SKILL.md",
    "./references/index.md",
    "./references/supervision.md",
    "../spin-out/references/launch.md",
    "../spin-out/references/decisions.md",
  ]) {
    const url = new URL(path, import.meta.url);
    const text = await readFile(url, "utf8");
    assert.match(text, /canonical/i);
    assert.match(text, /read\s?back/i);
    assert.match(text, /exit zero/i);
    for (const match of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      if (!match[1].includes(":")) await readFile(new URL(match[1], url));
    }
  }
  const skill = await readFile(new URL("./SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /^---\nname: coordinate-repo\ndescription: Use when/m);
  const docs = await readFile(
    new URL("./references/index.md", import.meta.url),
    "utf8",
  );
  for (const name of [
    "parseIndex",
    "readIndex",
    "updateIndex",
    "persistIndex",
    "confirmIndexResponse",
  ])
    assert.equal(
      typeof index[name],
      "function",
      `${name} example must match actual API`,
    );
  assert.match(docs, /never replay a possibly successful write automatically/);
  assert.match(docs, /not a cross-process lock or hard fence/);
});

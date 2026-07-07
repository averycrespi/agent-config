import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgents } from "./loader.ts";

async function withAgentDir<T>(
  setup: (agentsDir: string) => Promise<void>,
  fn: () => T,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "subagents-loader-test-"));
  const agentsDir = join(root, "agents");
  await mkdir(agentsDir, { recursive: true });
  await setup(agentsDir);
  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
    await rm(root, { recursive: true, force: true });
  }
}

test("loadAgents: empty agents dir returns []", async () => {
  await withAgentDir(
    async () => {},
    () => {
      assert.deepEqual(loadAgents(), []);
    },
  );
});

test("loadAgents: missing agents dir returns []", async () => {
  const root = await mkdtemp(join(tmpdir(), "subagents-loader-missing-"));
  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  try {
    assert.deepEqual(loadAgents(), []);
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
    await rm(root, { recursive: true, force: true });
  }
});

test("loadAgents: parses a full frontmatter + body", async () => {
  await withAgentDir(
    async (dir) => {
      await writeFile(
        join(dir, "explorer.md"),
        `---
name: explorer
description: Read-only research
tools: read, bash
extensions: web, other
model: openai/gpt-5
thinking: high
disable_skills: true
disable_prompt_templates: true
---

You are a research agent.`,
      );
    },
    () => {
      const agents = loadAgents();
      assert.equal(agents.length, 1);
      const a = agents[0];
      assert.equal(a.name, "explorer");
      assert.equal(a.description, "Read-only research");
      assert.deepEqual(a.tools, ["read", "bash"]);
      assert.deepEqual(a.extensions, ["web", "other"]);
      assert.equal(a.model, "openai/gpt-5");
      assert.equal(a.thinking, "high");
      assert.equal(a.disableSkills, true);
      assert.equal(a.disablePromptTemplates, true);
      assert.equal(a.systemPrompt, "You are a research agent.");
    },
  );
});

test("loadAgents: name defaults to filename without extension", async () => {
  await withAgentDir(
    async (dir) => {
      await writeFile(
        join(dir, "reviewer.md"),
        `---
description: some reviewer
---

body`,
      );
    },
    () => {
      const agents = loadAgents();
      assert.equal(agents.length, 1);
      assert.equal(agents[0].name, "reviewer");
      assert.equal(agents[0].description, "some reviewer");
    },
  );
});

test("loadAgents: description defaults to name when missing", async () => {
  await withAgentDir(
    async (dir) => {
      await writeFile(join(dir, "foo.md"), `---\n---\n\nbody`);
    },
    () => {
      const agents = loadAgents();
      assert.equal(agents.length, 1);
      assert.equal(agents[0].name, "foo");
      assert.equal(agents[0].description, "foo");
    },
  );
});

test("loadAgents: booleans default to false, empty lists are []", async () => {
  await withAgentDir(
    async (dir) => {
      await writeFile(join(dir, "minimal.md"), `---\n---\n\nbody`);
    },
    () => {
      const a = loadAgents()[0];
      assert.deepEqual(a.tools, []);
      assert.deepEqual(a.extensions, []);
      assert.equal(a.model, undefined);
      assert.equal(a.thinking, undefined);
      assert.equal(a.disableSkills, false);
      assert.equal(a.disablePromptTemplates, false);
    },
  );
});

test("loadAgents: skips files with empty body", async () => {
  await withAgentDir(
    async (dir) => {
      await writeFile(
        join(dir, "empty.md"),
        `---
name: empty
---

`,
      );
      await writeFile(
        join(dir, "good.md"),
        `---
name: good
---

body`,
      );
    },
    () => {
      const agents = loadAgents();
      assert.equal(agents.length, 1);
      assert.equal(agents[0].name, "good");
    },
  );
});

test("loadAgents: ignores non-.md files", async () => {
  await withAgentDir(
    async (dir) => {
      await writeFile(join(dir, "a.txt"), "not an agent");
      await writeFile(join(dir, "b.md"), `---\nname: b\n---\n\nbody`);
    },
    () => {
      const agents = loadAgents();
      assert.equal(agents.length, 1);
      assert.equal(agents[0].name, "b");
    },
  );
});

test("loadAgents: returns agents sorted by filename", async () => {
  await withAgentDir(
    async (dir) => {
      await writeFile(join(dir, "c.md"), `---\nname: c\n---\n\nbody`);
      await writeFile(join(dir, "a.md"), `---\nname: a\n---\n\nbody`);
      await writeFile(join(dir, "b.md"), `---\nname: b\n---\n\nbody`);
    },
    () => {
      const names = loadAgents().map((a) => a.name);
      assert.deepEqual(names, ["a", "b", "c"]);
    },
  );
});

test("loadAgents: missing frontmatter falls back to full content as body", async () => {
  await withAgentDir(
    async (dir) => {
      await writeFile(join(dir, "bare.md"), "just a raw body");
    },
    () => {
      const a = loadAgents()[0];
      assert.equal(a.name, "bare");
      assert.equal(a.systemPrompt, "just a raw body");
    },
  );
});

test("loadAgents: env is undefined when no env block present", async () => {
  await withAgentDir(
    async (dir) => {
      await writeFile(join(dir, "noenv.md"), `---\nname: noenv\n---\n\nbody`);
    },
    () => {
      const a = loadAgents()[0];
      assert.equal(a.env, undefined);
    },
  );
});

test("loadAgents: parses a single env key", async () => {
  await withAgentDir(
    async (dir) => {
      await writeFile(
        join(dir, "onekey.md"),
        `---
name: onekey
env:
  MCP_BROKER_READONLY: "1"
---

body`,
      );
    },
    () => {
      const a = loadAgents()[0];
      assert.deepEqual(a.env, { MCP_BROKER_READONLY: "1" });
    },
  );
});

test("loadAgents: parses multiple env keys", async () => {
  await withAgentDir(
    async (dir) => {
      await writeFile(
        join(dir, "multienv.md"),
        `---
name: multienv
env:
  FIRST: alpha
  SECOND: beta
---

body`,
      );
    },
    () => {
      const a = loadAgents()[0];
      assert.deepEqual(a.env, { FIRST: "alpha", SECOND: "beta" });
    },
  );
});

test("loadAgents: strips double and single quotes from env values", async () => {
  await withAgentDir(
    async (dir) => {
      await writeFile(
        join(dir, "quotedenv.md"),
        `---
name: quotedenv
env:
  DOUBLE: "value with spaces"
  SINGLE: 'another value'
  UNQUOTED: plain
---

body`,
      );
    },
    () => {
      const a = loadAgents()[0];
      assert.deepEqual(a.env, {
        DOUBLE: "value with spaces",
        SINGLE: "another value",
        UNQUOTED: "plain",
      });
    },
  );
});

test("loadAgents: malformed env lines (no colon) are skipped silently", async () => {
  await withAgentDir(
    async (dir) => {
      await writeFile(
        join(dir, "malformed.md"),
        `---
name: malformed
env:
  GOOD: ok
  BADLINE
  ALSO_GOOD: yes
---

body`,
      );
    },
    () => {
      const a = loadAgents()[0];
      assert.deepEqual(a.env, { GOOD: "ok", ALSO_GOOD: "yes" });
    },
  );
});

test("loadAgents: trims whitespace in list values", async () => {
  await withAgentDir(
    async (dir) => {
      await writeFile(
        join(dir, "spaced.md"),
        `---
name: spaced
tools:  read ,  bash  ,
extensions: , foo ,, bar ,
---

body`,
      );
    },
    () => {
      const a = loadAgents()[0];
      assert.deepEqual(a.tools, ["read", "bash"]);
      assert.deepEqual(a.extensions, ["foo", "bar"]);
    },
  );
});

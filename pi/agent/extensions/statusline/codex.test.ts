import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { codexAdapter, parseWindow } from "./codex.ts";

test("codexAdapter.handles matches the openai-codex provider id only", () => {
  assert.equal(codexAdapter.handles("openai-codex"), true);
  assert.equal(codexAdapter.handles("openai"), false);
  assert.equal(codexAdapter.handles("anthropic"), false);
  assert.equal(codexAdapter.handles(""), false);
});

test("codexAdapter has a human-readable label", () => {
  assert.equal(codexAdapter.label, "Codex");
});

test("parseWindow returns undefined for falsy input", () => {
  assert.equal(parseWindow(undefined), undefined);
  assert.equal(parseWindow(null), undefined);
  assert.equal(parseWindow(0), undefined);
});

test("parseWindow maps snake_case fields to WindowStats shape", () => {
  assert.deepEqual(
    parseWindow({ used_percent: 42, reset_after_seconds: 3600 }),
    { usedPercent: 42, resetAfterSeconds: 3600 },
  );
});

test("parseWindow passes through missing subfields as undefined", () => {
  assert.deepEqual(parseWindow({}), {
    usedPercent: undefined,
    resetAfterSeconds: undefined,
  });
  assert.deepEqual(parseWindow({ used_percent: 10 }), {
    usedPercent: 10,
    resetAfterSeconds: undefined,
  });
});

test("codexAdapter uses the main quota rather than an additional codex limit", async () => {
  const fetchStub = mock.method(globalThis, "fetch", async () =>
    Response.json({
      rate_limit: {
        limit_reached: false,
        primary_window: { used_percent: 24, reset_after_seconds: 7200 },
        secondary_window: { used_percent: 38, reset_after_seconds: 338400 },
      },
      additional_rate_limits: [
        {
          metered_feature: "codex",
          rate_limit: {
            limit_reached: true,
            primary_window: { used_percent: 100, reset_after_seconds: 338400 },
          },
        },
      ],
    }),
  );
  try {
    assert.deepEqual(await codexAdapter.fetchUsage("token"), {
      primary: { usedPercent: 24, resetAfterSeconds: 7200 },
      secondary: { usedPercent: 38, resetAfterSeconds: 338400 },
      limitReached: false,
      balance: undefined,
    });
  } finally {
    fetchStub.mock.restore();
  }
});

test("codexAdapter does not substitute additional quotas when the main quota is absent", async () => {
  const fetchStub = mock.method(globalThis, "fetch", async () =>
    Response.json({
      rate_limit: null,
      additional_rate_limits: [
        {
          metered_feature: "codex",
          rate_limit: {
            limit_reached: true,
            primary_window: { used_percent: 100 },
          },
        },
      ],
    }),
  );
  try {
    assert.deepEqual(await codexAdapter.fetchUsage("token"), {
      primary: undefined,
      secondary: undefined,
      limitReached: false,
      balance: undefined,
    });
  } finally {
    fetchStub.mock.restore();
  }
});

test("codexAdapter only accepts a boolean true limit flag", async () => {
  const fetchStub = mock.method(globalThis, "fetch", async () =>
    Response.json({ rate_limit: { limit_reached: "false" } }),
  );
  try {
    assert.equal((await codexAdapter.fetchUsage("token"))?.limitReached, false);
  } finally {
    fetchStub.mock.restore();
  }
});

test("codexAdapter.fetchUsage forwards registry auth headers", async () => {
  const fetchStub = mock.method(
    globalThis,
    "fetch",
    async (_url: string | URL | Request, init?: RequestInit) =>
      ({
        ok: true,
        async json() {
          return { rate_limit: {} };
        },
        _headers: init?.headers,
      }) as unknown as Response,
  );

  try {
    await codexAdapter.fetchUsage("token", { "X-Account": "abc" });
  } finally {
    fetchStub.mock.restore();
  }

  assert.equal(fetchStub.mock.callCount(), 1);
  assert.deepEqual(fetchStub.mock.calls[0].arguments[1]?.headers, {
    "X-Account": "abc",
    Authorization: "Bearer token",
  });
});

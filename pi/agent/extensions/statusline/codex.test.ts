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

function tokenWithClaims(claims: unknown): string {
  return `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
}

test("codexAdapter supplies the OAuth account header when registry headers omit it", async () => {
  const token = tokenWithClaims({
    "https://api.openai.com/auth": { chatgpt_account_id: "example-account" },
  });
  const fetchStub = mock.method(globalThis, "fetch", async () =>
    Response.json({
      rate_limit: {
        primary_window: { used_percent: 91 },
        limit_reached: false,
      },
    }),
  );
  try {
    const stats = await codexAdapter.fetchUsage(token, {
      "X-Extra": "example",
    });
    const sent = new Headers(fetchStub.mock.calls[0].arguments[1]?.headers);
    assert.equal(sent.get("chatgpt-account-id"), "example-account");
    assert.equal(sent.get("authorization"), `Bearer ${token}`);
    assert.equal(sent.get("x-extra"), "example");
    assert.equal(stats?.primary?.usedPercent, 91);
    assert.equal(stats?.limitReached, false);
  } finally {
    fetchStub.mock.restore();
  }
});

test("codexAdapter preserves explicit account selection regardless of header casing", async () => {
  const token = tokenWithClaims({
    "https://api.openai.com/auth": { chatgpt_account_id: "token-account" },
  });
  const fetchStub = mock.method(globalThis, "fetch", async () =>
    Response.json({ rate_limit: {} }),
  );
  try {
    for (const name of ["ChatGPT-Account-Id", "chatgpt-account-id"]) {
      await codexAdapter.fetchUsage(token, { [name]: "selected-account" });
      const sent = new Headers(
        fetchStub.mock.calls.at(-1)!.arguments[1]?.headers,
      );
      assert.equal(sent.get("chatgpt-account-id"), "selected-account");
    }
  } finally {
    fetchStub.mock.restore();
  }
});

test("codexAdapter safely handles missing or malformed OAuth account claims", async () => {
  const fetchStub = mock.method(globalThis, "fetch", async () =>
    Response.json({ rate_limit: {} }),
  );
  try {
    for (const token of [
      "token",
      "header.not-json.signature",
      tokenWithClaims(null),
      tokenWithClaims({}),
      tokenWithClaims({
        "https://api.openai.com/auth": { chatgpt_account_id: 42 },
      }),
      tokenWithClaims({
        "https://api.openai.com/auth": {
          chatgpt_account_id: "invalid\r\nheader",
        },
      }),
    ]) {
      await codexAdapter.fetchUsage(token);
      const sent = new Headers(
        fetchStub.mock.calls.at(-1)!.arguments[1]?.headers,
      );
      assert.equal(sent.has("chatgpt-account-id"), false);
    }
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
  const sent = new Headers(fetchStub.mock.calls[0].arguments[1]?.headers);
  assert.equal(sent.get("X-Account"), "abc");
  assert.equal(sent.get("Authorization"), "Bearer token");
});

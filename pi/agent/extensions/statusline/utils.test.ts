import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFooterText,
  formatDuration,
  type ProviderAdapter,
} from "./utils.ts";

const ADAPTER: ProviderAdapter = {
  label: "Codex",
  handles: () => true,
  async fetchUsage() {
    return null;
  },
};

test("formatDuration uses seconds below a minute", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(45), "45s");
  assert.equal(formatDuration(59), "59s");
});

test("formatDuration rounds to minutes between 1m and 1h", () => {
  assert.equal(formatDuration(60), "1m");
  assert.equal(formatDuration(89), "1m");
  assert.equal(formatDuration(90), "2m");
  assert.equal(formatDuration(3599), "60m");
});

test("formatDuration shows hours with minute remainder", () => {
  assert.equal(formatDuration(3600), "1h");
  assert.equal(formatDuration(3600 + 30 * 60), "1h30m");
  assert.equal(formatDuration(2 * 3600), "2h");
});

test("formatDuration shows days with hour remainder", () => {
  assert.equal(formatDuration(24 * 3600), "1d");
  assert.equal(formatDuration(25 * 3600), "1d 1h");
  assert.equal(formatDuration(3 * 24 * 3600 + 5 * 3600), "3d 5h");
});

test("buildFooterText formats credit balance", () => {
  assert.equal(buildFooterText(ADAPTER, { balance: "4.20" }), "Codex: $4.20");
});

test("buildFooterText appends reset time to balance", () => {
  assert.equal(
    buildFooterText(ADAPTER, {
      balance: "4.20",
      primary: { resetAfterSeconds: 3600 },
    }),
    "Codex: $4.20 · resets in 1h",
  );
});

test("buildFooterText shows 'limit reached'", () => {
  assert.equal(
    buildFooterText(ADAPTER, { limitReached: true }),
    "Codex: limit reached",
  );
});

test("buildFooterText appends reset time when limit reached", () => {
  assert.equal(
    buildFooterText(ADAPTER, {
      limitReached: true,
      primary: { resetAfterSeconds: 120 },
    }),
    "Codex: limit reached · resets in 2m",
  );
});

test("buildFooterText keeps percentages alongside a reported limit", () => {
  assert.equal(
    buildFooterText(ADAPTER, {
      limitReached: true,
      primary: { usedPercent: 24, resetAfterSeconds: 120 },
      secondary: { usedPercent: 38 },
    }),
    "Codex: 24% (38%) · limit reached · resets in 2m",
  );
});

test("buildFooterText returns just the adapter label when no percentages are known", () => {
  assert.equal(buildFooterText(ADAPTER, {}), "Codex");
  assert.equal(
    buildFooterText(ADAPTER, { primary: {}, secondary: {} }),
    "Codex",
  );
});

test("buildFooterText renders primary-only percent", () => {
  assert.equal(
    buildFooterText(ADAPTER, { primary: { usedPercent: 42 } }),
    "Codex: 42%",
  );
});

test("buildFooterText renders secondary-only percent", () => {
  assert.equal(
    buildFooterText(ADAPTER, { secondary: { usedPercent: 7 } }),
    "Codex: 7%",
  );
});

test("buildFooterText renders primary and secondary together", () => {
  assert.equal(
    buildFooterText(ADAPTER, {
      primary: { usedPercent: 42 },
      secondary: { usedPercent: 7 },
    }),
    "Codex: 42% (7%)",
  );
});

test("buildFooterText includes both reset times when both windows have them", () => {
  assert.equal(
    buildFooterText(ADAPTER, {
      primary: { usedPercent: 10, resetAfterSeconds: 120 },
      secondary: { usedPercent: 20, resetAfterSeconds: 24 * 3600 },
    }),
    "Codex: 10% (20%) · resets in 2m (1d)",
  );
});

test("buildFooterText includes only primary reset when only primary has one", () => {
  assert.equal(
    buildFooterText(ADAPTER, {
      primary: { usedPercent: 10, resetAfterSeconds: 120 },
      secondary: { usedPercent: 20 },
    }),
    "Codex: 10% (20%) · resets in 2m",
  );
});

test("buildFooterText includes only secondary reset when only secondary has one", () => {
  assert.equal(
    buildFooterText(ADAPTER, {
      primary: { usedPercent: 10 },
      secondary: { usedPercent: 20, resetAfterSeconds: 120 },
    }),
    "Codex: 10% (20%) · resets in 2m",
  );
});

import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { _dns, assertSafeHttpUrl, safeFetch } from "./url-safety.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restoreAll();
});

test("assertSafeHttpUrl rejects local and private literal addresses", async () => {
  await assert.rejects(
    assertSafeHttpUrl("http://localhost/admin"),
    /public HTTP\(S\) URLs/,
  );
  await assert.rejects(
    assertSafeHttpUrl("http://127.0.0.1/admin"),
    /public HTTP\(S\) URLs/,
  );
  await assert.rejects(
    assertSafeHttpUrl("http://169.254.169.254/latest/meta-data"),
    /public HTTP\(S\) URLs/,
  );
  await assert.rejects(
    assertSafeHttpUrl("http://[::1]/admin"),
    /public HTTP\(S\) URLs/,
  );
  await assert.rejects(
    assertSafeHttpUrl("http://[::ffff:7f00:1]/admin"),
    /public HTTP\(S\) URLs/,
  );
});

test("assertSafeHttpUrl rejects hostnames resolving to private addresses", async () => {
  mock.method(_dns, "lookup", async () => [
    { address: "10.0.0.4", family: 4 as const },
  ]);

  await assert.rejects(
    assertSafeHttpUrl("https://internal.example/path"),
    /resolves to a private or reserved address/,
  );
});

test("safeFetch validates redirect targets before following them", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    });
  }) as typeof fetch;

  await assert.rejects(
    safeFetch("https://93.184.216.34/start"),
    /public HTTP\(S\) URLs/,
  );
  assert.equal(calls, 1);
});

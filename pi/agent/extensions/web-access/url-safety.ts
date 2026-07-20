import { lookup as nodeLookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const PUBLIC_URL_ERROR = "Only public HTTP(S) URLs are allowed.";

type LookupAddress = { address: string; family: number };

export const _dns: {
  lookup: (hostname: string) => Promise<LookupAddress[]>;
} = {
  lookup: (hostname) => nodeLookup(hostname, { all: true, verbatim: true }),
};

function normalizedHostname(hostname: string): string {
  const unbracketed =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  return unbracketed.toLowerCase().replace(/\.$/, "");
}

function isBlockedIpv4(address: string): boolean {
  const [a, b, c] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("::ffff:") ||
    normalized.startsWith("2001:db8:")
  ) {
    return true;
  }

  return false;
}

function isBlockedIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  return true;
}

export async function assertSafeHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(PUBLIC_URL_ERROR);
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw new Error(PUBLIC_URL_ERROR);
  }

  const hostname = normalizedHostname(url.hostname);
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost")
  ) {
    throw new Error(PUBLIC_URL_ERROR);
  }

  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new Error(PUBLIC_URL_ERROR);
    return url;
  }

  let addresses: LookupAddress[];
  try {
    addresses = await _dns.lookup(hostname);
  } catch {
    throw new Error(`Unable to resolve URL hostname: ${hostname}`);
  }
  if (addresses.length === 0) {
    throw new Error(`Unable to resolve URL hostname: ${hostname}`);
  }
  if (addresses.some(({ address }) => isBlockedIp(address))) {
    throw new Error(
      `URL hostname resolves to a private or reserved address: ${hostname}`,
    );
  }

  return url;
}

export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
): Promise<Response> {
  let url = await assertSafeHttpUrl(rawUrl);

  for (let redirects = 0; ; redirects += 1) {
    const response = await globalThis.fetch(url, {
      ...init,
      redirect: "manual",
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    if (redirects >= MAX_REDIRECTS) {
      await response.body?.cancel();
      throw new Error(`Too many redirects while fetching ${rawUrl}`);
    }

    const location = response.headers.get("location");
    if (!location) return response;
    const nextUrl = new URL(location, url);
    await response.body?.cancel();
    url = await assertSafeHttpUrl(nextUrl.href);
  }
}

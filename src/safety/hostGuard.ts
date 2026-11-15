import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { HostNotAllowedError } from "../errors.js";

export type LookupAll = (host: string) => Promise<string[]>;

const defaultLookup: LookupAll = async (host) =>
  (await dnsLookup(host, { all: true })).map((a) => a.address);

/** True for loopback and private-network addresses (RFC 1918, IPv6 ULA). */
export function isLocalAddress(ip: string): boolean {
  let addr = ip.toLowerCase();
  if (addr.startsWith("::ffff:")) addr = addr.slice(7);
  if (isIP(addr) === 4) {
    const [a, b] = addr.split(".").map(Number) as [number, number];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (isIP(addr) === 6) {
    return addr === "::1" || /^f[cd][0-9a-f]{2}:/.test(addr);
  }
  return false;
}

export function matchesHostPattern(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith("*.")) return h.endsWith(p.slice(1)) && h.length > p.length - 1;
  return h === p;
}

/**
 * Ensures a URL points at a local development host (FR-CON-06).
 * Allowed: localhost, *.localhost, configured allowedHosts, loopback/private IPs,
 * and host names that resolve only to loopback/private IPs (e.g. hosts-file entries).
 */
export async function assertLocalUrl(
  url: string,
  allowedHosts: string[] = [],
  lookup: LookupAll = defaultLookup,
): Promise<void> {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (allowedHosts.some((p) => matchesHostPattern(host, p))) return;
  if (host === "localhost" || host.endsWith(".localhost")) return;
  if (isIP(host)) {
    if (isLocalAddress(host)) return;
    throw notAllowed(host, `${host} is not a loopback or private address`);
  }

  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    throw notAllowed(host, `could not resolve ${host}`);
  }
  if (addresses.length > 0 && addresses.every(isLocalAddress)) return;
  throw notAllowed(host, `${host} resolves to ${addresses.join(", ")}`);
}

function notAllowed(host: string, reason: string): HostNotAllowedError {
  return new HostNotAllowedError(
    `Refusing to connect to "${host}": ${reason}. sitecore-mcp only talks to local instances.`,
    `If this really is a local instance, add "${host}" to "allowedHosts" in the config.`,
  );
}

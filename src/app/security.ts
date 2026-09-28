import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
export function assertSafeJourneyUrl(raw: string, allowedDomains: string[] = []) {
  const url = new URL(raw); if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) journey URLs are allowed");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (process.env.JOURNEYTEST_ALLOW_PRIVATE_NETWORKS === "1") return;
  if (host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal") throw new Error("Local and metadata hosts are not allowed");
  if (allowedDomains.length && !allowedDomains.some(domain => host === domain || host.endsWith(`.${domain}`))) throw new Error("URL host is not in allowed domains");
  if (isBlockedIp(host)) throw new Error("Loopback, private, link-local, and metadata addresses are not allowed");
}
export async function assertSafeJourneyNetwork(raw: string, allowedDomains: string[] = [], resolver: typeof lookup = lookup) { assertSafeJourneyUrl(raw, allowedDomains); if (process.env.JOURNEYTEST_ALLOW_PRIVATE_NETWORKS === "1") return; const host = new URL(raw).hostname.replace(/^\[|\]$/g, ""); if (isIP(host)) return; const addresses = await resolver(host, { all: true }); if (!addresses.length || addresses.some(item => isBlockedIp(item.address))) throw new Error("URL resolves to a blocked network address"); }
export async function assertSafeRedirectChain(raw: string, allowedDomains: string[] = [], fetcher: typeof fetch = fetch) { if (process.env.JOURNEYTEST_ALLOW_PRIVATE_NETWORKS === "1") return; let current = raw; for (let count = 0; count < 10; count++) { await assertSafeJourneyNetwork(current, allowedDomains); const response = await fetcher(current, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(10_000) }); if (response.status < 300 || response.status >= 400) return; const location = response.headers.get("location"); if (!location) return; current = new URL(location, current).href; } throw new Error("Too many redirects"); }
function isBlockedIp(host: string) { if (!isIP(host)) return false; if (host.includes(":")) return host === "::1" || host.toLowerCase().startsWith("fe80:") || host.toLowerCase().startsWith("fc") || host.toLowerCase().startsWith("fd"); const p = host.split(".").map(Number); return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127); }

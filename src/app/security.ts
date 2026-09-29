import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

export type NavigationPolicy = "same-origin" | "same-site" | "public-http" | "explicit-allowlist";

export interface NavigationOptions {
  allowedDomains?: string[];
  navigationPolicy?: NavigationPolicy;
  baseUrl?: string;
}

function parseNavigationOptions(options: NavigationOptions | string[] = {}): NavigationOptions {
  if (Array.isArray(options)) {
    return { allowedDomains: options };
  }
  return options;
}

export function assertSafeJourneyUrl(raw: string, optionsArg: NavigationOptions | string[] = {}) {
  const options = parseNavigationOptions(optionsArg);
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) journey URLs are allowed");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  const isLocalFixtureAllowed = options.allowedDomains?.some(d => {
    try {
      const dh = new URL(d).hostname.toLowerCase();
      return dh === "127.0.0.1" || dh === "localhost";
    } catch {
      return d.toLowerCase().includes("127.0.0.1") || d.toLowerCase().includes("localhost");
    }
  });

  if (process.env.JOURNEYTEST_ALLOW_PRIVATE_NETWORKS !== "1" && !isLocalFixtureAllowed) {
    if (host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal") {
      throw new Error("Local and metadata hosts are not allowed");
    }
    if (isBlockedIp(host)) {
      throw new Error("Loopback, private, link-local, and metadata addresses are not allowed");
    }
  }

  // Navigation Policy Check
  const policy: NavigationPolicy = options.navigationPolicy ?? (options.allowedDomains?.length ? "explicit-allowlist" : "same-origin");
  const baseUrl = options.baseUrl ? new URL(options.baseUrl) : undefined;

  if (policy === "explicit-allowlist" && options.allowedDomains?.length) {
    const isAllowed = options.allowedDomains.some(domain => {
      try {
        const dh = new URL(domain).hostname.toLowerCase();
        return host === dh || host.endsWith(`.${dh}`);
      } catch {
        const dLower = domain.toLowerCase();
        return host === dLower || host.endsWith(`.${dLower}`);
      }
    });
    if (!isAllowed) {
      throw new Error("URL host is not in allowed domains");
    }
  } else if (policy === "same-origin" && baseUrl) {
    const baseHost = baseUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host !== baseHost || url.port !== baseUrl.port) {
      throw new Error(`Navigation to "${raw}" is outside allowed origins: ${baseUrl.origin}`);
    }
  } else if (policy === "same-site" && baseUrl) {
    const baseHost = baseUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const siteA = getRegistrableDomain(baseHost);
    const siteB = getRegistrableDomain(host);
    if (siteA !== siteB) {
      throw new Error(`Navigation to "${raw}" is outside allowed same-site: ${siteA}`);
    }
  } else if (policy === "public-http") {
    return;
  }
}

export async function assertSafeJourneyNetwork(raw: string, optionsArg: NavigationOptions | string[] = {}, resolver: typeof lookup = lookup) {
  const options = parseNavigationOptions(optionsArg);
  assertSafeJourneyUrl(raw, options);
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, "");

  const isLocalFixtureAllowed = options.allowedDomains?.some(d => {
    try {
      const dh = new URL(d).hostname.toLowerCase();
      return dh === "127.0.0.1" || dh === "localhost";
    } catch {
      return d.toLowerCase().includes("127.0.0.1") || d.toLowerCase().includes("localhost");
    }
  });

  if (process.env.JOURNEYTEST_ALLOW_PRIVATE_NETWORKS === "1" || isLocalFixtureAllowed) return;

  if (isIP(host)) return;

  const addresses = await resolver(host, { all: true });
  if (!addresses.length || addresses.some(item => isBlockedIp(item.address))) {
    throw new Error("URL resolves to a blocked network address");
  }
}

export async function assertSafeRedirectChain(raw: string, optionsArg: NavigationOptions | string[] = {}, fetcher: typeof fetch = fetch) {
  const options = parseNavigationOptions(optionsArg);
  if (process.env.JOURNEYTEST_ALLOW_PRIVATE_NETWORKS === "1") return;

  let current = raw;
  for (let count = 0; count < 10; count++) {
    await assertSafeJourneyNetwork(current, options);
    const response = await fetcher(current, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(10_000) });
    if (response.status < 300 || response.status >= 400) return;
    const location = response.headers.get("location");
    if (!location) return;
    current = new URL(location, current).href;
  }
  throw new Error("Too many redirects");
}

function isBlockedIp(host: string): boolean {
  if (!isIP(host)) return false;
  if (host.includes(":")) {
    const lower = host.toLowerCase();
    return lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd");
  }
  const p = host.split(".").map(Number);
  return (
    p[0] === 10 ||
    p[0] === 127 ||
    p[0] === 0 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
  );
}

export function getRegistrableDomain(hostname: string): string {
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length <= 2) return hostname;
  const secondLast = parts[parts.length - 2];
  if (["co", "com", "org", "gov", "edu", "net", "ac"].includes(secondLast) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

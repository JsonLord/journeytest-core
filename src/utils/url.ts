import { assertSafeJourneyUrl, type NavigationOptions, type NavigationPolicy } from "../app/security.js";

export function allowedOriginsFor(
  baseUrl: string,
  allowedOrigins?: string[],
  navigationPolicy?: NavigationPolicy,
): string[] {
  if (navigationPolicy === "public-http" || navigationPolicy === "same-site") {
    return ["*"];
  }
  if (allowedOrigins?.length) {
    return allowedOrigins;
  }
  const baseOrigin = new URL(baseUrl).origin;
  return [baseOrigin];
}

export function assertUrlAllowed(
  url: string,
  allowedOrigins: string[],
  navigationPolicy?: NavigationPolicy,
  baseUrl?: string,
): void {
  if (allowedOrigins.includes("*") || navigationPolicy === "public-http" || navigationPolicy === "same-site") {
    assertSafeJourneyUrl(url, { navigationPolicy: navigationPolicy ?? "public-http", baseUrl });
    return;
  }
  const opts: NavigationOptions = {
    allowedDomains: allowedOrigins,
    navigationPolicy,
    baseUrl,
  };
  assertSafeJourneyUrl(url, opts);
}

import { isIP } from "node:net";
import geoip from "geoip-country";
import { currencyForCountry, type ArticleCurrency } from "./article-pricing";

// Server-only: keep the country database out of the browser bundle.
export function requestCurrency(headers: Pick<Headers, "get">): ArticleCurrency {
  // Railway's public ingress sets X-Real-IP to the visitor's address.
  // Prefer it over forwarded chains and client-supplied country hints.
  const ip = (headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0])?.trim();
  if (!ip || !isIP(ip)) return "usd";
  const country = geoip.lookup(ip)?.country;
  return country ? currencyForCountry(country) : "usd";
}

import assert from "node:assert/strict";
import test from "node:test";
import { articlePriceLabel, isArticleOrder, currencyForCountry } from "./article-pricing";
import { requestCurrency } from "./request-currency";

test("country pricing uses pounds for GB, euros for euro users, and dollars elsewhere", () => {
  for (const region of ["GB", "gb"]) assert.equal(currencyForCountry(region), "gbp");
  for (const region of ["IE", "FR", "DE", "ES", "BG", "HR", "FI", "XK", "MC"]) assert.equal(currencyForCountry(region), "eur");
  for (const region of ["US", "CA", "AU", "JP", "CH", "SE", "PL", "DK", "", "XX"]) assert.equal(currencyForCountry(region), "usd");
  assert.deepEqual(["usd", "gbp", "eur"].map(currency => articlePriceLabel(currency as "usd" | "gbp" | "eur")), ["$0.90", "£0.85", "€0.90"]);
});

test("visitor IP selects currency regardless of browser language", () => {
  for (const [ip, currency] of [
    ["86.43.1.1", "eur"], ["2a02:8084::1", "eur"], ["::ffff:86.43.1.1", "eur"],
    ["81.2.69.160", "gbp"], ["8.8.8.8", "usd"], ["2001:4860:4860::8888", "usd"],
  ]) {
    for (const language of ["en-GB,en;q=0.9", "en-US", "en-IE", "fr-FR"]) {
      assert.equal(requestCurrency(new Headers({ "x-real-ip": ip, "accept-language": language })), currency, `${ip}: ${language}`);
    }
  }
});

test("Railway's client IP takes priority over forwarded chains and country hints", () => {
  assert.equal(requestCurrency(new Headers({
    "x-real-ip": "86.43.1.1", "x-forwarded-for": "81.2.69.160, 8.8.8.8",
    "cf-ipcountry": "GB", "x-vercel-ip-country": "US",
  })), "eur");
  assert.equal(requestCurrency(new Headers({ "x-forwarded-for": " 86.43.1.1, 8.8.8.8 " })), "eur");
  assert.equal(requestCurrency(new Headers({ "x-real-ip": "invalid", "x-forwarded-for": "86.43.1.1" })), "usd");
});

test("missing, private, malformed and unknown IPs default to dollars without guessing from language", () => {
  for (const ip of ["", "invalid", "127.0.0.1", "::1", "10.0.0.1", "192.168.1.1", "192.0.2.1", "86.43.1.1:1234", "86.43.1.1, 8.8.8.8"]) {
    assert.equal(requestCurrency(new Headers({ "x-real-ip": ip, "accept-language": "en-GB" })), "usd", ip);
  }
  assert.equal(requestCurrency(new Headers({ "accept-language": "en-IE" })), "usd");
});

test("saved 1.00 and 1.50 checkouts remain valid without allowing arbitrary prices", () => {
  assert.equal(articlePriceLabel("eur", 100), "€1.00");
  for (const currency of ["usd", "gbp", "eur"]) {
    for (const amount of [currency === "gbp" ? 85 : 90, 100, 150]) assert.equal(isArticleOrder({ kind: "article", amount, currency }), true);
    for (const amount of [0, currency === "gbp" ? 90 : 85, 99, 149, 151, 200]) assert.equal(isArticleOrder({ kind: "article", amount, currency }), false);
  }
  assert.equal(isArticleOrder({ kind: "credits", amount: 150, currency: "eur" }), false);
  assert.equal(isArticleOrder({ kind: "article", amount: 150, currency: "jpy" }), false);
});

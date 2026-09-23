// Only our billing pages are valid destinations after authentication.
export function authReturnPath(requested: string = "/account", origin: string = "http://localhost:3000") {
  try {
    const base = new URL(origin);
    const destination = new URL(requested, base);
    if (destination.origin !== base.origin || !["/payment", "/account"].includes(destination.pathname)) return null;
    return `${destination.pathname}${destination.search}`;
  } catch {
    return null;
  }
}

export function authPagePath(mode: "sign-up" | "sign-in", returnPath: string) {
  return `/auth/${mode}?return=${encodeURIComponent(returnPath)}`;
}

export function signupCompletionPath(returnPath: string) {
  return `/auth/complete?return=${encodeURIComponent(returnPath)}`;
}

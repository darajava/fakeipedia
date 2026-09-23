import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";

const clerk = clerkMiddleware({ signInUrl: "/auth/sign-in", signUpUrl: "/auth/sign-up" });
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) return NextResponse.next();
  return clerk(request, event);
}
export const config = { matcher: ["/((?!_next|wiki-images|.*\\.(?:png|jpg|jpeg|svg|ico|css|js|woff2?)$).*)"] };

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { authPagePath, authReturnPath } from "@/lib/auth-navigation";
export async function GET(request: Request) {
  if (!process.env.CLERK_SECRET_KEY || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return new Response("Sign-in is not available yet. Your saved answer is safe; use your browser’s Back button to return.", { status: 503 });
  const url = new URL(request.url);
  const requested = url.searchParams.get("return") ?? "/account";
  const returnPath = authReturnPath(requested, process.env.APP_URL ?? url.origin);
  if (!returnPath) return Response.json({ error: "Invalid return destination." }, { status: 400 });
  const session = await auth();
  if (session.userId) redirect(returnPath);
  redirect(authPagePath(url.searchParams.get("mode") === "sign-in" ? "sign-in" : "sign-up", returnPath));
}

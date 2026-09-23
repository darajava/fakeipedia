import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "../../db";
import { users } from "../../db/schema";
import { BillingError } from "./config";

export async function billingUser() {
  if (!process.env.CLERK_SECRET_KEY || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return null;
  const { userId } = await auth();
  if (!userId) return null;
  const [existing] = await db.select().from(users).where(eq(users.clerkId, userId)).limit(1);
  if (existing) return existing;
  const identity = await currentUser();
  const email = identity?.emailAddresses.find((entry) => entry.id === identity.primaryEmailAddressId && entry.verification?.status === "verified")?.emailAddress;
  if (!email) throw new BillingError("Verify your email address before buying or using credits.", 403);
  // Only verified email addresses may claim a legacy local user. Never reassign an
  // identity already linked to a different Clerk account.
  const [created] = await db.insert(users).values({ clerkId: userId, email: email.toLowerCase() })
    .onConflictDoNothing().returning();
  if (created) return created;
  const [linked] = await db.update(users).set({ clerkId: userId })
    .where(and(eq(users.email, email.toLowerCase()), or(isNull(users.clerkId), eq(users.clerkId, userId)))).returning();
  if (!linked) throw new BillingError("Could not link your account. Please try signing in again.", 409);
  return linked;
}

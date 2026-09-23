import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import { readPublicHandle } from "./public-handle";

export async function savePublicHandle(userId: number, value: unknown) {
  const handle = readPublicHandle(value);
  await db.update(users).set({ handle }).where(eq(users.id, userId));
  return handle;
}

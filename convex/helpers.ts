import { QueryCtx, MutationCtx, ActionCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { api } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";

export async function getCurrentUser(
  ctx: QueryCtx | MutationCtx
): Promise<Doc<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    return null;
  }
  
  const user = await ctx.db.get(userId);
  return user;
}

export async function requireCurrentUser(
  ctx: QueryCtx | MutationCtx
): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) {
    throw new Error("Unauthorized");
  }
  return user;
}

export async function getCurrentUserForAction(
  ctx: ActionCtx
): Promise<Id<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  return userId;
}

export async function requireCurrentUserForAction(
  ctx: ActionCtx
): Promise<Id<"users">> {
  const userId = await getCurrentUserForAction(ctx);
  if (!userId) {
    throw new Error("Unauthorized");
  }
  return userId;
}
import { v } from "convex/values";
import { mutation, query, internalQuery, internalMutation, action, internalAction } from "./_generated/server";
import { requireCurrentUser, getCurrentUser } from "./helpers";
import FirecrawlApp from "@mendable/firecrawl-js";
import { internal } from "./_generated/api";
import { requireCurrentUserForAction } from "./helpers";

// Simple obfuscation for API keys (in production, use proper encryption)
function encryptKey(key: string): string {
  return key;
}

function decryptKey(encryptedKey: string): string {
  return encryptedKey;
}

// Get all the current user's Firecrawl API keys
export const getUserFirecrawlKeys = query({
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return [];
    }

    const apiKeys = await ctx.db
      .query("firecrawlApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    return apiKeys.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)).map(apiKey => ({
      _id: apiKey._id,
      name: apiKey.name,
      priority: apiKey.priority ?? 0,
      isExhausted: apiKey.isExhausted ?? false,
      remainingCredits: apiKey.remainingCredits,
      lastCreditCheck: apiKey.lastCreditCheck,
      lastUsed: apiKey.lastUsed,
      createdAt: apiKey.createdAt,
      updatedAt: apiKey.updatedAt,
      // Don't return the actual key for security
      maskedKey: decryptKey(apiKey.encryptedKey).slice(0, 8) + '...' + decryptKey(apiKey.encryptedKey).slice(-4),
    }));
  },
});

// Deprecated: for backward compatibility during migration
export const getUserFirecrawlKey = query({
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const keys = await ctx.db
      .query("firecrawlApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    if (keys.length === 0) return null;
    const apiKey = keys.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))[0];
    return {
      hasKey: true,
      lastUsed: apiKey.lastUsed,
      createdAt: apiKey.createdAt,
      updatedAt: apiKey.updatedAt,
      maskedKey: decryptKey(apiKey.encryptedKey).slice(0, 8) + '...' + decryptKey(apiKey.encryptedKey).slice(-4),
    };
  },
});

// Add a new Firecrawl API key
export const addFirecrawlKey = mutation({
  args: {
    apiKey: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

    // Validate the API key format
    const trimmedKey = args.apiKey.trim();
    if (!trimmedKey || trimmedKey.length < 20) {
      throw new Error("Invalid API key format");
    }

    // Firecrawl keys typically start with 'fc-'
    if (!trimmedKey.startsWith('fc-')) {
      throw new Error("Invalid Firecrawl API key format. Keys should start with 'fc-'");
    }

    // Get current keys to determine priority
    const existingKeys = await ctx.db
      .query("firecrawlApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const maxPriority = existingKeys.reduce((max, k) => Math.max(max, k.priority ?? -1), -1);

    const encryptedKey = encryptKey(trimmedKey);
    const now = Date.now();

    await ctx.db.insert("firecrawlApiKeys", {
      userId: user._id,
      encryptedKey,
      name: args.name,
      priority: maxPriority + 1,
      isExhausted: false,
      createdAt: now,
      updatedAt: now,
    });

    return { success: true };
  },
});

// Set or update the target Firecrawl API key (Legacy support)
export const setFirecrawlKey = mutation({
  args: {
    apiKey: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const trimmedKey = args.apiKey.trim();
    if (!trimmedKey || trimmedKey.length < 20) throw new Error("Invalid API key format");

    const existingKey = await ctx.db
      .query("firecrawlApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (existingKey) {
      await ctx.db.patch(existingKey._id, {
        encryptedKey: encryptKey(trimmedKey),
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("firecrawlApiKeys", {
        userId: user._id,
        encryptedKey: encryptKey(trimmedKey),
        name: "Default Key",
        priority: 0,
        isExhausted: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    return { success: true };
  },
});

// Update key name or exhaustion status
export const updateFirecrawlKey = mutation({
  args: {
    keyId: v.id("firecrawlApiKeys"),
    name: v.optional(v.string()),
    isExhausted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const apiKey = await ctx.db.get(args.keyId);

    if (!apiKey || apiKey.userId !== user._id) {
      throw new Error("Key not found");
    }

    await ctx.db.patch(args.keyId, {
      ...(args.name !== undefined && { name: args.name }),
      ...(args.isExhausted !== undefined && { isExhausted: args.isExhausted }),
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Update key priority
export const updateKeyPriority = mutation({
  args: {
    keyId: v.id("firecrawlApiKeys"),
    newPriority: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const allKeys = await ctx.db
      .query("firecrawlApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const sortedKeys = allKeys.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    const keyToMoveIndex = sortedKeys.findIndex(k => k._id === args.keyId);

    if (keyToMoveIndex === -1) throw new Error("Key not found");

    const keyToMove = sortedKeys.splice(keyToMoveIndex, 1)[0];
    sortedKeys.splice(args.newPriority, 0, keyToMove);

    // Update all priorities
    for (let i = 0; i < sortedKeys.length; i++) {
      await ctx.db.patch(sortedKeys[i]._id, {
        priority: i,
        updatedAt: Date.now(),
      });
    }

    return { success: true };
  },
});

// Delete a Firecrawl API key
export const deleteFirecrawlKey = mutation({
  args: {
    keyId: v.optional(v.id("firecrawlApiKeys")),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

    if (args.keyId) {
      const apiKey = await ctx.db.get(args.keyId);
      if (apiKey && apiKey.userId === user._id) {
        await ctx.db.delete(args.keyId);

        // Re-order remaining keys
        const remainingKeys = await ctx.db
          .query("firecrawlApiKeys")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .collect();

        const sorted = remainingKeys.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
        for (let i = 0; i < sorted.length; i++) {
          await ctx.db.patch(sorted[i]._id, { priority: i });
        }
      }
    } else {
      // Legacy: delete first key
      const apiKey = await ctx.db
        .query("firecrawlApiKeys")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .first();

      if (apiKey) {
        await ctx.db.delete(apiKey._id);
      }
    }

    return { success: true };
  },
});

// Internal query to get first available decrypted API key for backend use
export const getDecryptedFirecrawlKey = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const apiKeys = await ctx.db
      .query("firecrawlApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    // Filter for non-exhausted keys and sort by priority
    const availableKeys = apiKeys
      .filter(k => !(k.isExhausted ?? false))
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

    const apiKey = availableKeys[0];

    if (!apiKey) {
      return null;
    }

    return {
      key: decryptKey(apiKey.encryptedKey),
      keyId: apiKey._id,
    };
  },
});

// Internal mutation to update last used timestamp
export const updateLastUsed = internalMutation({
  args: {
    keyId: v.id("firecrawlApiKeys"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.keyId, {
      lastUsed: Date.now(),
    });
  },
});

// Internal mutation to mark a key as exhausted
export const markKeyExhausted = internalMutation({
  args: {
    keyId: v.id("firecrawlApiKeys"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.keyId, {
      isExhausted: true,
      updatedAt: Date.now(),
    });
  },
});

// Internal action to get token usage from Firecrawl API for a specific key or all keys
export const getTokenUsageInternal = internalAction({
  args: {
    keyId: v.optional(v.id("firecrawlApiKeys")),
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string; remaining_tokens?: number }> => {
    let keysToTrack = [];
    if (args.keyId) {
      const keyData = await ctx.runQuery(internal.firecrawlKeys.getSpecificDecryptedKey, { keyId: args.keyId, userId: args.userId });
      if (keyData) keysToTrack.push(keyData);
    } else {
      const userKeys = await ctx.runQuery(internal.firecrawlKeys.getAllDecryptedKeys, { userId: args.userId });
      keysToTrack = userKeys;
    }

    if (keysToTrack.length === 0) {
      return { success: false, error: "No API keys found" };
    }

    let totalRemaining = 0;
    let anySuccess = false;

    for (const keyData of keysToTrack) {
      try {
        const response = await fetch('https://api.firecrawl.dev/v1/team/credit-usage', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${keyData.key}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          const remaining = data.data?.remaining_credits || 0;
          totalRemaining += remaining;
          anySuccess = true;

          // Update cached values
          await ctx.runMutation(internal.firecrawlKeys.updateKeyCreditsInternal, {
            keyId: keyData.keyId,
            remainingCredits: remaining,
            isExhausted: remaining <= 0,
          });
        }
      } catch (error) {
        console.error(`Failed to fetch usage for key ${keyData.keyId}:`, error);
      }
    }

    if (!anySuccess) {
      return { success: false, error: "Failed to fetch token usage for any key" };
    }

    return {
      success: true,
      remaining_tokens: totalRemaining
    };
  },
});

// Public action to get token usage
export const getTokenUsage = action({
  args: {
    keyId: v.optional(v.id("firecrawlApiKeys")),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string; remaining_tokens?: number }> => {
    const userId = await requireCurrentUserForAction(ctx);
    return await ctx.runAction(internal.firecrawlKeys.getTokenUsageInternal, {
      keyId: args.keyId,
      userId,
    });
  },
});

// Refresh all keys for a user
export const refreshAllKeyCredits = action({
  handler: async (ctx): Promise<{ success: boolean; error?: string; remaining_tokens?: number }> => {
    const userId = await requireCurrentUserForAction(ctx);
    return await ctx.runAction(internal.firecrawlKeys.getTokenUsageInternal, { userId });
  }
});

// Helper internal queries to support token usage action
export const getAllDecryptedKeys = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const keys = await ctx.db
      .query("firecrawlApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    return keys.map(k => ({
      key: decryptKey(k.encryptedKey),
      keyId: k._id,
    }));
  }
});

export const getSpecificDecryptedKey = internalQuery({
  args: { keyId: v.id("firecrawlApiKeys"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.keyId);
    if (!key || key.userId !== args.userId) return null;
    return {
      key: decryptKey(key.encryptedKey),
      keyId: key._id,
    };
  }
});

export const updateKeyCreditsInternal = internalMutation({
  args: {
    keyId: v.id("firecrawlApiKeys"),
    remainingCredits: v.number(),
    isExhausted: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.keyId, {
      remainingCredits: args.remainingCredits,
      isExhausted: args.isExhausted,
      lastCreditCheck: Date.now(),
      updatedAt: Date.now(),
    });
  }
});
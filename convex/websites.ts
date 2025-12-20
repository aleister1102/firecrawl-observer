import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireCurrentUser, getCurrentUser } from "./helpers";
import { internal } from "./_generated/api";

// Create a new website to monitor
export const createWebsite = mutation({
  args: {
    url: v.string(),
    name: v.string(),
    checkInterval: v.number(), // in minutes
    notificationPreference: v.optional(v.union(
      v.literal("none"),
      v.literal("email"),
      v.literal("webhook"),
      v.literal("discord"),
      v.literal("both"),
      v.literal("all")
    )),
    webhookUrl: v.optional(v.string()),
    discordWebhookUrl: v.optional(v.string()),
    monitorType: v.optional(v.union(
      v.literal("single_page"),
      v.literal("full_site")
    )),
    crawlLimit: v.optional(v.number()),
    crawlDepth: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    
    // Get user settings for default webhooks
    const userSettings = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    
    let webhookUrl = args.webhookUrl;
    let discordWebhookUrl = args.discordWebhookUrl;
    
    // Apply default webhook URLs if not provided
    if (!webhookUrl && args.notificationPreference && ['webhook', 'both', 'all'].includes(args.notificationPreference)) {
      if (userSettings?.defaultWebhookUrl) {
        webhookUrl = userSettings.defaultWebhookUrl;
      }
    }
    
    if (!discordWebhookUrl && args.notificationPreference && ['discord', 'all'].includes(args.notificationPreference)) {
      if (userSettings?.defaultDiscordWebhookUrl) {
        discordWebhookUrl = userSettings.defaultDiscordWebhookUrl;
      }
    }

    const websiteId = await ctx.db.insert("websites", {
      url: args.url,
      name: args.name,
      userId: user._id,
      isActive: true,
      checkInterval: args.checkInterval,
      notificationPreference: args.notificationPreference || "none",
      webhookUrl,
      discordWebhookUrl,
      monitorType: args.monitorType || "single_page",
      crawlLimit: args.crawlLimit,
      crawlDepth: args.crawlDepth,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // If it's a full site monitor, trigger initial crawl
    if (args.monitorType === "full_site") {
      await ctx.scheduler.runAfter(0, internal.crawl.performCrawl, {
        websiteId,
        userId: user._id,
      });
    }

    return websiteId;
  },
});

// Get all websites for the current user
export const getUserWebsites = query({
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return [];
    }

    const websites = await ctx.db
      .query("websites")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    return websites;
  },
});

// Get a specific website (internal)
export const getWebsite = internalQuery({
  args: {
    websiteId: v.id("websites"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const website = await ctx.db.get(args.websiteId);
    if (!website || website.userId !== args.userId) {
      return null;
    }
    return website;
  },
});

// Toggle website monitoring
export const toggleWebsiteActive = mutation({
  args: {
    websiteId: v.id("websites"),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

    const website = await ctx.db.get(args.websiteId);
    if (!website || website.userId !== user._id) {
      throw new Error("Website not found");
    }

    await ctx.db.patch(args.websiteId, {
      isActive: !website.isActive,
      updatedAt: Date.now(),
    });

    return !website.isActive;
  },
});

// Pause/Resume website monitoring
export const pauseWebsite = mutation({
  args: {
    websiteId: v.id("websites"),
    isPaused: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

    const website = await ctx.db.get(args.websiteId);
    if (!website || website.userId !== user._id) {
      throw new Error("Website not found");
    }

    await ctx.db.patch(args.websiteId, {
      isPaused: args.isPaused,
      updatedAt: Date.now(),
    });

    return args.isPaused;
  },
});

// Update website settings
export const updateWebsite = mutation({
  args: {
    websiteId: v.id("websites"),
    notificationPreference: v.optional(v.union(
      v.literal("none"),
      v.literal("email"),
      v.literal("webhook"),
      v.literal("both")
    )),
    webhookUrl: v.optional(v.string()),
    checkInterval: v.optional(v.number()),
    monitorType: v.optional(v.union(
      v.literal("single_page"),
      v.literal("full_site")
    )),
    crawlLimit: v.optional(v.number()),
    crawlDepth: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

    const website = await ctx.db.get(args.websiteId);
    if (!website || website.userId !== user._id) {
      throw new Error("Website not found");
    }

    const updates: any = {
      updatedAt: Date.now(),
    };

    if (args.notificationPreference !== undefined) {
      updates.notificationPreference = args.notificationPreference;
    }

    if (args.webhookUrl !== undefined) {
      updates.webhookUrl = args.webhookUrl;
    }

    if (args.checkInterval !== undefined) {
      updates.checkInterval = args.checkInterval;
    }

    if (args.monitorType !== undefined) {
      updates.monitorType = args.monitorType;
    }

    if (args.crawlLimit !== undefined) {
      updates.crawlLimit = args.crawlLimit;
    }

    if (args.crawlDepth !== undefined) {
      updates.crawlDepth = args.crawlDepth;
    }

    await ctx.db.patch(args.websiteId, updates);

    // If changing to full site monitoring, trigger initial crawl
    if (args.monitorType === "full_site" && website.monitorType !== "full_site") {
      await ctx.scheduler.runAfter(0, internal.crawl.performCrawl, {
        websiteId: args.websiteId,
        userId: user._id,
      });
    }
  },
});

// Create checking status entry (internal)
export const createCheckingStatus = internalMutation({
  args: {
    websiteId: v.id("websites"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Create a temporary "checking" status entry
    const scrapeResultId = await ctx.db.insert("scrapeResults", {
      websiteId: args.websiteId,
      userId: args.userId,
      markdown: "Checking for changes...",
      changeStatus: "checking",
      visibility: "visible",
      scrapedAt: Date.now(),
    });

    return scrapeResultId;
  },
});

// Update lastChecked timestamp immediately (to prevent duplicate checks)
export const updateLastChecked = internalMutation({
  args: {
    websiteId: v.id("websites"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.websiteId, {
      lastChecked: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

// Remove checking status entries (internal)
export const removeCheckingStatus = internalMutation({
  args: {
    websiteId: v.id("websites"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Find and remove any checking status entries for this website
    const checkingEntries = await ctx.db
      .query("scrapeResults")
      .withIndex("by_website", (q) => q.eq("websiteId", args.websiteId))
      .filter((q) => q.eq(q.field("changeStatus"), "checking"))
      .collect();

    for (const entry of checkingEntries) {
      await ctx.db.delete(entry._id);
    }
  },
});

// Store scrape result (internal)
export const storeScrapeResult = internalMutation({
  args: {
    websiteId: v.id("websites"),
    userId: v.id("users"),
    markdown: v.string(),
    changeStatus: v.union(
      v.literal("new"),
      v.literal("same"),
      v.literal("changed"),
      v.literal("removed"),
      v.literal("checking")
    ),
    visibility: v.union(v.literal("visible"), v.literal("hidden")),
    previousScrapeAt: v.optional(v.number()),
    scrapedAt: v.number(),
    firecrawlMetadata: v.optional(v.any()),
    ogImage: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    url: v.optional(v.string()), // Add URL parameter
    diff: v.optional(v.object({
      text: v.string(),
      json: v.any(),
    })),
  },
  handler: async (ctx, args) => {
    // Remove any checking status entries first
    await ctx.runMutation(internal.websites.removeCheckingStatus, {
      websiteId: args.websiteId,
      userId: args.userId,
    });

    // Store the scrape result
    const scrapeResultId = await ctx.db.insert("scrapeResults", {
      websiteId: args.websiteId,
      userId: args.userId,
      markdown: args.markdown,
      changeStatus: args.changeStatus,
      visibility: args.visibility,
      previousScrapeAt: args.previousScrapeAt,
      scrapedAt: args.scrapedAt,
      firecrawlMetadata: args.firecrawlMetadata,
      ogImage: args.ogImage,
      title: args.title,
      description: args.description,
      url: args.url,
      diff: args.diff,
    });

    // Update website last checked time
    await ctx.db.patch(args.websiteId, {
      lastChecked: args.scrapedAt,
      updatedAt: Date.now(),
    });

    return scrapeResultId;
  },
});

// Create change alert (internal)
export const createChangeAlert = internalMutation({
  args: {
    websiteId: v.id("websites"),
    userId: v.id("users"),
    scrapeResultId: v.id("scrapeResults"),
    changeType: v.string(),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("changeAlerts", {
      websiteId: args.websiteId,
      userId: args.userId,
      scrapeResultId: args.scrapeResultId,
      changeType: args.changeType,
      summary: args.summary,
      isRead: false,
      createdAt: Date.now(),
    });
  },
});

// Get recent scrape results for a website
export const getWebsiteScrapeHistory = query({
  args: {
    websiteId: v.id("websites"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return [];
    }

    // Verify website ownership
    const website = await ctx.db.get(args.websiteId);
    if (!website || website.userId !== user._id) {
      return [];
    }

    const results = await ctx.db
      .query("scrapeResults")
      .withIndex("by_website_time", (q) => q.eq("websiteId", args.websiteId))
      .order("desc")
      .take(args.limit || 10);

    return results;
  },
});

// Get unread alerts for the current user
export const getUnreadAlerts = query({
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return [];
    }

    const alerts = await ctx.db
      .query("changeAlerts")
      .withIndex("by_read_status", (q) =>
        q.eq("userId", user._id).eq("isRead", false)
      )
      .order("desc")
      .collect();

    // Include website details
    const alertsWithWebsites = await Promise.all(
      alerts.map(async (alert) => {
        const website = await ctx.db.get(alert.websiteId);
        return {
          ...alert,
          websiteName: website?.name,
          websiteUrl: website?.url,
        };
      })
    );

    return alertsWithWebsites;
  },
});

// Mark alert as read
export const markAlertAsRead = mutation({
  args: {
    alertId: v.id("changeAlerts"),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

    const alert = await ctx.db.get(args.alertId);
    if (!alert || alert.userId !== user._id) {
      throw new Error("Alert not found");
    }

    await ctx.db.patch(args.alertId, {
      isRead: true,
    });
  },
});

// Get all scrape history for check log
export const getAllScrapeHistory = query({
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return [];
    }

    // Get all websites for the user
    const websites = await ctx.db
      .query("websites")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const websiteMap = new Map(websites.map(w => [w._id, w]));

    // Get all scrape results for user's websites
    const allScrapes = await ctx.db
      .query("scrapeResults")
      .withIndex("by_user_time", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(100); // Limit to last 100 scrapes

    // Count scrapes per website
    const scrapeCounts = new Map<string, number>();
    for (const scrape of allScrapes) {
      scrapeCounts.set(scrape.websiteId, (scrapeCounts.get(scrape.websiteId) || 0) + 1);
    }

    // Group scrapes by website and find position
    const scrapesByWebsite = new Map<string, typeof allScrapes>();
    for (const scrape of allScrapes) {
      if (!scrapesByWebsite.has(scrape.websiteId)) {
        scrapesByWebsite.set(scrape.websiteId, []);
      }
      scrapesByWebsite.get(scrape.websiteId)!.push(scrape);
    }

    // Enrich with website info and check if it's truly the first scrape
    return allScrapes.map((scrape) => {
      const websiteScrapes = scrapesByWebsite.get(scrape.websiteId) || [];
      const scrapeIndex = websiteScrapes.findIndex(s => s._id === scrape._id);
      const isFirstScrape = scrapeIndex === websiteScrapes.length - 1; // Last in array is oldest
      
      return {
        ...scrape,
        websiteName: websiteMap.get(scrape.websiteId)?.name || "Unknown",
        websiteUrl: scrape.url || websiteMap.get(scrape.websiteId)?.url || "",
        isFirstScrape: isFirstScrape,
        scrapeNumber: websiteScrapes.length - scrapeIndex,
        totalScrapes: websiteScrapes.length,
      };
    });
  },
});

// Get latest scrape result for each website
export const getLatestScrapeForWebsites = query({
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return {};
    }

    const websites = await ctx.db
      .query("websites")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const latestScrapes: Record<string, any> = {};
    
    for (const website of websites) {
      const latestScrape = await ctx.db
        .query("scrapeResults")
        .withIndex("by_website_time", (q) => q.eq("websiteId", website._id))
        .order("desc")
        .first();
      
      if (latestScrape) {
        latestScrapes[website._id] = latestScrape;
      }
    }

    return latestScrapes;
  },
});

// Delete a website and all related data
export const deleteWebsite = mutation({
  args: {
    websiteId: v.id("websites"),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

    const website = await ctx.db.get(args.websiteId);
    if (!website || website.userId !== user._id) {
      throw new Error("Website not found");
    }

    // Schedule async deletion of all related data to avoid memory limits
    await ctx.scheduler.runAfter(0, internal.websites.deleteWebsiteData, {
      websiteId: args.websiteId,
      userId: user._id,
      dataType: "scrapeResults"
    });
    
    await ctx.scheduler.runAfter(0, internal.websites.deleteWebsiteData, {
      websiteId: args.websiteId,
      userId: user._id,
      dataType: "changeAlerts"
    });
    
    if (website.monitorType === "full_site") {
      await ctx.scheduler.runAfter(0, internal.websites.deleteWebsiteData, {
        websiteId: args.websiteId,
        userId: user._id,
        dataType: "crawlSessions"
      });
    }

    // Delete the website immediately
    await ctx.db.delete(args.websiteId);
  },
});

// Internal function to delete website data asynchronously
export const deleteWebsiteData = internalMutation({
  args: {
    websiteId: v.id("websites"),
    userId: v.id("users"),
    dataType: v.union(
      v.literal("scrapeResults"),
      v.literal("changeAlerts"),
      v.literal("crawlSessions")
    ),
  },
  handler: async (ctx, args) => {
    const BATCH_SIZE = 20;
    let hasMore = true;
    
    while (hasMore) {
      let items: any[] = [];
      
      switch (args.dataType) {
        case "scrapeResults":
          items = await ctx.db
            .query("scrapeResults")
            .withIndex("by_website", (q) => q.eq("websiteId", args.websiteId))
            .take(BATCH_SIZE);
          break;
        case "changeAlerts":
          items = await ctx.db
            .query("changeAlerts")
            .withIndex("by_website", (q) => q.eq("websiteId", args.websiteId))
            .take(BATCH_SIZE);
          break;
        case "crawlSessions":
          items = await ctx.db
            .query("crawlSessions")
            .withIndex("by_website", (q) => q.eq("websiteId", args.websiteId))
            .take(BATCH_SIZE);
          break;
      }
      
      if (items.length === 0) {
        hasMore = false;
      } else {
        await Promise.all(items.map(item => ctx.db.delete(item._id)));
      }
    }
  },
});

// Create website from API
export const createWebsiteFromApi = internalMutation({
  args: {
    userId: v.id("users"),
    url: v.string(),
    name: v.string(),
    checkInterval: v.number(),
    notificationPreference: v.optional(v.union(
      v.literal("none"),
      v.literal("email"),
      v.literal("webhook"),
      v.literal("both")
    )),
    webhookUrl: v.optional(v.string()),
    monitorType: v.optional(v.union(
      v.literal("single_page"),
      v.literal("full_site")
    )),
    crawlLimit: v.optional(v.number()),
    crawlDepth: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const websiteId = await ctx.db.insert("websites", {
      url: args.url,
      name: args.name,
      userId: args.userId,
      isActive: true,
      checkInterval: args.checkInterval,
      notificationPreference: args.notificationPreference || "none",
      webhookUrl: args.webhookUrl,
      monitorType: args.monitorType || "single_page",
      crawlLimit: args.crawlLimit,
      crawlDepth: args.crawlDepth,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // If it's a full site monitor, trigger initial crawl
    if (args.monitorType === "full_site") {
      await ctx.scheduler.runAfter(0, internal.crawl.performCrawl, {
        websiteId,
        userId: args.userId,
      });
    }

    return websiteId;
  },
});

// Pause/resume website from API
export const pauseWebsiteFromApi = internalMutation({
  args: {
    userId: v.id("users"),
    websiteId: v.string(),
    isPaused: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Find the website
    const websiteId = args.websiteId as Id<"websites">;
    const website = await ctx.db.get(websiteId);
    
    if (!website || website.userId !== args.userId) {
      return false;
    }

    // Update the pause status
    await ctx.db.patch(websiteId, {
      isPaused: args.isPaused,
      updatedAt: Date.now(),
    });

    return true;
  },
});

// Delete website from API
export const deleteWebsiteFromApi = internalMutation({
  args: {
    userId: v.id("users"),
    websiteId: v.string(),
  },
  handler: async (ctx, args) => {
    // Find the website
    const websiteId = args.websiteId as Id<"websites">;
    const website = await ctx.db.get(websiteId);
    
    if (!website || website.userId !== args.userId) {
      return false;
    }

    // Schedule async deletion of all related data
    await ctx.scheduler.runAfter(0, internal.websites.deleteWebsiteData, {
      websiteId: websiteId,
      userId: args.userId,
      dataType: "scrapeResults"
    });
    
    await ctx.scheduler.runAfter(0, internal.websites.deleteWebsiteData, {
      websiteId: websiteId,
      userId: args.userId,
      dataType: "changeAlerts"
    });
    
    if (website.monitorType === "full_site") {
      await ctx.scheduler.runAfter(0, internal.websites.deleteWebsiteData, {
        websiteId: websiteId,
        userId: args.userId,
        dataType: "crawlSessions"
      });
    }

    // Delete the website immediately
    await ctx.db.delete(websiteId);
    
    return true;
  },
});

// Update scrape result with AI analysis
export const updateScrapeResultAIAnalysis = internalMutation({
  args: {
    scrapeResultId: v.id("scrapeResults"),
    analysis: v.object({
      meaningfulChangeScore: v.number(),
      isMeaningfulChange: v.boolean(),
      reasoning: v.string(),
      analyzedAt: v.number(),
      model: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.scrapeResultId, {
      aiAnalysis: args.analysis,
    });
  },
});

// Get a specific scrape result (internal)
export const getScrapeResult = internalQuery({
  args: {
    scrapeResultId: v.id("scrapeResults"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.scrapeResultId);
  },
});
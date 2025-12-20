import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import FirecrawlApp from "@mendable/firecrawl-js";
import { requireCurrentUserForAction } from "./helpers";

// Initialize Firecrawl client with user's API key
export const getFirecrawlClient = async (ctx: any, userId: string) => {
  // First try to get user's API key from internal query
  const userKeyData = await ctx.runQuery(internal.firecrawlKeys.getDecryptedFirecrawlKey, { userId });
  
  if (userKeyData && userKeyData.key) {
    // Using user's Firecrawl API key
    // Update last used timestamp
    await ctx.runMutation(internal.firecrawlKeys.updateLastUsed, { keyId: userKeyData.keyId });
    return new FirecrawlApp({ apiKey: userKeyData.key });
  }
  
  // Fallback to environment variable if user hasn't set their own key
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.error("No Firecrawl API key found in environment or user settings");
    throw new Error("No Firecrawl API key found. Please add your API key in settings.");
  }
  // Using environment Firecrawl API key
  return new FirecrawlApp({ apiKey });
};

// Scrape a URL and track changes
export const scrapeUrl = internalAction({
  args: {
    websiteId: v.id("websites"),
    url: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    scrapeResultId: Id<"scrapeResults">;
    changeStatus: string | undefined;
    visibility: string | undefined;
    previousScrapeAt: string | undefined;
  }> => {
    const firecrawl = await getFirecrawlClient(ctx, args.userId);

    try {
      // Scraping URL with change tracking
      // Scrape with change tracking - markdown is required for changeTracking
      const result = await firecrawl.scrapeUrl(args.url, {
        formats: ["markdown", "changeTracking"],
        changeTrackingOptions: {
          modes: ["git-diff"], // Enable git-diff to see what changed
        }
      }) as any;

      if (!result.success) {
        throw new Error(`Firecrawl scrape failed: ${result.error}`);
      }

      // Log only essential info, not the full response
      
      // Firecrawl returns markdown directly on the result object
      const markdown = result?.markdown || "";
      const changeTracking = result?.changeTracking;
      const metadata = result?.metadata;
      
      // Log only essential change status
      if (changeTracking?.changeStatus === "changed") {
        console.log(`Change detected for ${args.url}: ${changeTracking.changeStatus}`);
      }

      // Store the scrape result
      const scrapeResultId = await ctx.runMutation(internal.websites.storeScrapeResult, {
        websiteId: args.websiteId,
        userId: args.userId,
        markdown: markdown,
        changeStatus: changeTracking?.changeStatus || "new",
        visibility: changeTracking?.visibility || "visible",
        previousScrapeAt: changeTracking?.previousScrapeAt
          ? new Date(changeTracking.previousScrapeAt).getTime()
          : undefined,
        scrapedAt: Date.now(),
        firecrawlMetadata: metadata,
        ogImage: metadata?.ogImage || undefined,
        title: metadata?.title || undefined,
        description: metadata?.description || undefined,
        url: args.url, // Pass the actual URL that was scraped
        diff: changeTracking?.diff ? {
          text: changeTracking.diff.text || "",
          json: changeTracking.diff.json || null,
        } : undefined,
      }) as Id<"scrapeResults">;

      // If content changed, create an alert and send notifications
      if (changeTracking?.changeStatus === "changed" || changeTracking?.diff) {
        const diffPreview = changeTracking?.diff?.text ? 
          changeTracking.diff.text.substring(0, 200) + (changeTracking.diff.text.length > 200 ? "..." : "") :
          "Website content has changed since last check";
          
        await ctx.runMutation(internal.websites.createChangeAlert, {
          websiteId: args.websiteId,
          userId: args.userId,
          scrapeResultId,
          changeType: "content_changed",
          summary: diffPreview,
        });

        // Trigger AI analysis if enabled and there's a diff
        if (changeTracking?.diff) {
          await ctx.scheduler.runAfter(0, internal.aiAnalysis.analyzeChange, {
            userId: args.userId,
            scrapeResultId,
            websiteName: metadata?.title || args.url,
            websiteUrl: args.url,
            diff: changeTracking.diff,
          });
        }

        // Get user settings to check if AI analysis is enabled
        const userSettings = await ctx.runQuery(internal.userSettings.getUserSettingsInternal, {
          userId: args.userId,
        });

        // If AI analysis is NOT enabled, send notifications immediately
        if (!userSettings?.aiAnalysisEnabled || !changeTracking?.diff) {
          // Get website details for notifications
          const website = await ctx.runQuery(internal.websites.getWebsite, {
            websiteId: args.websiteId,
            userId: args.userId,
          });

          if (website && website.notificationPreference !== "none") {
            const notifPref = website.notificationPreference;
            
            // Send webhook notification (for generic webhooks)
            if ((notifPref === "webhook" || notifPref === "both" || notifPref === "all") && website.webhookUrl) {
              await ctx.scheduler.runAfter(0, internal.notifications.sendWebhookNotification, {
                webhookUrl: website.webhookUrl,
                websiteId: args.websiteId,
                websiteName: website.name,
                websiteUrl: args.url,
                scrapeResultId,
                changeType: "content_changed",
                changeStatus: changeTracking.changeStatus,
                diff: changeTracking?.diff,
                title: metadata?.title,
                description: metadata?.description,
                markdown: markdown,
                scrapedAt: Date.now(),
              });
            }

            // Send Discord notification (dedicated Discord webhook)
            if ((notifPref === "discord" || notifPref === "all") && website.discordWebhookUrl) {
              await ctx.scheduler.runAfter(0, internal.notifications.sendDiscordNotification, {
                webhookUrl: website.discordWebhookUrl,
                websiteId: args.websiteId,
                websiteName: website.name,
                websiteUrl: args.url,
                scrapeResultId,
                changeType: "content_changed",
                changeStatus: changeTracking.changeStatus,
                diff: changeTracking?.diff,
                title: metadata?.title,
                description: metadata?.description,
                scrapedAt: Date.now(),
              });
            }

            // Send email notification
            if (notifPref === "email" || notifPref === "both" || notifPref === "all") {
              // Get user's email configuration
              const emailConfig = await ctx.runQuery(internal.emailManager.getEmailConfigInternal, {
                userId: args.userId,
              });
              
              if (emailConfig?.email && emailConfig.isVerified) {
                await ctx.scheduler.runAfter(0, internal.notifications.sendEmailNotification, {
                  email: emailConfig.email,
                  websiteName: website.name,
                  websiteUrl: args.url,
                  changeType: "content_changed",
                  changeStatus: changeTracking.changeStatus,
                  diff: changeTracking?.diff,
                  title: metadata?.title,
                  scrapedAt: Date.now(),
                  userId: args.userId,
                });
              }
            }
          }
        }
        // If AI analysis IS enabled, notifications will be handled by the AI analysis callback
      }

      return {
        success: true,
        scrapeResultId,
        changeStatus: changeTracking?.changeStatus,
        visibility: changeTracking?.visibility,
        previousScrapeAt: changeTracking?.previousScrapeAt,
      };
    } catch (error) {
      console.error("Firecrawl scrape error:", error);
      throw error;
    }
  },
});

// Public action to initiate a manual scrape
export const triggerScrape = action({
  args: {
    websiteId: v.id("websites"),
  },
  handler: async (ctx, args) => {
    const userId = await requireCurrentUserForAction(ctx);

    // Get website details
    const website = await ctx.runQuery(internal.websites.getWebsite, {
      websiteId: args.websiteId,
      userId: userId,
    });

    if (!website) {
      throw new Error("Website not found");
    }

    // Create immediate checking status entry
    await ctx.runMutation(internal.websites.createCheckingStatus, {
      websiteId: args.websiteId,
      userId: userId,
    });

    // Update lastChecked immediately to prevent duplicate checks
    await ctx.runMutation(internal.websites.updateLastChecked, {
      websiteId: args.websiteId,
    });

    // Trigger the appropriate check based on monitor type
    if (website.monitorType === "full_site") {
      // For full site, perform a crawl
      await ctx.scheduler.runAfter(0, internal.crawl.performCrawl, {
        websiteId: args.websiteId,
        userId: userId,
      });
    } else {
      // For single page, just scrape the URL
      await ctx.scheduler.runAfter(0, internal.firecrawl.scrapeUrl, {
        websiteId: args.websiteId,
        url: website.url,
        userId: userId,
      });
    }

    return { success: true };
  },
});

// Crawl an entire website (for initial setup or full refresh)
export const crawlWebsite = action({
  args: {
    url: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireCurrentUserForAction(ctx);

    const firecrawl = await getFirecrawlClient(ctx, userId);

    try {
      const crawlResult = await firecrawl.crawlUrl(args.url, {
        limit: args.limit || 10,
        scrapeOptions: {
          formats: ["markdown", "changeTracking"],
        },
      }) as any;

      if (!crawlResult.success) {
        throw new Error(`Firecrawl crawl failed: ${crawlResult.error}`);
      }

      return {
        success: true,
        totalPages: crawlResult.data?.length || 0,
        pages: crawlResult.data?.map((page: any) => ({
          url: page.url,
          title: page.metadata?.title,
          changeStatus: page.changeTracking?.changeStatus,
          visibility: page.changeTracking?.visibility,
        })),
      };
    } catch (error) {
      console.error("Firecrawl crawl error:", error);
      throw error;
    }
  },
});
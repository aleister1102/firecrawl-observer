import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { getFirecrawlClient, isCreditsExhausted } from "./firecrawl";

// Perform a crawl for a full site monitor
export const performCrawl = internalAction({
  args: {
    websiteId: v.id("websites"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Starting crawl for website

    // Get website details
    const website = await ctx.runQuery(internal.websites.getWebsite, {
      websiteId: args.websiteId,
      userId: args.userId,
    });

    if (!website || website.monitorType !== "full_site") {
      throw new Error("Website not found or not a full site monitor");
    }

    // Starting full crawl with configured settings

    // Update lastChecked immediately to prevent duplicate crawls
    await ctx.runMutation(internal.websites.updateLastChecked, {
      websiteId: args.websiteId,
    });

    // Create crawl session
    const sessionId = await ctx.runMutation(internal.crawl.createCrawlSession, {
      websiteId: args.websiteId,
      userId: args.userId,
    });

    try {
      // Perform the crawl using Firecrawl
      const { client: firecrawl, keyId } = await getFirecrawlClient(ctx, args.userId);

      // Initiating Firecrawl crawl

      // Start the crawl - this might return a job ID instead of immediate results
      const crawlResponse = await firecrawl.crawlUrl(website.url, {
        limit: website.crawlLimit || 10,
        maxDepth: website.crawlDepth || 3,
        scrapeOptions: {
          formats: ["markdown", "changeTracking"],
          skipTlsVerification: website.skipTlsVerification,
        },
      }) as any;

      console.log(`Crawl response received, jobId: ${crawlResponse.jobId || crawlResponse.id || 'N/A'}`);

      // Check if it's an async crawl job
      if (crawlResponse.jobId || crawlResponse.id) {
        const jobId = crawlResponse.jobId || crawlResponse.id;
        console.log(`Crawl started with job ID: ${jobId}`);

        // Store the job ID in the crawl session
        await ctx.runMutation(internal.crawl.updateCrawlSessionJobId, {
          sessionId,
          jobId,
        });

        // Schedule job status checking
        await ctx.scheduler.runAfter(5000, internal.crawl.checkCrawlJobStatus, {
          sessionId,
          jobId,
          websiteId: args.websiteId,
          userId: args.userId,
          attempt: 1,
        });

        return { success: true, pagesFound: 0, jobId };
      }

      // If we got immediate results (synchronous crawl)
      if (!crawlResponse.success) {
        throw new Error(`Firecrawl crawl failed: ${crawlResponse.error}`);
      }

      const pages = crawlResponse.data || [];

      // Process each page from the crawl
      for (const page of pages) {
        const pageUrl = page.url || page.metadata?.url;
        if (!pageUrl) continue;

        // Only store if there's actual content
        if (page.markdown) {
          const scrapeResultId = await ctx.runMutation(internal.websites.storeScrapeResult, {
            websiteId: args.websiteId,
            userId: args.userId,
            markdown: page.markdown,
            changeStatus: page.changeTracking?.changeStatus || "new",
            visibility: page.changeTracking?.visibility || "visible",
            previousScrapeAt: page.changeTracking?.previousScrapeAt
              ? new Date(page.changeTracking.previousScrapeAt).getTime()
              : undefined,
            scrapedAt: Date.now(),
            firecrawlMetadata: page.metadata,
            ogImage: page.metadata?.ogImage,
            title: page.metadata?.title,
            description: page.metadata?.description,
            url: pageUrl, // Pass the actual URL
            diff: page.changeTracking?.diff ? {
              text: page.changeTracking.diff.text || "",
              json: page.changeTracking.diff.json || null,
            } : undefined,
          });

          // Handle notifications for changed pages
          if (page.changeTracking?.changeStatus === "changed" && page.changeTracking?.diff) {
            await ctx.runMutation(internal.websites.createChangeAlert, {
              websiteId: args.websiteId,
              userId: args.userId,
              scrapeResultId: scrapeResultId,
              changeType: "content_changed",
              summary: page.changeTracking.diff.text?.substring(0, 200) + "..." || "Page content changed",
            });
          }
        }
      }

      // Complete the crawl session
      await ctx.runMutation(internal.crawl.completeCrawlSession, {
        sessionId,
        pagesFound: pages.length,
        websiteId: args.websiteId,
      });

      // Don't send crawl summary webhook - individual page changes will trigger their own webhooks

      return { success: true, pagesFound: pages.length };
    } catch (error) {
      // Check for credit exhaustion
      const { keyId } = await getFirecrawlClient(ctx, args.userId);
      if (isCreditsExhausted(error) && keyId) {
        console.warn(`Credits exhausted for key ${keyId}. Marking as exhausted.`);
        await ctx.runMutation(internal.firecrawlKeys.markKeyExhausted, { keyId });
      }

      // Mark session as failed
      await ctx.runMutation(internal.crawl.failCrawlSession, {
        sessionId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  },
});

// Create a new crawl session
export const createCrawlSession = internalMutation({
  args: {
    websiteId: v.id("websites"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("crawlSessions", {
      websiteId: args.websiteId,
      userId: args.userId,
      startedAt: Date.now(),
      status: "running",
      pagesFound: 0,
    });
  },
});

// Removed storeCrawledPage - no longer needed since we re-crawl each time

// Complete a crawl session
export const completeCrawlSession = internalMutation({
  args: {
    sessionId: v.id("crawlSessions"),
    pagesFound: v.number(),
    websiteId: v.id("websites"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      completedAt: Date.now(),
      status: "completed",
      pagesFound: args.pagesFound,
    });

    // Update website with total pages and last crawl time
    await ctx.db.patch(args.websiteId, {
      totalPages: args.pagesFound,
      lastCrawlAt: Date.now(),
      lastChecked: Date.now(),
    });
  },
});

// Mark crawl session as failed
export const failCrawlSession = internalMutation({
  args: {
    sessionId: v.id("crawlSessions"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      completedAt: Date.now(),
      status: "failed",
      error: args.error,
    });
  },
});

// Check all pages in a full site monitor
export const checkCrawledPages = internalAction({
  args: {
    websiteId: v.id("websites"),
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<{ pagesChecked: number; errors: number } | undefined> => {
    const website = await ctx.runQuery(internal.websites.getWebsite, {
      websiteId: args.websiteId,
      userId: args.userId,
    });

    if (!website) return;

    // For full site monitors, we should re-crawl to find new pages
    // instead of just checking existing pages
    if (website.monitorType === "full_site") {
      // Perform a full crawl to discover any new pages
      await ctx.scheduler.runAfter(0, internal.crawl.performCrawl, {
        websiteId: args.websiteId,
        userId: args.userId,
      });

      return {
        pagesChecked: 0, // Will be updated by the crawl
        errors: 0,
      };
    }

    // For single page monitors (shouldn't reach here but just in case)
    await ctx.scheduler.runAfter(0, internal.firecrawl.scrapeUrl, {
      websiteId: args.websiteId,
      url: website.url,
      userId: args.userId,
    });

    return {
      pagesChecked: 1,
      errors: 0,
    };
  },
});

// Get crawl session by ID
export const getCrawlSession = internalQuery({
  args: {
    sessionId: v.id("crawlSessions"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sessionId);
  },
});

// Update crawl session with job ID
export const updateCrawlSessionJobId = internalMutation({
  args: {
    sessionId: v.id("crawlSessions"),
    jobId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      jobId: args.jobId,
    });
  },
});

// Check the status of an async crawl job
export const checkCrawlJobStatus = internalAction({
  args: {
    sessionId: v.id("crawlSessions"),
    jobId: v.string(),
    websiteId: v.id("websites"),
    userId: v.id("users"),
    attempt: v.number(),
  },
  handler: async (ctx, args) => {
    console.log(`Checking crawl job status: ${args.jobId} (attempt ${args.attempt})`);

    try {
      const { client: firecrawl, keyId } = await getFirecrawlClient(ctx, args.userId);

      // Check job status
      const status = await firecrawl.checkCrawlStatus(args.jobId) as any;

      // Check if crawl is complete
      console.log(`Crawl job ${args.jobId} status: ${status.status}`);

      if (status.status === "completed" && status.data) {
        console.log(`Crawl completed with ${status.data.length} pages`);

        // Process each page from the crawl
        for (const page of status.data) {
          const pageUrl = page.url || page.metadata?.url;
          if (!pageUrl) continue;

          // Only store if there's actual content
          if (page.markdown) {
            const scrapeResultId = await ctx.runMutation(internal.websites.storeScrapeResult, {
              websiteId: args.websiteId,
              userId: args.userId,
              markdown: page.markdown,
              changeStatus: page.changeTracking?.changeStatus || "new",
              visibility: page.changeTracking?.visibility || "visible",
              previousScrapeAt: page.changeTracking?.previousScrapeAt
                ? new Date(page.changeTracking.previousScrapeAt).getTime()
                : undefined,
              scrapedAt: Date.now(),
              firecrawlMetadata: page.metadata,
              ogImage: page.metadata?.ogImage,
              title: page.metadata?.title,
              description: page.metadata?.description,
              url: pageUrl, // Pass the actual URL
              diff: page.changeTracking?.diff ? {
                text: page.changeTracking.diff.text || "",
                json: page.changeTracking.diff.json || null,
              } : undefined,
            });

            // Handle notifications for changed pages
            if (page.changeTracking?.changeStatus === "changed" && page.changeTracking?.diff) {
              await ctx.runMutation(internal.websites.createChangeAlert, {
                websiteId: args.websiteId,
                userId: args.userId,
                scrapeResultId: scrapeResultId,
                changeType: "content_changed",
                summary: page.changeTracking.diff.text?.substring(0, 200) + "..." || "Page content changed",
              });
            }
          }
        }

        // Complete the crawl session
        await ctx.runMutation(internal.crawl.completeCrawlSession, {
          sessionId: args.sessionId,
          pagesFound: status.data.length,
          websiteId: args.websiteId,
        });

        return { success: true, pagesFound: status.data.length };
      } else if (status.status === "failed" || status.status === "error") {
        throw new Error(`Crawl job failed: ${status.error || "Unknown error"}`);
      } else {
        // Still in progress, check again later
        // Still in progress, will check again

        // Limit retries to prevent infinite loops
        if (args.attempt < 60) { // Max 10 minutes of checking
          await ctx.scheduler.runAfter(10000, internal.crawl.checkCrawlJobStatus, {
            sessionId: args.sessionId,
            jobId: args.jobId,
            websiteId: args.websiteId,
            userId: args.userId,
            attempt: args.attempt + 1,
          });
        } else {
          throw new Error("Crawl job timed out after 10 minutes");
        }
      }
    } catch (error) {
      // Check for credit exhaustion
      const { keyId } = await getFirecrawlClient(ctx, args.userId);
      if (isCreditsExhausted(error) && keyId) {
        console.warn(`Credits exhausted for key ${keyId}. Marking as exhausted.`);
        await ctx.runMutation(internal.firecrawlKeys.markKeyExhausted, { keyId });
      }

      // Mark session as failed
      await ctx.runMutation(internal.crawl.failCrawlSession, {
        sessionId: args.sessionId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  },
});
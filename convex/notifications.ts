import { internalAction, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { resend } from "./alertEmail";
import { sanitizeHtml } from "./lib/sanitize";

export const sendWebhookNotification = internalAction({
  args: {
    webhookUrl: v.string(),
    websiteId: v.id("websites"),
    websiteName: v.string(),
    websiteUrl: v.string(),
    scrapeResultId: v.id("scrapeResults"),
    changeType: v.string(),
    changeStatus: v.string(),
    diff: v.optional(v.object({
      text: v.string(),
      json: v.any(),
    })),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    markdown: v.string(),
    scrapedAt: v.number(),
    aiAnalysis: v.optional(v.object({
      meaningfulChangeScore: v.number(),
      isMeaningfulChange: v.boolean(),
      reasoning: v.string(),
      analyzedAt: v.number(),
      model: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const payload = {
      event: "website_changed",
      timestamp: new Date().toISOString(),
      website: {
        id: args.websiteId,
        name: args.websiteName,
        url: args.websiteUrl,
      },
      change: {
        detectedAt: new Date(args.scrapedAt).toISOString(),
        changeType: args.changeType,
        changeStatus: args.changeStatus,
        summary: args.diff?.text ? 
          args.diff.text.substring(0, 200) + (args.diff.text.length > 200 ? "..." : "") :
          "Website content has changed",
        diff: args.diff ? {
          added: args.diff.text.split('\n')
            .filter(line => line.startsWith('+') && !line.startsWith('+++'))
            .map(line => line.substring(1)),
          removed: args.diff.text.split('\n')
            .filter(line => line.startsWith('-') && !line.startsWith('---'))
            .map(line => line.substring(1)),
        } : undefined,
      },
      scrapeResult: {
        id: args.scrapeResultId,
        title: args.title,
        description: args.description,
        markdown: args.markdown.substring(0, 1000) + (args.markdown.length > 1000 ? "..." : ""),
      },
      aiAnalysis: args.aiAnalysis ? {
        meaningfulChangeScore: args.aiAnalysis.meaningfulChangeScore,
        isMeaningfulChange: args.aiAnalysis.isMeaningfulChange,
        reasoning: args.aiAnalysis.reasoning,
        analyzedAt: new Date(args.aiAnalysis.analyzedAt).toISOString(),
        model: args.aiAnalysis.model,
      } : undefined,
    };

    try {
      console.log(`Sending webhook to ${args.webhookUrl}`);
      
      // Check if the webhook URL is localhost or a private network
      const isLocalhost = args.webhookUrl.includes('localhost') || 
                         args.webhookUrl.includes('127.0.0.1') ||
                         args.webhookUrl.includes('0.0.0.0') ||
                         args.webhookUrl.includes('192.168.') ||
                         args.webhookUrl.includes('10.') ||
                         args.webhookUrl.includes('172.');

      // Check if this is a Discord webhook
      const isDiscordWebhook = args.webhookUrl.includes('discord.com/api/webhooks');

      // Format payload for Discord if needed
      let finalPayload: unknown = payload;
      if (isDiscordWebhook) {
        // Discord has a 1024 character limit for field values
        const maxFieldLength = 1000;
        const changeSummary = args.diff?.text ? 
          args.diff.text.substring(0, maxFieldLength - 20) + (args.diff.text.length > maxFieldLength - 20 ? "..." : "") :
          "Website content has changed";
        
        // Truncate AI reasoning to fit Discord limits
        const aiReasoning = args.aiAnalysis?.reasoning 
          ? args.aiAnalysis.reasoning.substring(0, 180) + (args.aiAnalysis.reasoning.length > 180 ? "..." : "")
          : "";
        
        // Build fields array
        const fields: Array<{ name: string; value: string; inline: boolean }> = [
          {
            name: "Website",
            value: `[${args.websiteName.substring(0, 100)}](${args.websiteUrl})`,
            inline: true,
          },
          {
            name: "Change Type",
            value: args.changeStatus || "changed",
            inline: true,
          },
          {
            name: "Detected At",
            value: new Date(args.scrapedAt).toLocaleString(),
            inline: true,
          },
        ];

        // Add AI analysis field if available
        if (args.aiAnalysis) {
          fields.push({
            name: "AI Analysis",
            value: `Score: ${args.aiAnalysis.meaningfulChangeScore}% | Meaningful: ${args.aiAnalysis.isMeaningfulChange ? 'Yes' : 'No'}\n${aiReasoning}`,
            inline: false,
          });
        }

        // Add change summary field - ensure it's not empty
        const diffContent = changeSummary.trim() || "No diff content available";
        fields.push({
          name: "Change Summary",
          value: `\`\`\`diff\n${diffContent}\n\`\`\``,
          inline: false,
        });

        finalPayload = {
          embeds: [{
            title: `🔔 Change Detected: ${args.websiteName.substring(0, 200)}`,
            url: args.websiteUrl,
            color: 0xEA580C, // Orange color
            fields,
            footer: {
              text: "Firecrawl Observer",
            },
            timestamp: new Date().toISOString(),
          }],
        };
      }

      if (isLocalhost) {
        // Use the webhook proxy for localhost/private network URLs
        const proxyUrl = `${process.env.CONVEX_SITE_URL}/api/webhook-proxy`;
        console.log(`Using webhook proxy for localhost URL: ${proxyUrl}`);
        
        const response = await fetch(proxyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            targetUrl: args.webhookUrl,
            payload: finalPayload,
          }),
        });

        if (!response.ok) {
          const errorData = await response.text();
          console.error(`Webhook proxy failed: ${response.status} ${errorData}`);
          throw new Error(`Webhook proxy failed with status ${response.status}`);
        }

        const responseData = await response.json();
        console.log(`Webhook sent successfully via proxy:`, responseData);
        
        return { success: responseData.success, status: responseData.status };
      } else {
        // Direct request for public URLs
        const response = await fetch(args.webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Firecrawl-Observer/1.0',
          },
          body: JSON.stringify(finalPayload),
        });

        if (!response.ok) {
          console.error(`Webhook failed: ${response.status} ${response.statusText}`);
          throw new Error(`Webhook failed with status ${response.status}`);
        }

        const responseData = await response.text();
        console.log(`Webhook sent successfully: ${responseData}`);
        
        return { success: true, status: response.status };
      }
    } catch (error) {
      console.error("Failed to send webhook:", error);
      throw error;
    }
  },
});

export const sendEmailNotification = internalAction({
  args: {
    email: v.string(),
    websiteName: v.string(),
    websiteUrl: v.string(),
    changeType: v.string(),
    changeStatus: v.string(),
    diff: v.optional(v.object({
      text: v.string(),
      json: v.any(),
    })),
    title: v.optional(v.string()),
    scrapedAt: v.number(),
    userId: v.id("users"),
    aiAnalysis: v.optional(v.object({
      meaningfulChangeScore: v.number(),
      isMeaningfulChange: v.boolean(),
      reasoning: v.string(),
      analyzedAt: v.number(),
      model: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    try {
      // Get user's custom email template
      const userSettings = await ctx.runQuery(internal.userSettings.getUserSettingsInternal, {
        userId: args.userId,
      });

      const fromEmail = process.env.FROM_EMAIL || 'noreply@example.com';
      const appName = process.env.APP_NAME || 'Firecrawl Observer';
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

      let htmlContent = '';
      
      if (userSettings?.emailTemplate) {
        // Use custom template with variable replacements
        let processedTemplate = userSettings.emailTemplate
          .replace(/{{websiteName}}/g, args.websiteName)
          .replace(/{{websiteUrl}}/g, args.websiteUrl)
          .replace(/{{changeDate}}/g, new Date(args.scrapedAt).toLocaleString())
          .replace(/{{changeType}}/g, args.changeStatus)
          .replace(/{{pageTitle}}/g, args.title || 'N/A')
          .replace(/{{viewChangesUrl}}/g, appUrl)
          .replace(/{{aiMeaningfulScore}}/g, args.aiAnalysis?.meaningfulChangeScore?.toString() || 'N/A')
          .replace(/{{aiIsMeaningful}}/g, args.aiAnalysis?.isMeaningfulChange ? 'Yes' : 'No')
          .replace(/{{aiReasoning}}/g, args.aiAnalysis?.reasoning || 'N/A')
          .replace(/{{aiModel}}/g, args.aiAnalysis?.model || 'N/A')
          .replace(/{{aiAnalyzedAt}}/g, args.aiAnalysis?.analyzedAt ? new Date(args.aiAnalysis.analyzedAt).toLocaleString() : 'N/A');
        
        // Sanitize the HTML to prevent XSS
        htmlContent = sanitizeHtml(processedTemplate);
      } else {
        // Use default template
        htmlContent = `
          <h2>Website Change Alert</h2>
          <p>We've detected changes on the website you're monitoring:</p>
          <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3>${args.websiteName}</h3>
            <p><a href="${args.websiteUrl}">${args.websiteUrl}</a></p>
            <p><strong>Changed at:</strong> ${new Date(args.scrapedAt).toLocaleString()}</p>
            ${args.title ? `<p><strong>Page Title:</strong> ${args.title}</p>` : ''}
            ${args.aiAnalysis ? `
              <div style="background: #e8f4f8; border-left: 4px solid #2196F3; padding: 12px; margin: 15px 0;">
                <h4 style="margin: 0 0 8px 0; color: #1976D2;">AI Analysis</h4>
                <p><strong>Meaningful Change:</strong> ${args.aiAnalysis.isMeaningfulChange ? 'Yes' : 'No'} (${args.aiAnalysis.meaningfulChangeScore}% score)</p>
                <p><strong>Reasoning:</strong> ${args.aiAnalysis.reasoning}</p>
                <p style="font-size: 12px; color: #666; margin: 8px 0 0 0;">Analyzed by ${args.aiAnalysis.model} at ${new Date(args.aiAnalysis.analyzedAt).toLocaleString()}</p>
              </div>
            ` : ''}
          </div>
          <p><a href="${appUrl}" style="background: #ff6600; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Changes</a></p>
        `;
      }

      console.log(`Sending email notification to ${args.email} for ${args.websiteName}`);

      await resend.sendEmail(ctx, {
        from: `${appName} <${fromEmail}>`,
        to: args.email,
        subject: `Changes detected on ${args.websiteName}`,
        html: htmlContent,
      });

      console.log(`Email notification sent successfully to ${args.email}`);
    } catch (error) {
      console.error(`Failed to send email notification to ${args.email}:`, error);
      throw error;
    }
  },
});

export const sendCrawlWebhook = internalAction({
  args: {
    webhookUrl: v.string(),
    websiteId: v.id("websites"),
    websiteName: v.string(),
    websiteUrl: v.string(),
    sessionId: v.id("crawlSessions"),
    pagesFound: v.number(),
  },
  handler: async (ctx, args): Promise<{ success: boolean; status: number } | undefined> => {
    // Get crawl session details
    const session = await ctx.runQuery(internal.crawl.getCrawlSession, {
      sessionId: args.sessionId,
    });

    if (!session) return;

    const payload = {
      event: "crawl_completed",
      timestamp: new Date().toISOString(),
      website: {
        id: args.websiteId,
        name: args.websiteName,
        url: args.websiteUrl,
        type: "full_site",
      },
      crawlSummary: {
        sessionId: args.sessionId,
        startedAt: new Date(session.startedAt).toISOString(),
        completedAt: session.completedAt ? new Date(session.completedAt).toISOString() : null,
        pagesFound: args.pagesFound,
        duration: session.completedAt ? `${Math.round((session.completedAt - session.startedAt) / 1000)}s` : null,
      },
      // Individual page changes are now tracked separately via change alerts
      note: "Individual page changes trigger separate notifications with detailed diffs",
    };

    try {
      console.log(`Sending crawl webhook to ${args.webhookUrl}`);
      
      // Check if the webhook URL is localhost or a private network
      const isLocalhost = args.webhookUrl.includes('localhost') || 
                         args.webhookUrl.includes('127.0.0.1') ||
                         args.webhookUrl.includes('0.0.0.0') ||
                         args.webhookUrl.includes('192.168.') ||
                         args.webhookUrl.includes('10.') ||
                         args.webhookUrl.includes('172.');

      // Check if this is a Discord webhook
      const isDiscordWebhook = args.webhookUrl.includes('discord.com/api/webhooks');

      // Format payload for Discord if needed
      let finalPayload: unknown = payload;
      if (isDiscordWebhook) {
        // Build fields array with proper Discord limits
        const fields: Array<{ name: string; value: string; inline: boolean }> = [
          {
            name: "Website",
            value: `[${args.websiteName.substring(0, 100)}](${args.websiteUrl})`,
            inline: true,
          },
          {
            name: "Pages Found",
            value: args.pagesFound.toString(),
            inline: true,
          },
          {
            name: "Started At",
            value: new Date(session.startedAt).toLocaleString(),
            inline: true,
          },
        ];

        if (session.completedAt) {
          fields.push({
            name: "Duration",
            value: `${Math.round((session.completedAt - session.startedAt) / 1000)}s`,
            inline: true,
          });
        }

        finalPayload = {
          embeds: [{
            title: `🕷️ Crawl Completed: ${args.websiteName.substring(0, 200)}`,
            url: args.websiteUrl,
            color: 0x22C55E, // Green color
            fields,
            footer: {
              text: "Firecrawl Observer",
            },
            timestamp: new Date().toISOString(),
          }],
        };
      }

      if (isLocalhost) {
        // Use the webhook proxy for localhost/private network URLs
        const proxyUrl = `${process.env.CONVEX_SITE_URL}/api/webhook-proxy`;
        console.log(`Using webhook proxy for localhost URL: ${proxyUrl}`);
        
        const response = await fetch(proxyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            targetUrl: args.webhookUrl,
            payload: finalPayload,
          }),
        });

        if (!response.ok) {
          const errorData = await response.text();
          console.error(`Crawl webhook proxy failed: ${response.status} ${errorData}`);
          throw new Error(`Webhook proxy failed with status ${response.status}`);
        }

        const responseData = await response.json();
        console.log(`Crawl webhook sent successfully via proxy:`, responseData);
        
        return { success: responseData.success, status: responseData.status };
      } else {
        // Direct request for public URLs
        const response = await fetch(args.webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Firecrawl-Observer/1.0',
          },
          body: JSON.stringify(finalPayload),
        });

        if (!response.ok) {
          console.error(`Crawl webhook failed: ${response.status} ${response.statusText}`);
          throw new Error(`Webhook failed with status ${response.status}`);
        }

        console.log(`Crawl webhook sent successfully`);
        return { success: true, status: response.status };
      }
    } catch (error) {
      console.error("Failed to send crawl webhook:", error);
      throw error;
    }
  },
});


// Dedicated Discord webhook notification with rich embeds
export const sendDiscordNotification = internalAction({
  args: {
    webhookUrl: v.string(),
    websiteId: v.id("websites"),
    websiteName: v.string(),
    websiteUrl: v.string(),
    scrapeResultId: v.id("scrapeResults"),
    changeType: v.string(),
    changeStatus: v.string(),
    diff: v.optional(v.object({
      text: v.string(),
      json: v.any(),
    })),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    scrapedAt: v.number(),
    aiAnalysis: v.optional(v.object({
      meaningfulChangeScore: v.number(),
      isMeaningfulChange: v.boolean(),
      reasoning: v.string(),
      analyzedAt: v.number(),
      model: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    try {
      console.log(`Sending Discord notification to webhook for ${args.websiteName}`);
      
      // Discord has a 1024 character limit for field values
      const maxFieldLength = 1000;
      const changeSummary = args.diff?.text 
        ? args.diff.text.substring(0, maxFieldLength - 20) + (args.diff.text.length > maxFieldLength - 20 ? "..." : "")
        : "Website content has changed";
      
      // Truncate AI reasoning to fit Discord limits
      const aiReasoning = args.aiAnalysis?.reasoning 
        ? args.aiAnalysis.reasoning.substring(0, 180) + (args.aiAnalysis.reasoning.length > 180 ? "..." : "")
        : "";
      
      // Build fields array
      const fields: Array<{ name: string; value: string; inline: boolean }> = [
        {
          name: "🌐 Website",
          value: `[${args.websiteName.substring(0, 100)}](${args.websiteUrl})`,
          inline: true,
        },
        {
          name: "📝 Change Type",
          value: args.changeStatus || "changed",
          inline: true,
        },
        {
          name: "🕐 Detected At",
          value: new Date(args.scrapedAt).toLocaleString(),
          inline: true,
        },
      ];

      // Add page title if available
      if (args.title) {
        fields.push({
          name: "📄 Page Title",
          value: args.title.substring(0, 200),
          inline: false,
        });
      }

      // Add AI analysis field if available
      if (args.aiAnalysis) {
        const meaningfulEmoji = args.aiAnalysis.isMeaningfulChange ? "✅" : "⚪";
        fields.push({
          name: "🤖 AI Analysis",
          value: `${meaningfulEmoji} Score: **${args.aiAnalysis.meaningfulChangeScore}%** | Meaningful: **${args.aiAnalysis.isMeaningfulChange ? 'Yes' : 'No'}**\n${aiReasoning}`,
          inline: false,
        });
      }

      // Add change summary field - ensure it's not empty
      const diffContent = changeSummary.trim() || "No diff content available";
      fields.push({
        name: "📋 Change Summary",
        value: `\`\`\`diff\n${diffContent}\n\`\`\``,
        inline: false,
      });

      // Determine embed color based on AI analysis
      let embedColor = 0xEA580C; // Default orange
      if (args.aiAnalysis) {
        if (args.aiAnalysis.isMeaningfulChange) {
          embedColor = 0xEF4444; // Red for meaningful changes
        } else {
          embedColor = 0x6B7280; // Gray for non-meaningful changes
        }
      }

      const payload = {
        embeds: [{
          title: `🔔 Change Detected: ${args.websiteName.substring(0, 200)}`,
          url: args.websiteUrl,
          color: embedColor,
          fields,
          footer: {
            text: "Firecrawl Observer",
            icon_url: "https://firecrawl.dev/favicon.ico",
          },
          timestamp: new Date().toISOString(),
        }],
      };

      const response = await fetch(args.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Discord webhook failed: ${response.status} ${errorText}`);
        throw new Error(`Discord webhook failed with status ${response.status}: ${errorText}`);
      }

      console.log(`Discord notification sent successfully for ${args.websiteName}`);
      return { success: true, status: response.status };
    } catch (error) {
      console.error("Failed to send Discord notification:", error);
      throw error;
    }
  },
});

// Send Discord notification for crawl completion
export const sendDiscordCrawlNotification = internalAction({
  args: {
    webhookUrl: v.string(),
    websiteId: v.id("websites"),
    websiteName: v.string(),
    websiteUrl: v.string(),
    sessionId: v.id("crawlSessions"),
    pagesFound: v.number(),
    pagesChanged: v.optional(v.number()),
    pagesAdded: v.optional(v.number()),
    pagesRemoved: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      // Get crawl session details
      const session = await ctx.runQuery(internal.crawl.getCrawlSession, {
        sessionId: args.sessionId,
      });

      if (!session) {
        console.error("Crawl session not found for Discord notification");
        return;
      }

      console.log(`Sending Discord crawl notification for ${args.websiteName}`);

      // Build fields array
      const fields: Array<{ name: string; value: string; inline: boolean }> = [
        {
          name: "🌐 Website",
          value: `[${args.websiteName.substring(0, 100)}](${args.websiteUrl})`,
          inline: true,
        },
        {
          name: "📄 Pages Found",
          value: args.pagesFound.toString(),
          inline: true,
        },
        {
          name: "🕐 Started At",
          value: new Date(session.startedAt).toLocaleString(),
          inline: true,
        },
      ];

      if (session.completedAt) {
        const duration = Math.round((session.completedAt - session.startedAt) / 1000);
        fields.push({
          name: "⏱️ Duration",
          value: `${duration}s`,
          inline: true,
        });
      }

      // Add change statistics if available
      if (args.pagesChanged !== undefined || args.pagesAdded !== undefined || args.pagesRemoved !== undefined) {
        const stats = [];
        if (args.pagesChanged) stats.push(`📝 Changed: ${args.pagesChanged}`);
        if (args.pagesAdded) stats.push(`➕ Added: ${args.pagesAdded}`);
        if (args.pagesRemoved) stats.push(`➖ Removed: ${args.pagesRemoved}`);
        
        if (stats.length > 0) {
          fields.push({
            name: "📊 Changes",
            value: stats.join("\n"),
            inline: false,
          });
        }
      }

      const payload = {
        embeds: [{
          title: `🕷️ Crawl Completed: ${args.websiteName.substring(0, 200)}`,
          url: args.websiteUrl,
          color: 0x22C55E, // Green color
          fields,
          footer: {
            text: "Firecrawl Observer",
            icon_url: "https://firecrawl.dev/favicon.ico",
          },
          timestamp: new Date().toISOString(),
        }],
      };

      const response = await fetch(args.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Discord crawl webhook failed: ${response.status} ${errorText}`);
        throw new Error(`Discord webhook failed with status ${response.status}: ${errorText}`);
      }

      console.log(`Discord crawl notification sent successfully for ${args.websiteName}`);
      return { success: true, status: response.status };
    } catch (error) {
      console.error("Failed to send Discord crawl notification:", error);
      throw error;
    }
  },
});

import { components } from "./_generated/api";
import { Resend } from "@convex-dev/resend";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

// Initialize Resend component - API key is read from RESEND_API_KEY env var
export const resend: Resend = new Resend(components.resend);

// Test email function to verify Resend configuration
export const sendTestEmail = internalAction({
  args: {
    to: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const fromEmail = process.env.FROM_EMAIL || 'noreply@example.com';
      const appName = process.env.APP_NAME || 'Firecrawl Observer';
      
      console.log(`Sending test email to ${args.to} from ${appName} <${fromEmail}>`);
      
      await resend.sendEmail(ctx, {
        from: `${appName} <${fromEmail}>`,
        to: args.to,
        subject: "Test Email from Firecrawl Observer",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #EA580C;">🎉 Email Configuration Working!</h2>
            <p>This is a test email from Firecrawl Observer.</p>
            <p>If you received this, your email notifications are properly configured.</p>
            <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 32px 0;">
            <p style="color: #9CA3AF; font-size: 12px;">
              Firecrawl Observer - Website Change Monitoring
            </p>
          </div>
        `,
      });
      
      console.log(`Test email sent successfully to ${args.to}`);
      return { success: true, message: `Test email sent to ${args.to}` };
    } catch (error) {
      console.error("Failed to send test email:", error);
      throw error;
    }
  },
});

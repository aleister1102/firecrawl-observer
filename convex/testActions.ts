import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { requireCurrentUserForAction } from "./helpers";
import { api, internal } from "./_generated/api";
import { resend } from "./alertEmail";
import { sanitizeHtml } from "./lib/sanitize";

// Test AI model connection
export const testAIModel = action({
  handler: async (ctx): Promise<{
    success: boolean;
    message?: string;
    error?: string;
    model?: string;
    responseModel?: string;
    baseUrl?: string;
  }> => {
    const user = await requireCurrentUserForAction(ctx);
    
    // Get user settings
    const userSettings: any = await ctx.runQuery(api.userSettings.getUserSettings);
    
    if (!userSettings?.aiApiKey) {
      throw new Error("No API key configured");
    }
    
    if (!userSettings.aiAnalysisEnabled) {
      throw new Error("AI analysis is not enabled");
    }
    
    const baseUrl = userSettings.aiBaseUrl || "https://api.openai.com/v1";
    const apiUrl = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${userSettings.aiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: userSettings.aiModel || "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "You are a JSON response generator. You MUST respond with ONLY valid JSON, no markdown, no code blocks, no explanations. Start with { and end with }.",
            },
            {
              role: "user",
              content: `Generate a JSON response with exactly these fields:
{
  "status": "success",
  "message": "Connection successful",
  "model": "test"
}

IMPORTANT: Respond with ONLY the JSON object. No markdown. No code blocks. No extra text.`,
            },
          ],
          temperature: 0.1,
          max_tokens: 200,
          ...(userSettings.aiBaseUrl?.includes("openai") && { response_format: { type: "json_object" } }),
        }),
      });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error: ${response.status} - ${error}`);
      }
      
      const data = await response.json();
      const content = data.choices[0].message.content.trim();
      
      // Extract JSON from response (handles markdown code blocks and extra text)
      let jsonStr = content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
      
      const result = JSON.parse(jsonStr);
      
      return {
        success: true,
        message: result.message || "Connection successful",
        model: userSettings.aiModel,
        responseModel: result.model,
        baseUrl: baseUrl,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message || "Failed to connect to AI model",
        model: userSettings.aiModel,
        baseUrl: baseUrl,
      };
    }
  },
});

// Test email sending
export const testEmailSending = action({
  handler: async (ctx): Promise<{
    success: boolean;
    message: string;
  }> => {
    const user = await requireCurrentUserForAction(ctx);
    
    // Get user's email config
    const emailConfig: any = await ctx.runQuery(api.emailManager.getEmailConfig);
    
    if (!emailConfig?.email) {
      throw new Error("No email configured");
    }
    
    if (!emailConfig.isVerified) {
      throw new Error("Email is not verified");
    }
    
    // Get user settings for template
    const userSettings = await ctx.runQuery(api.userSettings.getUserSettings);
    
    // Schedule the test email
    await ctx.scheduler.runAfter(0, internal.testActions.sendTestEmailInternal, {
      email: emailConfig.email,
      userId: user,
      emailTemplate: userSettings?.emailTemplate || undefined,
    });
    
    return {
      success: true,
      message: `Test email sent to ${emailConfig.email}`,
    };
  },
});

// Internal action to send test email
export const sendTestEmailInternal = internalAction({
  args: {
    email: v.string(),
    userId: v.id("users"),
    emailTemplate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let htmlContent = '';
    
    if (args.emailTemplate) {
      // Use custom template with test data
      let processedTemplate = args.emailTemplate
        .replace(/{{websiteName}}/g, 'Example Website (Test)')
        .replace(/{{websiteUrl}}/g, 'https://example.com')
        .replace(/{{changeDate}}/g, new Date().toLocaleString())
        .replace(/{{changeType}}/g, 'Content changed')
        .replace(/{{pageTitle}}/g, 'Test Page Title')
        .replace(/{{viewChangesUrl}}/g, process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000')
        .replace(/{{aiMeaningfulScore}}/g, '85')
        .replace(/{{aiIsMeaningful}}/g, 'Yes')
        .replace(/{{aiReasoning}}/g, 'This is a test email to verify your email template is working correctly.')
        .replace(/{{aiModel}}/g, 'gpt-4o-mini')
        .replace(/{{aiAnalyzedAt}}/g, new Date().toLocaleString());
      
      // Sanitize the HTML
      htmlContent = sanitizeHtml(processedTemplate);
    } else {
      // Use default test template
      htmlContent = `
        <h2>Test Email - Firecrawl Observer</h2>
        <p>This is a test email to verify your email configuration is working correctly.</p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h3>Test Configuration</h3>
          <p><strong>Email:</strong> ${args.email}</p>
          <p><strong>Sent at:</strong> ${new Date().toLocaleString()}</p>
          <p><strong>Status:</strong> ✅ Email delivery is working!</p>
        </div>
        <p>If you received this email, your email notifications are configured correctly.</p>
      `;
    }
    
    await resend.sendEmail(ctx, {
      from: `${process.env.APP_NAME || 'Firecrawl Observer'} <${process.env.FROM_EMAIL || 'noreply@example.com'}>`,
      to: args.email,
      subject: "Test Email - Firecrawl Observer",
      html: htmlContent,
    });
  },
});
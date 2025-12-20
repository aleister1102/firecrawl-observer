import { v } from "convex/values";
import { mutation, query, action, internalAction, internalQuery } from "./_generated/server";
import { requireCurrentUser, getCurrentUser, requireCurrentUserForAction } from "./helpers";
import { internal, api } from "./_generated/api";
import { resend } from "./alertEmail";

// Get email configuration
export const getEmailConfig = query({
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return null;
    }

    const config = await ctx.db
      .query("emailConfig")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    return config;
  },
});

// Update or create email configuration
export const updateEmailConfig = mutation({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(args.email)) {
      throw new Error("Invalid email format");
    }

    const existingConfig = await ctx.db
      .query("emailConfig")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    const now = Date.now();
    
    // Generate verification token
    const verificationToken = Math.random().toString(36).substring(2, 15) + 
                             Math.random().toString(36).substring(2, 15);
    const verificationExpiry = now + 24 * 60 * 60 * 1000; // 24 hours

    if (existingConfig) {
      await ctx.db.patch(existingConfig._id, {
        email: args.email,
        isVerified: false,
        verificationToken,
        verificationExpiry,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("emailConfig", {
        userId: user._id,
        email: args.email,
        isVerified: false,
        verificationToken,
        verificationExpiry,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Schedule sending verification email
    await ctx.scheduler.runAfter(0, internal.emailManager.sendVerificationEmail, {
      email: args.email,
      token: verificationToken,
      userId: user._id,
    });

    return { success: true, message: "Verification email sent" };
  },
});

// Send verification email using Resend component
export const sendVerificationEmail = internalAction({
  args: {
    email: v.string(),
    token: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const verificationUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/verify-email?token=${args.token}`;

    try {
      await resend.sendEmail(ctx, {
        from: `${process.env.APP_NAME || 'Firecrawl Observer'} <${process.env.FROM_EMAIL || 'noreply@example.com'}>`,
        to: args.email,
        subject: 'Verify your email for Firecrawl Observer',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #EA580C; margin-bottom: 24px;">Verify Your Email</h2>
            <p style="color: #374151; font-size: 16px; line-height: 24px; margin-bottom: 24px;">
              Thank you for setting up email notifications with Firecrawl Observer. 
              Please click the button below to verify your email address:
            </p>
            <a href="${verificationUrl}" 
               style="display: inline-block; background-color: #EA580C; color: white; padding: 12px 24px; 
                      text-decoration: none; border-radius: 6px; font-weight: 500;">
              Verify Email
            </a>
            <p style="color: #6B7280; font-size: 14px; margin-top: 24px;">
              This link will expire in 24 hours. If you didn't request this, please ignore this email.
            </p>
            <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 32px 0;">
            <p style="color: #9CA3AF; font-size: 12px;">
              Firecrawl Observer - Website Change Monitoring
            </p>
          </div>
        `,
      });
      console.log("Verification email sent to:", args.email);
    } catch (error) {
      console.error("Error sending verification email:", error);
      throw error;
    }
  },
});

// Verify email token
export const verifyEmail = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const config = await ctx.db
      .query("emailConfig")
      .withIndex("by_token", (q) => q.eq("verificationToken", args.token))
      .first();

    if (!config) {
      throw new Error("Invalid verification token");
    }

    if (config.verificationExpiry && config.verificationExpiry < Date.now()) {
      throw new Error("Verification token has expired");
    }

    await ctx.db.patch(config._id, {
      isVerified: true,
      verificationToken: undefined,
      verificationExpiry: undefined,
      updatedAt: Date.now(),
    });

    return { success: true, message: "Email verified successfully" };
  },
});

// Resend verification email
export const resendVerificationEmail = action({
  handler: async (ctx) => {
    const user = await requireCurrentUserForAction(ctx);
    
    const config = await ctx.runQuery(api.emailManager.getEmailConfig, {});

    if (!config) {
      throw new Error("No email configuration found");
    }

    if (config.isVerified) {
      throw new Error("Email is already verified");
    }

    // Generate new token
    const verificationToken = Math.random().toString(36).substring(2, 15) + 
                             Math.random().toString(36).substring(2, 15);
    const verificationExpiry = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    await ctx.runMutation(api.emailManager.updateVerificationToken, {
      configId: config._id,
      token: verificationToken,
      expiry: verificationExpiry,
    });

    await ctx.scheduler.runAfter(0, internal.emailManager.sendVerificationEmail, {
      email: config.email,
      token: verificationToken,
      userId: user,
    });

    return { success: true, message: "Verification email resent" };
  },
});

// Internal helpers
export const getEmailConfigInternal = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("emailConfig")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
  },
});

export const updateVerificationToken = mutation({
  args: {
    configId: v.id("emailConfig"),
    token: v.string(),
    expiry: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.configId, {
      verificationToken: args.token,
      verificationExpiry: args.expiry,
      updatedAt: Date.now(),
    });
  },
});
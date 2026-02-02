import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Save current reading progress (bookmark)
 */
export const saveProgress = mutation({
  args: {
    mangaId: v.id("manga"),
    volumeNumber: v.number(),
    pageNumber: v.number(),
    pageUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Must be logged in to save progress");
    }

    // Check if progress already exists for this user + manga
    const existing = await ctx.db
      .query("readingProgress")
      .withIndex("by_user_manga", (q) => 
        q.eq("userId", userId).eq("mangaId", args.mangaId)
      )
      .unique();

    if (existing) {
      // Update existing progress
      await ctx.db.patch(existing._id, {
        volumeNumber: args.volumeNumber,
        pageNumber: args.pageNumber,
        pageUrl: args.pageUrl,
        lastReadAt: Date.now(),
      });
      return existing._id;
    } else {
      // Create new progress entry
      return await ctx.db.insert("readingProgress", {
        userId,
        mangaId: args.mangaId,
        volumeNumber: args.volumeNumber,
        pageNumber: args.pageNumber,
        pageUrl: args.pageUrl,
        lastReadAt: Date.now(),
      });
    }
  },
});

/**
 * Get user's most recent reading progress
 */
export const getLastRead = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }

    const progress = await ctx.db
      .query("readingProgress")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .first();

    if (!progress) {
      return null;
    }

    // Get manga details
    const manga = await ctx.db.get(progress.mangaId);
    if (!manga) {
      return null;
    }

    return {
      mangaId: progress.mangaId,
      mangaTitle: manga.title,
      mangaSlug: manga.slug,
      volumeNumber: progress.volumeNumber,
      pageNumber: progress.pageNumber,
      pageUrl: progress.pageUrl,
      lastReadAt: progress.lastReadAt,
    };
  },
});

/**
 * Get progress for a specific manga
 */
export const getProgressForManga = query({
  args: {
    mangaId: v.id("manga"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }

    const progress = await ctx.db
      .query("readingProgress")
      .withIndex("by_user_manga", (q) => 
        q.eq("userId", userId).eq("mangaId", args.mangaId)
      )
      .unique();

    if (!progress) {
      return null;
    }

    return {
      volumeNumber: progress.volumeNumber,
      pageNumber: progress.pageNumber,
      pageUrl: progress.pageUrl,
      lastReadAt: progress.lastReadAt,
    };
  },
});
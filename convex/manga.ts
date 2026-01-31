import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Create a new manga entry
 */
export const createManga = mutation({
  args: {
    title: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    coverUrl: v.string(),
    totalVolumes: v.number(),
    status: v.union(v.literal("ongoing"), v.literal("completed")),
  },
  returns: v.id("manga"),
  handler: async (ctx, args) => {
    // Check if manga with this slug already exists
    const existing = await ctx.db
      .query("manga")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    
    if (existing) {
      throw new Error(`Manga with slug "${args.slug}" already exists`);
    }
    
    return await ctx.db.insert("manga", {
      title: args.title,
      slug: args.slug,
      description: args.description,
      coverUrl: args.coverUrl,
      totalVolumes: args.totalVolumes,
      status: args.status,
    });
  },
});

/**
 * Update a manga entry
 */
export const updateManga = mutation({
  args: {
    mangaId: v.id("manga"),
    title: v.optional(v.string()),
    slug: v.optional(v.string()),
    description: v.optional(v.string()),
    coverUrl: v.optional(v.string()),
    totalVolumes: v.optional(v.number()),
    status: v.optional(v.union(v.literal("ongoing"), v.literal("completed"))),
  },
  returns: v.id("manga"),
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.mangaId);
    if (!existing) {
      throw new Error("Manga not found");
    }

    const updateFields: Partial<typeof existing> = {};
    if (args.title !== undefined) updateFields.title = args.title;
    if (args.slug !== undefined) updateFields.slug = args.slug;
    if (args.description !== undefined) updateFields.description = args.description;
    if (args.coverUrl !== undefined) updateFields.coverUrl = args.coverUrl;
    if (args.totalVolumes !== undefined) updateFields.totalVolumes = args.totalVolumes;
    if (args.status !== undefined) updateFields.status = args.status;

    await ctx.db.patch(args.mangaId, updateFields);
    return args.mangaId;
  },
});

/**
 * Add a volume to a manga
 */
export const addVolume = mutation({
  args: {
    mangaId: v.id("manga"),
    volumeNumber: v.number(),
    pageCount: v.number(),
    chapterRange: v.optional(v.string()),
  },
  returns: v.id("volumes"),
  handler: async (ctx, args) => {
    // Verify manga exists
    const manga = await ctx.db.get(args.mangaId);
    if (!manga) {
      throw new Error("Manga not found");
    }
    
    // Check if volume already exists for this manga
    const existing = await ctx.db
      .query("volumes")
      .withIndex("by_manga_and_number", (q) => 
        q.eq("mangaId", args.mangaId).eq("volumeNumber", args.volumeNumber)
      )
      .unique();
    
    if (existing) {
      throw new Error(`Volume ${args.volumeNumber} already exists for this manga`);
    }
    
    return await ctx.db.insert("volumes", {
      mangaId: args.mangaId,
      volumeNumber: args.volumeNumber,
      pageCount: args.pageCount,
      chapterRange: args.chapterRange,
    });
  },
});

/**
 * Get all manga (list view)
 */
export const listManga = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("manga"),
      _creationTime: v.number(),
      title: v.string(),
      slug: v.string(),
      description: v.optional(v.string()),
      coverUrl: v.string(),
      totalVolumes: v.number(),
      status: v.union(v.literal("ongoing"), v.literal("completed")),
    })
  ),
  handler: async (ctx, args) => {
    return await ctx.db.query("manga").collect();
  },
});

/**
 * Get manga by slug with all volumes
 */
export const getMangaBySlug = query({
  args: {
    slug: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      manga: v.object({
        _id: v.id("manga"),
        _creationTime: v.number(),
        title: v.string(),
        slug: v.string(),
        description: v.optional(v.string()),
        coverUrl: v.string(),
        totalVolumes: v.number(),
        status: v.union(v.literal("ongoing"), v.literal("completed")),
      }),
      volumes: v.array(
        v.object({
          _id: v.id("volumes"),
          _creationTime: v.number(),
          volumeNumber: v.number(),
          pageCount: v.number(),
          chapterRange: v.optional(v.string()),
        })
      ),
    })
  ),
  handler: async (ctx, args) => {
    const manga = await ctx.db
      .query("manga")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    
    if (!manga) {
      return null;
    }
    
    const volumes = await ctx.db
      .query("volumes")
      .withIndex("by_manga", (q) => q.eq("mangaId", manga._id))
      .order("asc")
      .collect();
    
    return {
      manga: {
        _id: manga._id,
        _creationTime: manga._creationTime,
        title: manga.title,
        slug: manga.slug,
        description: manga.description,
        coverUrl: manga.coverUrl,
        totalVolumes: manga.totalVolumes,
        status: manga.status,
      },
      volumes: volumes.map(v => ({
        _id: v._id,
        _creationTime: v._creationTime,
        volumeNumber: v.volumeNumber,
        pageCount: v.pageCount,
        chapterRange: v.chapterRange,
      })),
    };
  },
});

/**
 * Get specific volume with page URLs
 */
export const getVolume = query({
  args: {
    mangaSlug: v.string(),
    volumeNumber: v.number(),
  },
  returns: v.union(
    v.null(),
    v.object({
      manga: v.object({
        title: v.string(),
        slug: v.string(),
      }),
      volume: v.object({
        volumeNumber: v.number(),
        pageCount: v.number(),
        chapterRange: v.optional(v.string()),
      }),
      pages: v.array(v.string()), // Array of page URLs
    })
  ),
  handler: async (ctx, args) => {
    const manga = await ctx.db
      .query("manga")
      .withIndex("by_slug", (q) => q.eq("slug", args.mangaSlug))
      .unique();
    
    if (!manga) {
      return null;
    }
    
    const volume = await ctx.db
      .query("volumes")
      .withIndex("by_manga_and_number", (q) => 
        q.eq("mangaId", manga._id).eq("volumeNumber", args.volumeNumber)
      )
      .unique();
    
    if (!volume) {
      return null;
    }
    
    // Construct page URLs
    const baseUrl = `https://cdn.koushikkoushik.com/manga/${manga.slug}`;
    const pages: string[] = [];
    
    for (let i = 1; i <= volume.pageCount; i++) {
      const pageNum = i.toString().padStart(3, '0');
      pages.push(`${baseUrl}/volume-${args.volumeNumber.toString().padStart(3, '0')}/${pageNum}.webp`);
    }
    
    return {
      manga: {
        title: manga.title,
        slug: manga.slug,
      },
      volume: {
        volumeNumber: volume.volumeNumber,
        pageCount: volume.pageCount,
        chapterRange: volume.chapterRange,
      },
      pages,
    };
  },
});

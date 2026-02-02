import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,
  
  manga: defineTable({
    title: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    coverUrl: v.string(),
    totalVolumes: v.number(),
    status: v.union(v.literal("ongoing"), v.literal("completed")),
  })
  .index("by_slug", ["slug"]),
  
  volumes: defineTable({
    mangaId: v.id("manga"),
    volumeNumber: v.number(),
    pageCount: v.number(),
    chapterRange: v.optional(v.string()),
  })
  .index("by_manga", ["mangaId"])
  .index("by_manga_and_number", ["mangaId", "volumeNumber"]),
});

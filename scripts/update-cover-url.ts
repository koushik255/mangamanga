#!/usr/bin/env bun
import { ConvexClient } from "convex/browser";

const CONVEX_URL = process.env.CONVEX_URL || "https://quixotic-tern-142.convex.cloud";

async function main() {
  console.log('🗄️  Updating manga cover URL to use CDN...');
  console.log(`   URL: ${CONVEX_URL}`);
  console.log('');
  
  const client = new ConvexClient(CONVEX_URL);
  
  try {
    // Get the manga
    const mangaResult = await client.query(
      "manga.js:getMangaBySlug" as any,
      { slug: "steel-ball-run" }
    );
    
    if (!mangaResult) {
      console.error('❌ Manga not found');
      process.exit(1);
    }
    
    const mangaId = mangaResult.manga._id;
    const oldCoverUrl = mangaResult.manga.coverUrl;
    const newCoverUrl = "https://cdn.koushikkoushik.com/manga/steel-ball-run/volume-001/001.webp";
    
    console.log(`   Current cover URL: ${oldCoverUrl}`);
    console.log(`   New cover URL: ${newCoverUrl}`);
    console.log('');
    
    // Update the cover URL
    await client.mutation(
      "manga.js:updateManga" as any,
      {
        mangaId,
        coverUrl: newCoverUrl,
      }
    );
    
    console.log('✅ Cover URL updated successfully!');
    console.log('');
    console.log('📍 Your manga now uses the CDN domain:');
    console.log(`   ${newCoverUrl}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    client.close();
  }
}

main();

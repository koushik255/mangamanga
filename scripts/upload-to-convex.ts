#!/usr/bin/env bun
import { ConvexClient } from "convex/browser";

// Your Convex deployment URL
const CONVEX_URL = process.env.CONVEX_URL || "https://enchanted-rook-839.convex.cloud";

// Steel Ball Run data
const MANGA_DATA = {
  title: "JoJo's Bizarre Adventure Part 7: Steel Ball Run",
  slug: "steel-ball-run",
  description: undefined,
  coverUrl: "https://cdn.koushikkoushik.com/manga/steel-ball-run/volume-001/001.webp",
  totalVolumes: 24,
  status: "completed" as const,
};

const VOLUME_DATA = {
  volumeNumber: 1,
  pageCount: 154,
  chapterRange: "c01-05",
};

async function main() {
  console.log('🗄️  Uploading to Convex...');
  console.log(`   URL: ${CONVEX_URL}`);
  console.log('');
  
  const client = new ConvexClient(CONVEX_URL);
  
  try {
    // Step 1: Create manga record
    console.log('📚 Creating manga record...');
    const mangaId = await client.mutation(
      "manga.js:createManga" as any,
      {
        title: MANGA_DATA.title,
        slug: MANGA_DATA.slug,
        description: MANGA_DATA.description,
        coverUrl: MANGA_DATA.coverUrl,
        totalVolumes: MANGA_DATA.totalVolumes,
        status: MANGA_DATA.status,
      }
    );
    
    console.log(`   ✅ Manga created with ID: ${mangaId}`);
    
    // Step 2: Create volume record
    console.log('📖 Creating volume record...');
    const volumeId = await client.mutation(
      "manga.js:addVolume" as any,
      {
        mangaId,
        volumeNumber: VOLUME_DATA.volumeNumber,
        pageCount: VOLUME_DATA.pageCount,
        chapterRange: VOLUME_DATA.chapterRange,
      }
    );
    
    console.log(`   ✅ Volume created with ID: ${volumeId}`);
    
    console.log('');
    console.log('='.repeat(50));
    console.log('✅ Upload Complete!');
    console.log(`   Manga: ${MANGA_DATA.title}`);
    console.log(`   Volume: ${VOLUME_DATA.volumeNumber} (${VOLUME_DATA.pageCount} pages)`);
    console.log('='.repeat(50));
    console.log('');
    console.log('📍 Test your queries:');
    console.log('   - List all manga: useQuery(api.manga.listManga)');
    console.log('   - Get manga details: useQuery(api.manga.getMangaBySlug, { slug: "steel-ball-run" })');
    console.log('   - Get volume pages: useQuery(api.manga.getVolume, { mangaSlug: "steel-ball-run", volumeNumber: 1 })');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    client.close();
  }
}

main();

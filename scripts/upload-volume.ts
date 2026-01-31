#!/usr/bin/env bun
/**
 * Unified Manga Volume Upload Script
 * 
 * This script orchestrates the full pipeline:
 * 1. Convert PNGs to WebP
 * 2. Upload WebP files to R2
 * 3. Add volume metadata to Convex database
 * 
 * Usage: bun run scripts/upload-volume.ts --volume 2
 */

const sharp = require('sharp');
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { ConvexClient } from "convex/browser";
import { readdir, stat, mkdir, access, readFile } from 'fs/promises';
import { join, basename } from 'path';
import { createReadStream } from 'fs';

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  mangaSlug: 'steel-ball-run',
  mangaTitle: "JoJo's Bizarre Adventure Part 7: Steel Ball Run",
  sourceBasePath: '~/Pictures/Manga/SteelBallRun/Volumes',
  outputBasePath: './output/steel-ball-run',
  quality: 85,
};

// ============================================
// ENVIRONMENT VARIABLES
// ============================================

const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_URL = process.env.R2_BUCKET_URL;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'manga';
const CONVEX_URL = process.env.CONVEX_URL;

// ============================================
// ARGUMENT PARSING
// ============================================

interface UploadArgs {
  volume: number;
  skipConvert: boolean;
  skipR2: boolean;
  skipConvex: boolean;
}

function parseArgs(): UploadArgs {
  const args = process.argv.slice(2);
  const parsed: Partial<UploadArgs> = {
    skipConvert: false,
    skipR2: false,
    skipConvex: false,
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--volume' || arg === '-v') {
      const value = args[++i];
      if (value) parsed.volume = parseInt(value, 10);
    } else if (arg === '--skip-convert') {
      parsed.skipConvert = true;
    } else if (arg === '--skip-r2') {
      parsed.skipR2 = true;
    } else if (arg === '--skip-convex') {
      parsed.skipConvex = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  
  if (!parsed.volume) {
    console.error('❌ Missing required argument: --volume <number>');
    printHelp();
    process.exit(1);
  }
  
  return {
    volume: parsed.volume as number,
    skipConvert: parsed.skipConvert as boolean,
    skipR2: parsed.skipR2 as boolean,
    skipConvex: parsed.skipConvex as boolean,
  };
}

function printHelp() {
  console.log(`
Usage: bun run scripts/upload-volume.ts --volume <number> [options]

Options:
  --volume, -v <number>   Volume number to upload (required)
  --skip-convert          Skip PNG to WebP conversion
  --skip-r2               Skip R2 upload
  --skip-convex           Skip Convex database update
  --help, -h              Show this help message

Examples:
  bun run scripts/upload-volume.ts --volume 2
  bun run scripts/upload-volume.ts -v 2 --skip-convert
  bun run scripts/upload-volume.ts -v 2 --skip-r2 --skip-convex
`);
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function padNumber(num: number, length: number = 3): string {
  return num.toString().padStart(length, '0');
}

function extractVolumeNumber(folderName: string): number {
  const match = folderName.match(/v(\d+)/i);
  return match && match[1] ? parseInt(match[1], 10) : 0;
}

async function findVolumeFolder(sourcePath: string, volumeNum: number): Promise<string | null> {
  try {
    const entries = await readdir(sourcePath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const volNum = extractVolumeNumber(entry.name);
        if (volNum === volumeNum) {
          return join(sourcePath, entry.name);
        }
      }
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

async function findPngFiles(dir: string): Promise<string[]> {
  const pngFiles: string[] = [];
  
  async function scan(currentDir: string) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
        pngFiles.push(fullPath);
      }
    }
  }
  
  await scan(dir);
  return pngFiles;
}

// ============================================
// STEP 1: CONVERT PNG TO WEBP
// ============================================

async function convertVolume(
  sourcePath: string,
  outputPath: string,
  volumeNum: number,
  quality: number
): Promise<{ converted: number; errors: number; pageCount: number }> {
  console.log('\n📦 STEP 1: Converting PNG to WebP');
  console.log('='.repeat(50));
  
  const pngFiles = await findPngFiles(sourcePath);
  
  if (pngFiles.length === 0) {
    throw new Error(`No PNG files found in ${sourcePath}`);
  }
  
  // Sort alphabetically
  pngFiles.sort((a, b) => a.localeCompare(b));
  
  console.log(`   Source: ${sourcePath}`);
  console.log(`   Output: ${outputPath}`);
  console.log(`   Pages: ${pngFiles.length}`);
  console.log(`   Quality: ${quality}%`);
  console.log('');
  
  // Create output directory
  await mkdir(outputPath, { recursive: true });
  
  let converted = 0;
  let errors = 0;
  
  for (let i = 0; i < pngFiles.length; i++) {
    const pngPath = pngFiles[i]!;
    const pageNum = i + 1;
    const outputFileName = `${padNumber(pageNum)}.webp`;
    const outputFilePath = join(outputPath, outputFileName);
    
    try {
      await sharp(pngPath)
        .webp({ quality, effort: 4 })
        .toFile(outputFilePath);
      
      converted++;
      
      // Progress update every 10 files
      if (converted % 10 === 0 || converted === pngFiles.length) {
        process.stdout.write(`\r   Progress: ${converted}/${pngFiles.length} pages converted`);
      }
    } catch (error) {
      errors++;
      console.error(`\n   ❌ Error converting ${basename(pngPath)}:`, error);
    }
  }
  
  console.log(`\n   ✅ Conversion complete: ${converted} pages, ${errors} errors`);
  
  return { converted, errors, pageCount: converted };
}

// ============================================
// STEP 2: UPLOAD TO R2
// ============================================

async function uploadToR2(
  webpFolderPath: string,
  mangaSlug: string,
  volumeNum: number
): Promise<{ uploaded: number; errors: number }> {
  console.log('\n☁️  STEP 2: Uploading to R2');
  console.log('='.repeat(50));
  
  // Validate credentials
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_URL) {
    throw new Error('Missing R2 credentials. Please set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_URL in .env');
  }
  
  // Create S3 client for R2
  const s3Client = new S3Client({
    region: 'auto',
    endpoint: R2_BUCKET_URL,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
  
  // Find all WebP files
  const files = await readdir(webpFolderPath);
  const webpFiles = files
    .filter(f => f.endsWith('.webp'))
    .sort((a, b) => a.localeCompare(b));
  
  if (webpFiles.length === 0) {
    throw new Error(`No WebP files found in ${webpFolderPath}`);
  }
  
  console.log(`   Bucket: ${R2_BUCKET_NAME}`);
  console.log(`   Files: ${webpFiles.length}`);
  console.log(`   Path: manga/${mangaSlug}/volume-${padNumber(volumeNum)}/`);
  console.log('');
  
  let uploaded = 0;
  let errors = 0;
  
  for (let i = 0; i < webpFiles.length; i++) {
    const file = webpFiles[i]!;
    const filePath = join(webpFolderPath, file);
    const key = `manga/${mangaSlug}/volume-${padNumber(volumeNum)}/${file}`;
    
    process.stdout.write(`   Uploading ${file}... `);
    
    try {
      const fileContent = await readFile(filePath);
      
      const command = new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: fileContent,
        ContentType: 'image/webp',
      });
      
      await s3Client.send(command);
      uploaded++;
      console.log('✅');
    } catch (error) {
      errors++;
      console.log(`❌ ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Progress update every 10 files
    if ((i + 1) % 10 === 0 || i === webpFiles.length - 1) {
      console.log(`   Progress: ${i + 1}/${webpFiles.length} files`);
    }
  }
  
  console.log(`   ✅ Upload complete: ${uploaded} files, ${errors} errors`);
  
  return { uploaded, errors };
}

// ============================================
// STEP 3: UPDATE CONVEX DATABASE
// ============================================

async function updateConvex(
  volumeNum: number,
  pageCount: number
): Promise<void> {
  console.log('\n🗄️  STEP 3: Updating Convex Database');
  console.log('='.repeat(50));
  
  // Validate credentials
  if (!CONVEX_URL) {
    throw new Error('Missing CONVEX_URL in .env');
  }
  
  console.log(`   URL: ${CONVEX_URL}`);
  console.log(`   Manga: ${CONFIG.mangaSlug}`);
  console.log(`   Volume: ${volumeNum}`);
  console.log(`   Pages: ${pageCount}`);
  console.log('');
  
  const client = new ConvexClient(CONVEX_URL);
  
  try {
    // First, get the manga ID by slug
    console.log('   Looking up manga record...');
    const mangaResult = await client.query(
      "manga.js:getMangaBySlug" as any,
      { slug: CONFIG.mangaSlug }
    );
    
    if (!mangaResult) {
      throw new Error(`Manga with slug "${CONFIG.mangaSlug}" not found. Please create the manga first.`);
    }
    
    const mangaId = mangaResult.manga._id;
    console.log(`   ✅ Found manga ID: ${mangaId}`);
    
    // Add volume record
    console.log('   Creating volume record...');
    const volumeId = await client.mutation(
      "manga.js:addVolume" as any,
      {
        mangaId,
        volumeNumber: volumeNum,
        pageCount: pageCount,
      }
    );
    
    console.log(`   ✅ Volume created with ID: ${volumeId}`);
    
  } catch (error) {
    throw error;
  } finally {
    client.close();
  }
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 Manga Volume Upload Script');
  console.log('='.repeat(60));
  
  const args = parseArgs();
  
  console.log(`\n📚 Volume ${args.volume}`);
  console.log(`   Manga: ${CONFIG.mangaTitle}`);
  console.log(`   Slug: ${CONFIG.mangaSlug}`);
  console.log('');
  
  // Resolve source path (handle ~)
  const sourceBasePath = CONFIG.sourceBasePath.replace(/^~/, process.env.HOME || '');
  
  // Find volume folder
  const volumeFolder = await findVolumeFolder(sourceBasePath, args.volume);
  if (!volumeFolder) {
    console.error(`❌ Volume ${args.volume} folder not found in ${sourceBasePath}`);
    console.error('   Expected folder name pattern: "Steel Ball Run v02..."');
    process.exit(1);
  }
  
  console.log(`   Source folder: ${volumeFolder}`);
  
  // Setup paths
  const outputVolumePath = join(CONFIG.outputBasePath, `volume-${padNumber(args.volume)}`);
  
  let pageCount = 0;
  
  try {
    // Step 1: Convert
    if (!args.skipConvert) {
      const convertResult = await convertVolume(
        volumeFolder,
        outputVolumePath,
        args.volume,
        CONFIG.quality
      );
      pageCount = convertResult.pageCount;
    } else {
      console.log('\n⏭️  Skipping conversion (using existing WebP files)');
      // Count existing files
      const files = await readdir(outputVolumePath);
      pageCount = files.filter(f => f.endsWith('.webp')).length;
      console.log(`   Found ${pageCount} existing WebP files`);
    }
    
    // Step 2: Upload to R2
    if (!args.skipR2) {
      await uploadToR2(outputVolumePath, CONFIG.mangaSlug, args.volume);
    } else {
      console.log('\n⏭️  Skipping R2 upload');
    }
    
    // Step 3: Update Convex
    if (!args.skipConvex) {
      await updateConvex(args.volume, pageCount);
    } else {
      console.log('\n⏭️  Skipping Convex update');
    }
    
    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ UPLOAD COMPLETE!');
    console.log('='.repeat(60));
    console.log(`   Volume: ${args.volume}`);
    console.log(`   Pages: ${pageCount}`);
    console.log(`   R2 Path: manga/${CONFIG.mangaSlug}/volume-${padNumber(args.volume)}/`);
    console.log(`   URL: https://cdn.koushikkoushik.com/manga/${CONFIG.mangaSlug}/volume-${padNumber(args.volume)}/001.webp`);
    console.log('='.repeat(60));
    console.log('');
    
  } catch (error) {
    console.error('\n💥 ERROR:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();

#!/usr/bin/env bun
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFile } from 'fs/promises';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { createReadStream } from 'fs';

// Load environment variables
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_URL = process.env.R2_BUCKET_URL;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'manga';

if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_URL) {
  console.error('❌ Missing R2 credentials. Please set environment variables:');
  console.error('   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_URL');
  process.exit(1);
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

interface UploadArgs {
  input: string;
  mangaSlug: string;
  volume: number;
}

function parseArgs(): UploadArgs {
  const args = process.argv.slice(2);
  const parsed: Partial<UploadArgs> = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--input' || arg === '-i') {
      const value = args[++i];
      if (value) parsed.input = value;
    } else if (arg === '--manga' || arg === '-m') {
      const value = args[++i];
      if (value) parsed.mangaSlug = value;
    } else if (arg === '--volume' || arg === '-v') {
      const value = args[++i];
      if (value) parsed.volume = parseInt(value, 10);
    }
  }
  
  if (!parsed.input || !parsed.mangaSlug || !parsed.volume) {
    console.error('Usage: bun run scripts/upload-to-r2.ts --input <path> --manga <slug> --volume <number>');
    console.error('  --input, -i    : Path to WebP files folder');
    console.error('  --manga, -m    : Manga slug (e.g., steel-ball-run)');
    console.error('  --volume, -v   : Volume number');
    process.exit(1);
  }
  
  return {
    input: parsed.input as string,
    mangaSlug: parsed.mangaSlug as string,
    volume: parsed.volume as number,
  };
}

function padNumber(num: number, length: number = 3): string {
  return num.toString().padStart(length, '0');
}

async function uploadFile(
  filePath: string, 
  key: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const fileContent = await readFile(filePath);
    
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: fileContent,
      ContentType: 'image/webp',
      // ACL: 'public-read', // Note: R2 doesn't support ACLs the same way S3 does
    });
    
    await s3Client.send(command);
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

async function main() {
  const args = parseArgs();
  
  console.log('☁️  R2 Upload Script');
  console.log(`   Input: ${args.input}`);
  console.log(`   Manga: ${args.mangaSlug}`);
  console.log(`   Volume: ${args.volume}`);
  console.log(`   Bucket: ${R2_BUCKET_NAME}`);
  console.log('');
  
  // Find all WebP files in the volume folder
  const volumeFolder = `volume-${padNumber(args.volume)}`;
  const inputPath = join(args.input, volumeFolder);
  
  const files = await readdir(inputPath);
  const webpFiles = files
    .filter(f => f.endsWith('.webp'))
    .sort((a, b) => a.localeCompare(b));
  
  if (webpFiles.length === 0) {
    console.error(`❌ No WebP files found in ${inputPath}`);
    process.exit(1);
  }
  
  console.log(`📁 Found ${webpFiles.length} WebP files to upload`);
  console.log('');
  
  let uploaded = 0;
  let errors = 0;
  
  for (let i = 0; i < webpFiles.length; i++) {
    const file = webpFiles[i]!;
    const filePath = join(inputPath, file);
    const key = `manga/${args.mangaSlug}/${volumeFolder}/${file}`;
    
    process.stdout.write(`   Uploading ${file}... `);
    
    const result = await uploadFile(filePath, key);
    
    if (result.success) {
      uploaded++;
      console.log('✅');
    } else {
      errors++;
      console.log(`❌ ${result.error}`);
    }
    
    // Progress update every 10 files
    if ((i + 1) % 10 === 0 || i === webpFiles.length - 1) {
      console.log(`   Progress: ${i + 1}/${webpFiles.length} files`);
    }
  }
  
  console.log('');
  console.log('='.repeat(50));
  console.log('✅ Upload Complete!');
  console.log(`   Files uploaded: ${uploaded}`);
  console.log(`   Errors: ${errors}`);
  console.log(`   R2 path: manga/${args.mangaSlug}/${volumeFolder}/`);
  console.log('='.repeat(50));
  console.log('');
  console.log('📍 Access your images at:');
  console.log(`   ${R2_BUCKET_URL}/manga/${args.mangaSlug}/${volumeFolder}/001.webp`);
}

main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});

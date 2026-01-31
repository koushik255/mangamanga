#!/usr/bin/env bun
const sharp = require('sharp');
import { readdir, stat, mkdir, access } from 'fs/promises';
import { join, basename, dirname, extname } from 'path';
import { existsSync } from 'fs';

interface Args {
  input: string;
  output: string;
  quality: number;
  volume?: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const parsed: Partial<Args> = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--input' || arg === '-i') {
      const value = args[++i];
      if (value) parsed.input = value;
    } else if (arg === '--output' || arg === '-o') {
      const value = args[++i];
      if (value) parsed.output = value;
    } else if (arg === '--quality' || arg === '-q') {
      const value = args[++i];
      if (value) parsed.quality = parseInt(value, 10);
    } else if (arg === '--volume' || arg === '-v') {
      const value = args[++i];
      if (value) parsed.volume = parseInt(value, 10);
    }
  }
  
  if (!parsed.input || !parsed.output) {
    console.error('Usage: bun run scripts/convert-to-webp.ts --input <path> --output <path> [--quality 85] [--volume 1]');
    console.error('  --input, -i    : Path to manga volumes folder');
    console.error('  --output, -o   : Path for WebP output folder');
    console.error('  --quality, -q  : WebP quality (1-100, default: 85)');
    console.error('  --volume, -v   : Process only specific volume number');
    process.exit(1);
  }
  
  return {
    input: parsed.input as string,
    output: parsed.output as string,
    quality: parsed.quality ?? 85,
    volume: parsed.volume
  };
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

function extractVolumeNumber(folderName: string): number {
  const match = folderName.match(/v(\d+)/i);
  return match && match[1] ? parseInt(match[1], 10) : 0;
}

function padNumber(num: number, length: number = 3): string {
  return num.toString().padStart(length, '0');
}

async function convertVolume(
  volumePath: string, 
  outputBasePath: string, 
  volumeNum: number,
  quality: number
): Promise<{ converted: number; errors: number }> {
  const volumeName = basename(volumePath);
  console.log(`\n📖 Processing ${volumeName}...`);
  
  // Find all PNG files
  const pngFiles = await findPngFiles(volumePath);
  
  if (pngFiles.length === 0) {
    console.log(`  ⚠️  No PNG files found in ${volumeName}`);
    return { converted: 0, errors: 0 };
  }
  
  // Sort alphabetically by full path (Option A)
  pngFiles.sort((a, b) => a.localeCompare(b));
  
  console.log(`  Found ${pngFiles.length} PNG files`);
  
  // Create output directory for this volume
  const outputVolumePath = join(outputBasePath, `volume-${padNumber(volumeNum)}`);
  await mkdir(outputVolumePath, { recursive: true });
  
  let converted = 0;
  let errors = 0;
  
  // Process each file
  for (let i = 0; i < pngFiles.length; i++) {
    const pngPath = pngFiles[i]!;
    const pageNum = i + 1;
    const outputFileName = `${padNumber(pageNum)}.webp`;
    const outputPath = join(outputVolumePath, outputFileName);
    
    try {
      // Convert to WebP
      await sharp(pngPath)
        .webp({ quality, effort: 4 })
        .toFile(outputPath);
      
      converted++;
      
      // Progress update every 10 files
      if (converted % 10 === 0 || converted === pngFiles.length) {
        process.stdout.write(`\r  ✅ Progress: ${converted}/${pngFiles.length} pages converted`);
      }
    } catch (error) {
      errors++;
      console.error(`\n  ❌ Error converting ${basename(pngPath)}:`, error);
    }
  }
  
  console.log(`\n  ✓ Volume ${volumeNum} complete: ${converted} pages, ${errors} errors`);
  
  return { converted, errors };
}

async function main() {
  const args = parseArgs();
  
  console.log('🔧 WebP Conversion Script');
  console.log(`   Input: ${args.input}`);
  console.log(`   Output: ${args.output}`);
  console.log(`   Quality: ${args.quality}%`);
  console.log(`   Mode: Overwrite existing files`);
  console.log('');
  
  // Validate input directory exists
  try {
    await access(args.input);
  } catch {
    console.error(`❌ Input directory not found: ${args.input}`);
    process.exit(1);
  }
  
  // Create output base directory
  await mkdir(args.output, { recursive: true });
  
  // Find all volume folders
  const entries = await readdir(args.input, { withFileTypes: true });
  const volumeFolders = entries
    .filter(e => e.isDirectory())
    .map(e => ({
      name: e.name,
      path: join(args.input, e.name),
      number: extractVolumeNumber(e.name)
    }))
    .filter(v => v.number > 0)
    .sort((a, b) => a.number - b.number);
  
  if (volumeFolders.length === 0) {
    console.error('❌ No volume folders found. Expected folders like "Steel Ball Run v01..."');
    process.exit(1);
  }
  
  // Filter to specific volume if requested
  let volumesToProcess = volumeFolders;
  if (args.volume) {
    volumesToProcess = volumeFolders.filter(v => v.number === args.volume);
    if (volumesToProcess.length === 0) {
      console.error(`❌ Volume ${args.volume} not found`);
      process.exit(1);
    }
    console.log(`📚 Processing only Volume ${args.volume}`);
  } else {
    console.log(`📚 Found ${volumeFolders.length} volumes to process`);
  }
  console.log('');
  
  // Process each volume
  let totalConverted = 0;
  let totalErrors = 0;
  
  for (const volume of volumesToProcess) {
    const result = await convertVolume(volume.path, args.output, volume.number, args.quality);
    totalConverted += result.converted;
    totalErrors += result.errors;
  }
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('✅ Conversion Complete!');
  console.log(`   Total volumes: ${volumesToProcess.length}`);
  console.log(`   Total pages converted: ${totalConverted}`);
  console.log(`   Total errors: ${totalErrors}`);
  console.log(`   Output location: ${args.output}`);
  console.log('='.repeat(50));
}

main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});

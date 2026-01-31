import { $ } from "bun";

async function buildManga() {
  console.log("Building manga app...");

  // Ensure output directory exists
  await $`mkdir -p public/manga`;

  // Build the React app with Bun bundler
  const result = await Bun.build({
    entrypoints: ["./src/manga/main.tsx"],
    outdir: "./public/manga",
    target: "browser",
    format: "esm",
    splitting: false,
    sourcemap: "inline",
    minify: false,
    define: {
      "process.env.NODE_ENV": '"development"',
    },
  });

  if (!result.success) {
    console.error("Build failed:");
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  // List output files
  console.log("\nBuild complete! Output files:");
  for (const file of result.outputs) {
    console.log(`  - ${file.path}`);
  }

  console.log("\n✓ Manga app built successfully");
}

buildManga().catch(console.error);

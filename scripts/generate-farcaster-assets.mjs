import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const BRAND_PURPLE = "#5a3bfd";
const PROJECT_ROOT = path.resolve(process.cwd());
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
const SOURCE_PATH = path.join(PUBLIC_DIR, "XandO.png");

const outputs = [
  {
    file: "farcaster-icon.png",
    width: 1024,
    height: 1024,
  },
  {
    file: "farcaster-splash.png",
    width: 200,
    height: 200,
  },
  {
    file: "farcaster-og.png",
    width: 1200,
    height: 630,
  },
];

async function ensureSource() {
  try {
    await fs.access(SOURCE_PATH);
  } catch {
    throw new Error(`Missing source image at ${SOURCE_PATH}`);
  }
}

function buildPipeline(size) {
  return sharp(SOURCE_PATH)
    .resize(size.width, size.height, {
      fit: "contain",
      position: "centre",
      background: BRAND_PURPLE,
    })
    .toFormat("png");
}

async function generate() {
  await ensureSource();

  await Promise.all(
    outputs.map(async (output) => {
      const targetPath = path.join(PUBLIC_DIR, output.file);
      const pipeline = buildPipeline(output).flatten({
        background: BRAND_PURPLE,
      });

      await pipeline.png().toFile(targetPath);
    })
  );
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

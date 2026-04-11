import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import * as os from 'os';

async function main() {
  const htmlPath = path.resolve('./demo-chat.html');
  const outputGif = path.resolve('./demo.gif');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samvad-'));

  console.log(`Recording demo from: file://${htmlPath}`);
  console.log(`Video temp dir: ${tmpDir}`);

  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 960, height: 640 },
    recordVideo: {
      dir: tmpDir,
      size: { width: 960, height: 640 },
    },
  });

  const page = await context.newPage();

  await page.goto(`file://${htmlPath}?fast=1`);

  console.log('Waiting for debate animation to complete...');

  // Wait for the DEBATE_COMPLETE flag (set by JS after last animation + 1s buffer)
  await page.waitForFunction(() => (window as unknown as { DEBATE_COMPLETE?: boolean }).DEBATE_COMPLETE === true, {
    timeout: 60_000,
    polling: 200,
  });

  console.log('Animation complete. Closing browser...');

  // Close context first to finalize the video file
  await context.close();
  await browser.close();

  // Find the recorded webm file
  const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.webm'));
  if (files.length === 0) {
    throw new Error(`No .webm file found in ${tmpDir}`);
  }

  const webmPath = path.join(tmpDir, files[0]);
  console.log(`Converting ${webmPath} → ${outputGif}`);

  // Convert webm to GIF using ffmpeg with palette for quality
  execSync(
    `ffmpeg -y -i "${webmPath}" ` +
    `-vf "fps=20,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" ` +
    `-loop 0 "${outputGif}"`,
    { stdio: 'inherit' }
  );

  // Clean up temp video
  fs.unlinkSync(webmPath);
  fs.rmdirSync(tmpDir);

  const stats = fs.statSync(outputGif);
  const sizeMb = (stats.size / 1024 / 1024).toFixed(2);
  console.log(`\nDone! demo.gif written — ${sizeMb} MB (${stats.size} bytes)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

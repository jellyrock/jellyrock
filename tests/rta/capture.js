/**
 * Raw UI screenshot for the functional test runner (the RTA_CAPTURE flag). This
 * is the lightweight path for agents to view the GUI while designing UI — it
 * captures the SceneGraph UI plane as-is (single locale, no backdrop, no
 * manifest). The OSD's video plane reads BLACK here (Roku can't screenshot it);
 * that's expected and fine for GUI viewing. The polished, backdrop-composited
 * store screenshots come from scripts/capture-screenshots.js instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { device } from 'roku-test-automation';

export const RAW_CAPTURE_DIR = path.join(process.cwd(), 'out', 'rta-captures');

/** Capture the current screen to out/rta-captures/<name>.png. Warns (does not throw) on a black frame. */
export async function captureRawUI(name, outDir = RAW_CAPTURE_DIR) {
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = path.join('/tmp/rta-shots', `raw-${name}`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  const shot = await device.getScreenshot(tmp);
  const stats = await sharp(shot.path).stats();
  const maxChannel = Math.max(...stats.channels.map((ch) => ch.max));
  if (maxChannel < 8) {
    console.warn(
      `  [capture] ${name} is essentially black (video plane not captured?) — saved anyway`,
    );
  }
  const dest = path.join(outDir, `${name}.png`);
  await sharp(shot.path).png().toFile(dest);
  console.log(`  [capture] ${path.relative(process.cwd(), dest)}`);
  return dest;
}

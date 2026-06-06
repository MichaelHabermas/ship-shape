// Chromium launch smoke test extracted from e2e-preflight.sh.
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export async function probeChromiumLaunch() {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  await browser.close();
  return true;
}

async function main() {
  try {
    await probeChromiumLaunch();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Playwright could not launch Chromium: ${message}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

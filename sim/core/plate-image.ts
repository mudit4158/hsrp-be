import { Browser, chromium, Page } from 'playwright-core';

/**
 * Test photos of number plates for the OCR step (D45): a white HSRP-style plate with the blue IND strip and the
 * registration printed the way plates show it ("WB 02 KF 5437"), drawn on a canvas in a browser page. The real
 * OCR adapter reads the drawn text; the file also ends with "HSRP-PLATE:<text>" so the mock adapter can "read" it.
 * Used by the simulator (in its own windows) and by demo:e2e (headless).
 */
export const PLATE_MARKER = 'HSRP-PLATE:';

export function spacedPlate(regnNo: string) {
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/.exec(regnNo.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : regnNo;
}

/** A number that differs from `regnNo` in its last digit (an embossing mistake, or another vehicle's plate). */
export function wrongPlate(regnNo: string) {
  const last = Number(regnNo.slice(-1));
  return `${regnNo.slice(0, -1)}${Number.isNaN(last) ? 7 : (last + 3) % 10}`;
}

/** Draws the plate in `page` and returns a JPEG (with the mock marker appended). */
export async function renderPlate(page: Page, text: string, caption: string): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ([plate, cap]) => {
      const c = document.createElement('canvas');
      c.width = 960;
      c.height = 520;
      const g = c.getContext('2d')!;
      const bg = g.createLinearGradient(0, 0, 0, 520);
      bg.addColorStop(0, '#6b7a89');
      bg.addColorStop(1, '#3f4b57');
      g.fillStyle = bg;
      g.fillRect(0, 0, 960, 520);
      g.fillStyle = '#ffffff';
      g.fillRect(70, 170, 820, 180);
      g.lineWidth = 7;
      g.strokeStyle = '#111827';
      g.strokeRect(78, 178, 804, 164);
      g.fillStyle = '#1d4ed8';
      g.fillRect(84, 184, 64, 152);
      g.fillStyle = '#ffffff';
      g.font = 'bold 24px Arial';
      g.fillText('IND', 92, 320);
      g.fillStyle = '#111827';
      g.font = 'bold 100px Arial';
      g.textBaseline = 'middle';
      g.fillText(plate, 170, 262, 690);
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.font = '20px Arial';
      g.textBaseline = 'alphabetic';
      g.fillText(cap, 24, 500);
      return c.toDataURL('image/jpeg', 0.9);
    },
    [spacedPlate(text), caption] as const,
  );
  return Buffer.concat([Buffer.from(dataUrl.split(',')[1], 'base64'), Buffer.from(`${PLATE_MARKER}${spacedPlate(text)}`)]);
}

/** A headless browser page for rendering plates outside the simulator (demo:e2e). */
export async function plateRenderer(channel = process.env.SIM_BROWSER ?? 'chrome') {
  const browser: Browser = await chromium.launch({ channel, headless: true });
  const page = await browser.newPage();
  return {
    render: (text: string, caption: string) => renderPlate(page, text, caption),
    close: () => browser.close(),
  };
}

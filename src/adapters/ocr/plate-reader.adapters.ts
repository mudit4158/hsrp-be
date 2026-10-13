import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { PlateReader, PlateReading } from '../../core/ports/plate-reader.port';

/**
 * Real OCR with tesseract.js, run locally in the API process (no outside service). The English model ships with the
 * npm package @tesseract.js-data/eng, so nothing is downloaded at run time. One worker, used one image at a time.
 */
@Injectable()
export class TesseractPlateReader implements PlateReader, OnModuleDestroy {
  private readonly log = new Logger('PlateOCR');
  private worker: Promise<import('tesseract.js').Worker> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  private async getWorker() {
    if (!this.worker) {
      this.worker = (async () => {
        const { createWorker, PSM } = await import('tesseract.js');
        const langPath = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
        const w = await createWorker('eng', 1, { langPath, cachePath: join(tmpdir(), 'hsrp-ocr'), gzip: true });
        // Plates carry upper-case letters and digits only; "auto" layout copes with the IND strip and borders.
        await w.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ', tessedit_pageseg_mode: PSM.AUTO });
        this.log.log('Tesseract worker ready');
        return w;
      })();
    }
    return this.worker;
  }

  read(image: Buffer): Promise<PlateReading> {
    const job = this.queue.then(async () => {
      const w = await this.getWorker();
      const r = await w.recognize(image);
      const text = r.data.text.replace(/\s+/g, ' ').trim();
      return { text: text || null, confidence: Math.round(r.data.confidence), engine: 'tesseract' };
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  async onModuleDestroy() {
    if (this.worker) await (await this.worker).terminate().catch(() => undefined);
  }
}

/** Marker the test-image generators put in the file: the simulator, demo:e2e and the debug app's Test photo. */
export const PLATE_MARKER = 'HSRP-PLATE:';

/**
 * Mock OCR for unit tests and for runs without the OCR model: "reads" the plate text that test images embed after
 * PLATE_MARKER. A real camera photo has no marker, so the mock reads nothing and the check fails.
 */
@Injectable()
export class MockPlateReader implements PlateReader {
  async read(image: Buffer): Promise<PlateReading> {
    const at = image.lastIndexOf(PLATE_MARKER);
    if (at < 0) return { text: null, confidence: null, engine: 'mock' };
    const text = image.subarray(at + PLATE_MARKER.length, at + PLATE_MARKER.length + 40).toString('latin1').split(/[\r\n\0]/)[0].trim();
    return { text: text || null, confidence: 100, engine: 'mock' };
  }
}

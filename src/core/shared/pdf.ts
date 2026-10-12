import type { Response } from 'express';

/** Streams a generated PDF inline (opens in the browser's viewer, still downloadable). */
export function sendPdf(res: Response, file: { filename: string; pdf: Buffer }) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${file.filename}"`);
  res.send(file.pdf);
}

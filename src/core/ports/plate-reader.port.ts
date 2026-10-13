export const PLATE_READER = Symbol('PlateReader');

/** What an OCR engine read from a plate photo. `text` is null when nothing readable was found. */
export interface PlateReading {
  text: string | null;
  /** 0–100 where the engine reports one. */
  confidence: number | null;
  engine: string;
}

/**
 * Reads the registration number off a number-plate photo (embossed plate at the station, fitted plate at the
 * dealer). Adapters: tesseract (real OCR, runs locally) and mock (reads the plate text test images embed).
 */
export interface PlateReader {
  read(image: Buffer, mimeType: string): Promise<PlateReading>;
}

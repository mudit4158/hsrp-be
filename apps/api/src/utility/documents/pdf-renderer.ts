import PDFDocument from 'pdfkit';

/**
 * A small layout language stored as JSON in util_doc_template, so print formats are data, not code.
 * Values are `{{path.to.value}}` placeholders resolved against the data object.
 */
export type LayoutElement =
  | { type: 'heading'; text: string; size?: number; align?: 'left' | 'center' | 'right' }
  | { type: 'text'; text: string; size?: number; align?: 'left' | 'center' | 'right'; bold?: boolean }
  | { type: 'big'; text: string; size?: number; align?: 'left' | 'center' | 'right' }
  | { type: 'fields'; columns?: number; items: Array<{ label: string; value: string }> }
  | { type: 'table'; source: string; columns: Array<{ header: string; value: string; width?: number }> }
  | { type: 'band'; text: string; color: string; when?: string; textColor?: string }
  | { type: 'rule' }
  | { type: 'spacer'; height?: number }
  | { type: 'signature'; labels: string[] };

export interface Layout {
  page?: 'A4' | 'A5' | 'STICKER';
  margin?: number;
  elements: LayoutElement[];
  /** Repeat the elements once per item of this array, one page each (e.g. stickers for several orders). */
  repeatFor?: string;
}

export function getPath(data: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc == null ? undefined : (acc as Record<string, unknown>)[k]), data);
}

export function fill(text: string, data: unknown): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p: string) => {
    const v = getPath(data, p);
    return v === undefined || v === null ? '' : String(v);
  });
}

const PAGE_SIZES: Record<string, [number, number] | string> = { A4: 'A4', A5: 'A5', STICKER: [288, 216] };

export function renderPdf(layout: Layout, data: Record<string, unknown>): Promise<Buffer> {
  const margin = layout.margin ?? 40;
  const doc = new PDFDocument({ size: PAGE_SIZES[layout.page ?? 'A4'] as never, margin, autoFirstPage: false });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const pages = layout.repeatFor ? ((getPath(data, layout.repeatFor) as Record<string, unknown>[]) ?? []) : [data];
  for (const pageData of pages.length ? pages : [data]) {
    doc.addPage();
    const scope = layout.repeatFor ? { ...data, ...pageData } : pageData;
    for (const el of layout.elements) drawElement(doc, el, scope, margin);
  }
  doc.end();
  return done;
}

function drawElement(doc: PDFKit.PDFDocument, el: LayoutElement, data: Record<string, unknown>, margin: number) {
  const width = doc.page.width - margin * 2;
  switch (el.type) {
    case 'heading':
      doc.font('Helvetica-Bold').fontSize(el.size ?? 16).fillColor('#000').text(fill(el.text, data), { align: el.align ?? 'left' });
      doc.moveDown(0.4);
      break;
    case 'text':
      doc.font(el.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(el.size ?? 10).fillColor('#000').text(fill(el.text, data), { align: el.align ?? 'left' });
      break;
    case 'big':
      doc.font('Helvetica-Bold').fontSize(el.size ?? 28).fillColor('#000').text(fill(el.text, data), { align: el.align ?? 'center' });
      break;
    case 'fields': {
      const cols = el.columns ?? 2;
      const colW = width / cols;
      let i = 0;
      let rowY = doc.y;
      for (const item of el.items) {
        const col = i % cols;
        if (col === 0 && i > 0) rowY = doc.y + 4;
        const x = margin + col * colW;
        doc.font('Helvetica').fontSize(8).fillColor('#555').text(item.label, x, rowY, { width: colW - 8 });
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text(fill(item.value, data) || '-', x, rowY + 10, { width: colW - 8 });
        i++;
      }
      doc.x = margin;
      doc.moveDown(0.8);
      break;
    }
    case 'table': {
      const rows = (getPath(data, el.source) as Record<string, unknown>[]) ?? [];
      const totalW = el.columns.reduce((s, c) => s + (c.width ?? 1), 0);
      const widths = el.columns.map((c) => ((c.width ?? 1) / totalW) * width);
      const drawRow = (cells: string[], bold: boolean) => {
        if (doc.y > doc.page.height - margin - 40) doc.addPage();
        const y = doc.y;
        let x = margin;
        let h = 0;
        cells.forEach((c, idx) => {
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#000');
          const ch = doc.heightOfString(c, { width: widths[idx] - 6 });
          doc.text(c, x + 3, y + 3, { width: widths[idx] - 6 });
          h = Math.max(h, ch);
          x += widths[idx];
        });
        doc.moveTo(margin, y + h + 6).lineTo(margin + width, y + h + 6).strokeColor('#bbb').stroke();
        doc.y = y + h + 8;
        doc.x = margin;
      };
      drawRow(el.columns.map((c) => c.header), true);
      rows.forEach((r, idx) => drawRow(el.columns.map((c) => fill(c.value, { ...data, ...r, rowNo: idx + 1 })), false));
      doc.moveDown(0.5);
      break;
    }
    case 'band': {
      if (el.when && !getPath(data, el.when)) break;
      const y = doc.y;
      doc.rect(margin, y, width, 22).fill(el.color);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(el.textColor ?? '#fff').text(fill(el.text, data), margin, y + 6, { width, align: 'center' });
      doc.fillColor('#000');
      doc.y = y + 28;
      doc.x = margin;
      break;
    }
    case 'rule':
      doc.moveTo(margin, doc.y).lineTo(margin + width, doc.y).strokeColor('#000').stroke();
      doc.moveDown(0.5);
      break;
    case 'spacer':
      doc.y += el.height ?? 12;
      break;
    case 'signature': {
      doc.moveDown(2);
      const w = width / el.labels.length;
      const y = doc.y;
      el.labels.forEach((l, idx) => {
        doc.moveTo(margin + idx * w + 10, y).lineTo(margin + (idx + 1) * w - 10, y).strokeColor('#000').stroke();
        doc.font('Helvetica').fontSize(8).text(l, margin + idx * w + 10, y + 4, { width: w - 20, align: 'center' });
      });
      doc.x = margin;
      break;
    }
  }
}

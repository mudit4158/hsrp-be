import { parse } from 'csv-parse/sync';

export function parseCsv(text: string, delimiter = ','): Record<string, string>[] {
  return parse(text, { columns: true, skip_empty_lines: true, trim: true, delimiter, bom: true, relax_column_count: true }) as Record<string, string>[];
}

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: Record<string, unknown>[], columns?: Array<{ key: string; label?: string }>): string {
  const cols = columns ?? Object.keys(rows[0] ?? {}).map((key) => ({ key, label: key }));
  const lines = [cols.map((c) => cell(c.label ?? c.key)).join(',')];
  for (const r of rows) lines.push(cols.map((c) => cell(r[c.key])).join(','));
  return lines.join('\r\n') + '\r\n';
}

export interface ColumnMapping {
  from: string;
  required?: boolean;
  transform?: 'upper' | 'lower' | 'trim' | 'digits' | 'date-dmy';
  default?: string;
}

export interface MappingProfile {
  columns: Record<string, ColumnMapping>;
  context?: Record<string, string>;
}

/** Maps one source row to target fields with the profile; returns errors instead of throwing. */
export function mapRow(raw: Record<string, string>, profile: MappingProfile): { mapped: Record<string, string>; errors: string[] } {
  const mapped: Record<string, string> = {};
  const errors: string[] = [];
  for (const [target, m] of Object.entries(profile.columns)) {
    let v = raw[m.from];
    if (v === undefined || v === '') v = m.default ?? '';
    if (!v) {
      if (m.required) errors.push(`${m.from} is required`);
      continue;
    }
    switch (m.transform) {
      case 'upper':
        v = v.trim().toUpperCase();
        break;
      case 'lower':
        v = v.trim().toLowerCase();
        break;
      case 'digits':
        v = v.replace(/\D/g, '');
        break;
      case 'date-dmy': {
        const mt = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
        if (!mt) errors.push(`${m.from} must be a date like 31-12-2024`);
        else v = `${mt[3]}-${mt[2].padStart(2, '0')}-${mt[1].padStart(2, '0')}`;
        break;
      }
      default:
        v = v.trim();
    }
    mapped[target] = v;
  }
  return { mapped, errors };
}

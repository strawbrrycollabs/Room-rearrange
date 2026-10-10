import type { Unit } from './types';

const CM_PER_IN = 2.54;

export const round = (n: number, d = 0) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/** Compact label for dimensions on the plan. */
export function fmtLen(cm: number, unit: Unit): string {
  if (unit === 'imperial') return fmtImperial(cm);
  if (Math.abs(cm) >= 100) return `${round(cm / 100, 2)} m`;
  return `${round(cm, 1)} cm`;
}

function fmtImperial(cm: number): string {
  const totalIn = Math.round(cm / CM_PER_IN);
  const ft = Math.trunc(totalIn / 12);
  const inch = Math.abs(totalIn % 12);
  return ft === 0 ? `${totalIn}"` : `${ft}'${inch}"`;
}

/** Text shown inside an editable field. */
export function fmtInput(cm: number, unit: Unit): string {
  if (unit === 'imperial') return fmtImperial(cm);
  return `${round(cm, 1)} cm`;
}

/**
 * Parses user input into centimetres. Metric: "320", "320cm", "3.2m", "3,2 m".
 * Imperial: `8'6"`, `8' 6`, `102"`, `8ft 6in`, bare numbers are inches.
 * Returns null when the text cannot be understood.
 */
export function parseLen(text: string, unit: Unit): number | null {
  const s = text.trim().toLowerCase().replace(',', '.');
  if (!s) return null;
  if (unit === 'metric') {
    const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(mm|cm|m)?$/);
    if (!m) return null;
    const v = parseFloat(m[1]);
    return m[2] === 'm' ? v * 100 : m[2] === 'mm' ? v / 10 : v;
  }
  const ftIn = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?)?$/);
  if (ftIn) {
    const ft = parseFloat(ftIn[1]);
    const inch = ftIn[2] ? parseFloat(ftIn[2]) : 0;
    return (ft * 12 + (ft < 0 ? -inch : inch)) * CM_PER_IN;
  }
  const inOnly = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?$/);
  if (inOnly) return parseFloat(inOnly[1]) * CM_PER_IN;
  const cm = s.match(/^(-?\d+(?:\.\d+)?)\s*cm$/);
  if (cm) return parseFloat(cm[1]);
  return null;
}

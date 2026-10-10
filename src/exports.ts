import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { StaticPlan, planViewBox } from './components/StaticPlan';
import type { Furniture, Room, Unit } from './types';
import { analyzeWalkways } from './analysis';
import { findProblems, polygonArea, walls } from './geometry';
import { fmtLen } from './units';

export function download(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const fileSafe = (s: string) => s.replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'room';

/** Renders the 2D plan (always on a white background) to a PNG data URL. */
export async function planToPng(room: Room, items: Furniture[], unit: Unit, opts: { width?: number; title?: string; walkways?: boolean; walkWidth?: number; format?: 'png' | 'jpeg' } = {}): Promise<{ url: string; width: number; height: number }> {
  const width = opts.width ?? 1600;
  const walkways = opts.walkways ? analyzeWalkways(room, items, opts.walkWidth ?? 70) : null;
  const svg = renderToStaticMarkup(createElement(StaticPlan, { room, items, unit, width, title: opts.title, walkways }));
  const vb = planViewBox(room, !!opts.title);
  const height = Math.round((vb.h / vb.w) * width);
  const img = new Image();
  const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('Could not render plan')); img.src = blobUrl; });
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return { url: opts.format === 'jpeg' ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png'), width, height };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/** A4 landscape PDF: plan with dimensions, wall/opening schedule and a furniture table. */
export async function exportPdf(room: Room, layoutName: string, items: Furniture[], unit: Unit, walkWidth: number) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = 297, H = 210, M = 12;
  const L = (cm: number) => fmtLen(cm, unit).replace('×', 'x');
  const area = polygonArea(room.corners);
  const areaTxt = unit === 'metric' ? `${(area / 10000).toFixed(1)} m2` : `${(area / 929.0304).toFixed(0)} sq ft`;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
  doc.text(room.name, M, M + 6);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(110);
  doc.text(`${layoutName}  |  Floor area ${areaTxt}  |  Ceiling ${L(room.ceilingHeight)}  |  ${new Date().toLocaleDateString()}`, M, M + 12);
  doc.setTextColor(0);

  const plan = await planToPng(room, items, unit, { width: 1800, walkways: true, walkWidth, format: 'jpeg' });
  const maxW = 190, maxH = H - M * 2 - 20;
  const ratio = plan.height / plan.width;
  const pw = Math.min(maxW, maxH / ratio), ph = pw * ratio;
  doc.addImage(plan.url, 'JPEG', M, M + 18, pw, ph);

  // Right column: walls and openings.
  let x = M + maxW + 8, y = M + 22;
  const colW = W - M - x;
  const line = (text: string, bold = false, size = 9) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, colW) as string[];
    doc.text(lines, x, y);
    y += lines.length * (size * 0.42) + 1.6;
  };
  line('Walls', true, 11);
  walls(room.corners).forEach((w) => line(`${w.index + 1}.  ${L(w.length)}`));
  y += 3;
  line('Doors, windows, radiators', true, 11);
  if (!room.openings.length) line('None');
  for (const o of room.openings) {
    const sill = o.kind === 'door' ? '' : `, ${L(o.sill)} above floor`;
    line(`${o.kind[0].toUpperCase()}${o.kind.slice(1)}: ${L(o.width)} x ${L(o.height)}${sill}; wall ${o.wall + 1}, ${L(o.offset)} from corner ${o.wall + 1}`);
  }
  y += 3;
  const walk = analyzeWalkways(room, items, walkWidth);
  const probs = findProblems(items, room.corners);
  line('Checks', true, 11);
  line(`Overlaps / outside room: ${probs.size}`);
  line(`Passages narrower than ${L(walkWidth)}: ${walk.count}`);
  line(`Doors blocked by furniture: ${walk.doors.filter((d) => d.blocked).length}`);

  // Furniture table (paginated).
  const header = () => {
    y = M + 8; x = M;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    const cols = [0, 62, 120, 160, 200];
    ['Item', 'Size (W x D x H)', 'Position (x, y)', 'Rotation', 'Notes'].forEach((t, i) => doc.text(t, M + cols[i], y));
    doc.setDrawColor(200); doc.line(M, y + 1.5, W - M, y + 1.5);
    y += 6;
    return cols;
  };
  doc.addPage();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(`${room.name} - ${layoutName}: furniture`, M, M + 4);
  let cols = header(); y += 4;
  doc.setFont('helvetica', 'normal');
  for (const it of items) {
    if (y > H - M) { doc.addPage(); cols = header(); doc.setFont('helvetica', 'normal'); }
    const p = probs.get(it.id);
    const note = [it.locked ? 'locked' : '', p && (p.overlaps.length || p.outside) ? 'overlap / outside' : ''].filter(Boolean).join(', ');
    doc.setFontSize(9);
    doc.text(it.name, M + cols[0], y);
    doc.text(`${L(it.width)} x ${L(it.depth)} x ${L(it.height)}`, M + cols[1], y);
    doc.text(`${L(it.x)}, ${L(it.y)}`, M + cols[2], y);
    doc.text(`${Math.round(it.rotation)} deg`, M + cols[3], y);
    doc.text(note, M + cols[4], y);
    y += 6;
  }
  if (!items.length) doc.text('No furniture in this layout.', M, y);
  doc.save(`${fileSafe(room.name)}_${fileSafe(layoutName)}.pdf`);
}

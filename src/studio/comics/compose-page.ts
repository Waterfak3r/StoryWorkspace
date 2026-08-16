import { comicsPageLayoutLabel } from "./page-group";
import { decodePngRgba, encodePngRgba, type RgbaImage } from "./png-rgba";

const PAGE_WIDTH = 1600;
const MARGIN = 28;
const GUTTER = 18;
const PAPER: [number, number, number, number] = [244, 239, 228, 255];
const INK: [number, number, number, number] = [28, 24, 20, 255];

type Rect = { x: number; y: number; w: number; h: number };

export function composeComicsPagePng(panelPngs: readonly Buffer[]): Buffer {
  if (panelPngs.length === 0) {
    throw new Error("A comics page needs at least one panel.");
  }

  const panels = panelPngs.map((bytes) => decodePngRgba(bytes));
  const rects = panelRects(panels.length);
  const pageHeight = rects.reduce((max, rect) => Math.max(max, rect.y + rect.h), 0) + MARGIN;
  const page = createCanvas(PAGE_WIDTH, pageHeight, PAPER);

  for (let index = 0; index < panels.length; index += 1) {
    const rect = rects[index];
    const panel = panels[index];
    if (!rect || !panel) {
      continue;
    }
    fillRect(page, rect.x - 3, rect.y - 3, rect.w + 6, rect.h + 6, INK);
    fillRect(page, rect.x, rect.y, rect.w, rect.h, PAPER);
    blitContain(page, panel, rect);
  }

  return encodePngRgba(page);
}

export function comicsPageLayoutForCount(panelCount: number): string {
  return comicsPageLayoutLabel(panelCount);
}

function panelRects(count: number): Rect[] {
  const innerW = PAGE_WIDTH - MARGIN * 2;
  const cellW = count === 1 ? innerW : Math.floor((innerW - GUTTER) / 2);
  const cellH = Math.max(220, Math.round(cellW * 0.62));

  if (count === 1) {
    return [{ x: MARGIN, y: MARGIN, w: innerW, h: Math.round(innerW * 0.62) }];
  }
  if (count === 2) {
    const wide = innerW;
    return [
      { x: MARGIN, y: MARGIN, w: wide, h: cellH },
      { x: MARGIN, y: MARGIN + cellH + GUTTER, w: wide, h: cellH },
    ];
  }
  if (count === 3) {
    const wideH = Math.round(innerW * 0.56);
    return [
      { x: MARGIN, y: MARGIN, w: cellW, h: cellH },
      { x: MARGIN + cellW + GUTTER, y: MARGIN, w: cellW, h: cellH },
      { x: MARGIN, y: MARGIN + cellH + GUTTER, w: innerW, h: wideH },
    ];
  }
  return [
    { x: MARGIN, y: MARGIN, w: cellW, h: cellH },
    { x: MARGIN + cellW + GUTTER, y: MARGIN, w: cellW, h: cellH },
    { x: MARGIN, y: MARGIN + cellH + GUTTER, w: cellW, h: cellH },
    { x: MARGIN + cellW + GUTTER, y: MARGIN + cellH + GUTTER, w: cellW, h: cellH },
  ];
}

function createCanvas(width: number, height: number, color: [number, number, number, number]): RgbaImage {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = color[3];
  }
  return { width, height, data };
}

function fillRect(
  image: RgbaImage,
  x: number,
  y: number,
  w: number,
  h: number,
  color: [number, number, number, number],
) {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(image.width, x + w);
  const y1 = Math.min(image.height, y + h);
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const i = (py * image.width + px) * 4;
      image.data[i] = color[0];
      image.data[i + 1] = color[1];
      image.data[i + 2] = color[2];
      image.data[i + 3] = color[3];
    }
  }
}

function blitContain(dest: RgbaImage, src: RgbaImage, rect: Rect) {
  const scale = Math.min(rect.w / src.width, rect.h / src.height);
  const dw = Math.max(1, Math.floor(src.width * scale));
  const dh = Math.max(1, Math.floor(src.height * scale));
  const ox = rect.x + Math.floor((rect.w - dw) / 2);
  const oy = rect.y + Math.floor((rect.h - dh) / 2);
  for (let y = 0; y < dh; y += 1) {
    const sy = Math.min(src.height - 1, Math.floor((y / dh) * src.height));
    for (let x = 0; x < dw; x += 1) {
      const sx = Math.min(src.width - 1, Math.floor((x / dw) * src.width));
      const si = (sy * src.width + sx) * 4;
      const dx = ox + x;
      const dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= dest.width || dy >= dest.height) {
        continue;
      }
      const di = (dy * dest.width + dx) * 4;
      dest.data[di] = src.data[si] ?? 0;
      dest.data[di + 1] = src.data[si + 1] ?? 0;
      dest.data[di + 2] = src.data[si + 2] ?? 0;
      dest.data[di + 3] = 255;
    }
  }
}

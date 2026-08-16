import { describe, expect, it } from "vitest";

import { composeComicsPagePng } from "./compose-page";
import { decodePngRgba, encodePngRgba } from "./png-rgba";

describe("composeComicsPagePng", () => {
  it("draws three distinct panels into one connected page image", () => {
    const red = encodePngRgba(solid(8, 8, [200, 20, 20, 255]));
    const green = encodePngRgba(solid(8, 8, [20, 180, 40, 255]));
    const blue = encodePngRgba(solid(8, 8, [20, 40, 200, 255]));

    const page = composeComicsPagePng([red, green, blue]);
    const decoded = decodePngRgba(page);

    expect(decoded.width).toBe(1600);
    expect(decoded.height).toBeGreaterThan(decoded.width * 0.4);
    expect(hasColorNear(decoded, 200, 20, 20)).toBe(true);
    expect(hasColorNear(decoded, 20, 180, 40)).toBe(true);
    expect(hasColorNear(decoded, 20, 40, 200)).toBe(true);
  });
});

function solid(width: number, height: number, color: [number, number, number, number]) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = color[3];
  }
  return { width, height, data };
}

function hasColorNear(
  image: { width: number; height: number; data: Buffer },
  r: number,
  g: number,
  b: number,
) {
  for (let i = 0; i < image.data.length; i += 4) {
    const dr = Math.abs((image.data[i] ?? 0) - r);
    const dg = Math.abs((image.data[i + 1] ?? 0) - g);
    const db = Math.abs((image.data[i + 2] ?? 0) - b);
    if (dr < 8 && dg < 8 && db < 8) {
      return true;
    }
  }
  return false;
}

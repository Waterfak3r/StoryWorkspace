import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type RgbaImage = {
  width: number;
  height: number;
  data: Buffer;
};

export function encodePngRgba(image: RgbaImage): Buffer {
  const { width, height, data } = image;
  if (data.length !== width * height * 4) {
    throw new Error("RGBA buffer length does not match width and height.");
  }

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    data.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function decodePngRgba(bytes: Buffer): RgbaImage {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Not a PNG file.");
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  let offset = 8;

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
  }

  if (width < 1 || height < 1 || bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error("Unsupported PNG format.");
  }

  const bpp = colorType === 6 ? 4 : 3;
  const inflated = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const expected = (stride + 1) * height;
  if (inflated.length < expected) {
    throw new Error("PNG data is truncated.");
  }

  const unfiltered = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[y * (stride + 1)] ?? 0;
    const row = inflated.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = unfiltered.subarray(y * stride, (y + 1) * stride);
    unfilterRow(filter, row, out, prev, bpp);
    prev = Buffer.from(out);
  }

  if (colorType === 6) {
    return { width, height, data: unfiltered };
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < unfiltered.length; i += 3, j += 4) {
    rgba[j] = unfiltered[i] ?? 0;
    rgba[j + 1] = unfiltered[i + 1] ?? 0;
    rgba[j + 2] = unfiltered[i + 2] ?? 0;
    rgba[j + 3] = 255;
  }
  return { width, height, data: rgba };
}

function unfilterRow(filter: number, row: Buffer, out: Buffer, prev: Buffer, bpp: number) {
  for (let i = 0; i < row.length; i += 1) {
    const x = row[i] ?? 0;
    const a = i >= bpp ? (out[i - bpp] ?? 0) : 0;
    const b = prev[i] ?? 0;
    const c = i >= bpp ? (prev[i - bpp] ?? 0) : 0;
    let value = x;
    if (filter === 1) {
      value = (x + a) & 255;
    } else if (filter === 2) {
      value = (x + b) & 255;
    } else if (filter === 3) {
      value = (x + ((a + b) >> 1)) & 255;
    } else if (filter === 4) {
      value = (x + paeth(a, b, c)) & 255;
    } else if (filter !== 0) {
      throw new Error("Unsupported PNG filter.");
    }
    out[i] = value;
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  if (pb <= pc) {
    return b;
  }
  return c;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 4, "ascii");
  const crcInput = Buffer.concat([header.subarray(4, 8), data]);
  const footer = Buffer.alloc(4);
  footer.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([header, data, footer]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i] ?? 0;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

import "server-only";

import type { ImageAdapterInput, ImageAdapterResult } from "./adapter";
import { writeShotImageFile } from "./image-output";

/** Valid 1×1 RGBA PNG. Tests assert a real file, not an empty buffer. */
export const FAKE_PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex",
);

export function fakeImageAdapter(input: ImageAdapterInput): ImageAdapterResult {
  return writeShotImageFile(input, FAKE_PNG_BYTES);
}

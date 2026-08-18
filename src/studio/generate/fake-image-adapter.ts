import "server-only";

import type { ImageAdapterInput, ImageAdapterResult } from "./adapter";
import { writeShotImageFile } from "./image-output";

/** Valid 64×64 RGBA PNG used by the test adapter. Live pages must be larger than a 1×1 stub. */
export const FAKE_PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000040000000400806000000aa6971de000000644944415478daedd0411100000803a0f54fb6569ac393070548dbf92c020408102040800001020408102040800001020408102040800001020408102040800001020408102040800001020408102040800001020408102040800001020408102040c07d0bb403731cf2aede860000000049454e44ae426082",
  "hex",
);

/** 1×1 PNG. A live Image API fallback must not treat this as a finished comics page. */
export const STUB_PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex",
);

export function fakeImageAdapter(input: ImageAdapterInput): ImageAdapterResult {
  return writeShotImageFile(input, FAKE_PNG_BYTES);
}

import { describe, expect, it } from "vitest";
import {
  FAKE_VIDEO_CAPABILITY_PROFILE,
  compileShotInputSchema,
  createReferenceAssetInputSchema,
  providerCapabilityProfileSchema,
} from "./generation-compiler";

describe("Phase 5B compiler domain contract", () => {
  it("publishes one strict, versioned Fake Video capability profile", () => {
    expect(providerCapabilityProfileSchema.parse(FAKE_VIDEO_CAPABILITY_PROFILE)).toEqual(FAKE_VIDEO_CAPABILITY_PROFILE);
    expect(() => providerCapabilityProfileSchema.parse({ ...FAKE_VIDEO_CAPABILITY_PROFILE, unknown: true })).toThrow();
    expect(FAKE_VIDEO_CAPABILITY_PROFILE).toMatchObject({
      id: "fake-video-v1",
      provider: "fake-video",
      version: "1",
      supports: { maxReferenceImages: 2 },
      limits: { durationSeconds: [4, 6, 8], aspectRatios: ["16:9", "9:16"] },
    });
  });

  it("normalizes compile defaults and rejects duplicate reference IDs or unknown fields", () => {
    const assetId = "11111111-1111-4111-8111-111111111111";
    expect(compileShotInputSchema.parse({ requestId: "compile" })).toEqual({
      capabilityProfileId: "fake-video-v1",
      referenceAssetIds: [],
      parameters: {},
      requestId: "compile",
      actorId: "local-user",
    });
    expect(() => compileShotInputSchema.parse({ requestId: "duplicate", referenceAssetIds: [assetId, assetId] })).toThrow(/unique/i);
    expect(() => compileShotInputSchema.parse({ requestId: "strict", unexpected: true })).toThrow();
  });

  it("keeps approved reference metadata commands strict and actor-aware", () => {
    const entityId = "22222222-2222-4222-8222-222222222222";
    expect(createReferenceAssetInputSchema.parse({ entityId, label: " Lin identity ", requestId: "asset" })).toEqual({ entityId, label: "Lin identity", requestId: "asset", actorId: "local-user" });
    expect(() => createReferenceAssetInputSchema.parse({ entityId, label: "Reference", requestId: "asset", status: "approved" })).toThrow();
  });
});

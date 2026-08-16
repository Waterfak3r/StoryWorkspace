import {
  putProviderSettingsSchema,
  toPublicProviderSettings,
  updateProviderSettings,
} from "@/studio/settings";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return runStudioRoute(() => studioDataResponse(toPublicProviderSettings()));
}

export async function PUT(request: Request) {
  return runStudioRoute(async () => {
    const input = await parseStudioBody(request, putProviderSettingsSchema);
    updateProviderSettings(input);
    return studioDataResponse(toPublicProviderSettings());
  });
}

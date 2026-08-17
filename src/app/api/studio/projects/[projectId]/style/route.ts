import { updateStyleInputSchema } from "@/studio/domain";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";
import { COMICS_STYLE_PRESETS, readProjectStyle, selectComicsStyle } from "@/studio/style";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StyleRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: StyleRouteContext) {
  return runStudioRoute(async () => {
    const { projectId } = await context.params;
    return studioDataResponse({
      style: readProjectStyle(projectId),
      presets: COMICS_STYLE_PRESETS.map((preset) => ({
        id: preset.id,
        label: preset.label,
        visual: preset.visual,
      })),
    });
  });
}

export async function PUT(request: Request, context: StyleRouteContext) {
  return runStudioRoute(async () => {
    const { projectId } = await context.params;
    const input = await parseStudioBody(request, updateStyleInputSchema);
    const style = selectComicsStyle(projectId, input.presetId);
    return studioDataResponse({
      style,
      presets: COMICS_STYLE_PRESETS.map((preset) => ({
        id: preset.id,
        label: preset.label,
        visual: preset.visual,
      })),
    });
  });
}

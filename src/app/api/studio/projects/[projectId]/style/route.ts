import { updateStyleInputSchema } from "@/studio/domain";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";
import { applyComicsStylePatch, COMICS_STYLE_PRESETS, readProjectStyle } from "@/studio/style";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StyleRouteContext = {
  params: Promise<{ projectId: string }>;
};

function styleView(projectId: string, style = readProjectStyle(projectId)) {
  return {
    style,
    presets: COMICS_STYLE_PRESETS.map((preset) => ({
      id: preset.id,
      label: preset.label,
      visual: preset.visual,
    })),
  };
}

export async function GET(_request: Request, context: StyleRouteContext) {
  return runStudioRoute(async () => {
    const { projectId } = await context.params;
    return studioDataResponse(styleView(projectId));
  });
}

export async function PUT(request: Request, context: StyleRouteContext) {
  return runStudioRoute(async () => {
    const { projectId } = await context.params;
    const input = await parseStudioBody(request, updateStyleInputSchema);
    const style = applyComicsStylePatch(projectId, input);
    return studioDataResponse(styleView(projectId, style));
  });
}

export async function PATCH(request: Request, context: StyleRouteContext) {
  return runStudioRoute(async () => {
    const { projectId } = await context.params;
    const input = await parseStudioBody(request, updateStyleInputSchema);
    const style = applyComicsStylePatch(projectId, input);
    return studioDataResponse(styleView(projectId, style));
  });
}

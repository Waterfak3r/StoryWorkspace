import { addEntityReferenceImage } from "@/studio/generate/entity-references";
import { StudioValidationError } from "@/studio/errors";
import { runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;

type EntityReferenceRouteContext = {
  params: Promise<{ projectId: string; entityId: string }>;
};

export async function POST(request: Request, context: EntityReferenceRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, entityId } = await context.params;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new StudioValidationError("A reference image file is required.", "file");
    }
    if (file.size > MAX_BYTES) {
      throw new StudioValidationError("Reference image must be 8 MB or smaller.", "file");
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const { entity, relativePath } = addEntityReferenceImage(projectId, entityId, bytes, file.name);
    return studioDataResponse({ entity, relativePath }, 201);
  });
}

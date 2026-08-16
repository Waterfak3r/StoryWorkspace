import { StudioWorkspace } from "@/features/studio/StudioWorkspace";
import { readSectionParam } from "@/features/studio/sections";

type ProjectPageContext = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ section?: string | string[] }>;
};

export default async function ProjectPage({ params, searchParams }: ProjectPageContext) {
  const { projectId } = await params;
  const query = await searchParams;
  return <StudioWorkspace projectId={projectId} initialSection={readSectionParam(query.section)} />;
}

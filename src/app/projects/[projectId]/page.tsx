import { notFound } from "next/navigation";
import { NarrativeWorkspace } from "@/features/workspace/NarrativeWorkspace";
import { getNarrativeWorkspace } from "@/server/db/narrative";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProjectPageContext = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectPage({ params }: ProjectPageContext) {
  const { projectId } = await params;
  const workspace = getNarrativeWorkspace(projectId);

  if (!workspace) {
    notFound();
  }

  return <NarrativeWorkspace initialWorkspace={workspace} />;
}

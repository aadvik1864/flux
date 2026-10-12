import { ExperimentsPage } from "../../../../components/experiments-page";
import { Protected } from "../../../../components/session";
export default async function BranchesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Protected><ExperimentsPage fileId={id} /></Protected>;
}

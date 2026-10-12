import { DocumentPage } from "../../../../../components/document-page";
import { Protected } from "../../../../../components/session";
export default async function ExperimentPage({ params }: { params: Promise<{ id: string; branchId: string }> }) {
  const { id, branchId } = await params;
  return <Protected><DocumentPage fileId={id} branchId={branchId} /></Protected>;
}

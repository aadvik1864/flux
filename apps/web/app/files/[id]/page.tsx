import { DocumentPage } from "../../../components/document-page";
import { Protected } from "../../../components/session";

export default async function FilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Protected><DocumentPage fileId={id} /></Protected>;
}

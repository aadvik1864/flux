import { HistoryPage } from "../../../../components/history-page";
import { Protected } from "../../../../components/session";

export default async function DocumentHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Protected><HistoryPage fileId={id} /></Protected>;
}

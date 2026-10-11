import { Dashboard } from "../../../components/dashboard";
import { Protected } from "../../../components/session";

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Protected><Dashboard workspaceId={id} /></Protected>;
}

import { InvitePanel } from "../../../components/invite-panel";
import { Protected } from "../../../components/session";

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Protected><InvitePanel token={token} /></Protected>;
}

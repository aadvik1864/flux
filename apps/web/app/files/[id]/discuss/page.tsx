import { DiscussionPage } from "../../../../components/discussion-page";
import { Protected } from "../../../../components/session";

export default async function FileDiscussion({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ branchId?: string | string[] }>;
}) {
  const { id } = await params, { branchId } = await searchParams;
  return <Protected><DiscussionPage key={typeof branchId === "string" ? branchId : "main"} fileId={id} branchId={typeof branchId === "string" ? branchId : undefined} /></Protected>;
}

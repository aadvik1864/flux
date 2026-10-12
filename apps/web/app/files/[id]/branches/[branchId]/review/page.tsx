import { MergeReviewPage } from "../../../../../../components/merge-review-page";
import { Protected } from "../../../../../../components/session";
export default async function ReviewPage({ params }: { params: Promise<{ id: string; branchId: string }> }) {
  const { id, branchId } = await params;
  return <Protected><MergeReviewPage fileId={id} branchId={branchId} /></Protected>;
}

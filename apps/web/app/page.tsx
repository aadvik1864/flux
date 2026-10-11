import { Dashboard } from "../components/dashboard";
import { Protected } from "../components/session";

export default function HomePage() {
  return <Protected><Dashboard /></Protected>;
}

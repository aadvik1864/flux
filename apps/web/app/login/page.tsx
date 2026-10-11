import { Suspense } from "react";
import { AuthPanel } from "../../components/auth-panel";

export default function LoginPage() {
  return <Suspense fallback={<div className="loading-screen">Opening Flux…</div>}><AuthPanel /></Suspense>;
}

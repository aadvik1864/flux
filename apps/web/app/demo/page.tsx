import type { Metadata } from "next";
import { DemoPage } from "../../components/demo-page";
import "./demo.css";

export const metadata: Metadata = {
  title: "Explore Flux: a read-only demo",
  description: "Follow a shared document through an experiment, reviewed merge, and Decision Bookmark. No account needed.",
};

export default function Demo() {
  return <DemoPage />;
}

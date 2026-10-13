import type { DocumentContent } from "@flux/shared";

function paragraph(blockId: string, text: string): DocumentContent {
  return { type: "paragraph", attrs: { blockId }, content: [{ type: "text", text }] };
}

function heading(blockId: string, text: string): DocumentContent {
  return { type: "heading", attrs: { blockId, level: 2 }, content: [{ type: "text", text }] };
}

const welcome = heading("welcome", "A morning in the garden");
const originalTime = paragraph("opening", "Open the gates at 9 am for a 45-minute guided walk. Leave time for questions at the seed table afterwards.");
const laterTime = paragraph("opening", "Open the gates at 9:30 am for a 45-minute guided walk. Leave time for questions at the seed table afterwards.");
const people = paragraph("people", "Hana welcomes visitors at the gate. Ravi leads the walk, and Jules looks after the seed table.");
const access = paragraph("access", "Keep the step-free route clear and put a bench beside the seed table. Visitors can join the walk or explore at their own pace.");
const supplies = heading("supplies", "Before the gates open");
const checklist: DocumentContent = {
  type: "bulletList",
  attrs: { blockId: "checklist" },
  content: ["Fill the water jug and bring reusable cups.", "Label the seedlings with names and care notes.", "Put the route map beside the gate."].map((text, index) => ({
    type: "listItem", attrs: { blockId: `task-${index}` }, content: [paragraph(`task-text-${index}`, text)],
  })),
};

export const demoDocuments = {
  base: { type: "doc", content: [welcome, originalTime, people, supplies, checklist] },
  main: { type: "doc", content: [welcome, originalTime, people, access, supplies, checklist] },
  experiment: { type: "doc", content: [welcome, laterTime, people, supplies, checklist] },
  merged: { type: "doc", content: [welcome, laterTime, people, access, supplies, checklist] },
} satisfies Record<string, DocumentContent>;

export const demoDiscussion = [
  { name: "Ravi", color: "#3f567f", text: "Could we open half an hour later? That gives the volunteers time to set up without rushing." },
  { name: "Hana", color: "#784587", text: "9:30 works. Keep the step-free route note I added on main; it should stay in the final plan." },
];

export const demoDecision = {
  title: "Open at 9:30 am",
  explanation: "Give volunteers enough setup time while keeping the walk short enough for families. The accessibility note from main stays in the final plan.",
  blockId: "opening",
  checkpoint: "Later opening proposal",
  status: "Accepted",
};

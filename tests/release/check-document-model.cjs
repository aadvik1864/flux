// Match the compiled API's CommonJS -> ESM boundary, not the dev tsx loader.
const assert = require("node:assert/strict");
const { inspectDocumentState, prepareContentUpdate, yDocFromContent, blockIdentities } = require("@flux/document-model");
const content = { type: "doc", content: [{ type: "paragraph", attrs: { blockId: "first" }, content: [{ type: "text", text: "Saved context." }] },
  { type: "paragraph", attrs: { blockId: "second" }, content: [{ type: "text", text: "Decision anchor." }] }] };
const document = yDocFromContent(content);
try {
  const { state } = prepareContentUpdate(document, content), inspected = inspectDocumentState(state);
  assert.equal(JSON.stringify(inspected.content), JSON.stringify(content));
  assert.deepEqual(inspected.identities, blockIdentities(document));
  assert.equal(inspected.identities.size, 2);
  console.log("CommonJS API / ESM document-model inspection passed without mixed Yjs constructors.");
} finally { document.destroy(); }

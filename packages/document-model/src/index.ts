import { Extension, getSchema, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { yDocToProsemirrorJSON, prosemirrorJSONToYDoc, initProseMirrorDoc, updateYFragment } from "y-prosemirror";
import * as Y from "yjs";
import { DOCUMENT_SCHEMA_VERSION, type DocumentContent } from "@flux/shared";

export { DOCUMENT_SCHEMA_VERSION };
export { analyzeMerge, resolveMerge } from "./merge.js";
export const blockTypes = ["paragraph", "heading", "blockquote", "bulletList", "orderedList", "listItem", "codeBlock", "horizontalRule", "table", "tableRow", "tableCell", "tableHeader"];

export const BlockAttributes = Extension.create({
  name: "blockAttributes",
  addGlobalAttributes() {
    return [{ types: blockTypes, attributes: { blockId: {
      default: null,
      parseHTML: element => element.getAttribute("data-block-id"),
      renderHTML: attributes => attributes.blockId ? { "data-block-id": attributes.blockId } : {},
    } } }];
  },
});

export function documentExtensions() {
  return [
    StarterKit.configure({ undoRedo: false, heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
    TableKit.configure({ table: { resizable: false } }),
    BlockAttributes,
  ];
}

const schema = getSchema(documentExtensions());

// Reject unsupported structures before snapshots become long-lived artifacts.
export function validateDocument(content: DocumentContent, schemaVersion = DOCUMENT_SCHEMA_VERSION): DocumentContent {
  if (schemaVersion !== DOCUMENT_SCHEMA_VERSION) throw new Error("This checkpoint uses an unsupported document schema");
  if (!content || content.type !== "doc") throw new Error("Invalid document root");
  let count = 0;
  const ids = new Set<string>();
  function visit(node: DocumentContent, depth: number) {
    if (++count > 50_000 || depth > 60) throw new Error("Document is too large or deeply nested");
    if (blockTypes.includes(node.type)) {
      const id = node.attrs?.blockId;
      if (typeof id !== "string" || !id || id.length > 100 || ids.has(id)) throw new Error("Document blocks need unique, stable IDs");
      ids.add(id);
    }
    if (node.content) {
      if (!Array.isArray(node.content)) throw new Error("Invalid document content");
      for (const child of node.content) visit(child, depth + 1);
    }
  }
  visit(content, 0);
  const document = schema.nodeFromJSON(content);
  document.check();
  return document.toJSON() as DocumentContent;
}

export function contentFromYDoc(document: Y.Doc): DocumentContent {
  return validateDocument(yDocToProsemirrorJSON(document, "default") as DocumentContent);
}

export function yDocFromContent(content: DocumentContent, schemaVersion = DOCUMENT_SCHEMA_VERSION): Y.Doc {
  return prosemirrorJSONToYDoc(schema, validateDocument(content, schemaVersion) as JSONContent, "default");
}

/** Prepare an incremental update against existing CRDT identities, never import a fresh document into a live room. */
export function prepareContentUpdate(document: Y.Doc, content: DocumentContent) {
  const target = validateDocument(content);
  const clone = new Y.Doc();
  try {
    Y.applyUpdate(clone, Y.encodeStateAsUpdate(document));
    const fragment = clone.getXmlFragment("default");
    const { meta } = initProseMirrorDoc(fragment, schema);
    clone.transact(() => updateYFragment(clone, fragment, schema.nodeFromJSON(target), meta), "approved-merge");
    const actual = contentFromYDoc(clone);
    if (JSON.stringify(actual) !== JSON.stringify(target)) throw new Error("The approved merge could not be represented safely");
    return { update: Y.encodeStateAsUpdate(clone, Y.encodeStateVector(document)), state: Y.encodeStateAsUpdate(clone), content: actual };
  } finally { clone.destroy(); }
}

/** Block IDs name content; the CRDT item identity prevents reattachment after deletion/recreation. */
export function blockIdentities(document: Y.Doc): Map<string, string> {
  const result = new Map<string, string>();
  let count = 0;
  function visit(fragment: Y.XmlFragment, depth: number) {
    if (depth > 60) throw new Error("Document is too deeply nested");
    for (const child of fragment.toArray()) {
      if (++count > 50_000) throw new Error("Document is too large");
      if (!(child instanceof Y.XmlElement)) continue;
      const blockId = child.getAttribute("blockId"), item = child._item;
      if (typeof blockId === "string" && item) {
        if (result.has(blockId)) throw new Error("Document has duplicate block IDs");
        result.set(blockId, `${item.id.client}:${item.id.clock}`);
      }
      visit(child, depth + 1);
    }
  }
  visit(document.getXmlFragment("default"), 0);
  return result;
}

/** Keep decoding and constructor-sensitive inspection in this module's Yjs instance. */
export function inspectDocumentState(state: Uint8Array) {
  if (state.byteLength > 8 * 1024 * 1024) throw new Error("Document exceeds the 8 MiB recovery-state limit");
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, state);
    const identities = blockIdentities(document);
    return { identities, content: contentFromYDoc(document) };
  } finally { document.destroy(); }
}

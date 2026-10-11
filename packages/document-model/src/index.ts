import { Extension, getSchema, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { yDocToProsemirrorJSON, prosemirrorJSONToYDoc } from "y-prosemirror";
import type * as Y from "yjs";
import { DOCUMENT_SCHEMA_VERSION, type DocumentContent } from "@flux/shared";

export { DOCUMENT_SCHEMA_VERSION };
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

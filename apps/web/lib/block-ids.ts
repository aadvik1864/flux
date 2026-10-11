import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { blockTypes } from "@flux/document-model";

// Establish stable identifiers before introducing checkpoints and comparison.
export const BlockIds = Extension.create({
  name: "blockIds",
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction(transactions, _oldState, newState) {
        if (!transactions.some(transaction => transaction.docChanged)) return null;
        const seen = new Set<string>();
        const transaction = newState.tr;
        newState.doc.descendants((node, position) => {
          if (!blockTypes.includes(node.type.name)) return;
          const id = node.attrs.blockId;
          if (typeof id !== "string" || !id || seen.has(id)) {
            const nextId = crypto.randomUUID();
            transaction.setNodeMarkup(position, undefined, { ...node.attrs, blockId: nextId });
            seen.add(nextId);
          } else seen.add(id);
        });
        return transaction.docChanged ? transaction : null;
      },
    })];
  },
});

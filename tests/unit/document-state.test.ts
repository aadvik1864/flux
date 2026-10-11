import { describe, expect, it } from "vitest";
import * as Y from "yjs";

describe("collaborative recovery primitives", () => {
  it("converges after independent offline edits", () => {
    const first = new Y.Doc();
    first.getText("text").insert(0, "Proposal");
    const second = new Y.Doc();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    first.getText("text").insert(0, "Team ");
    second.getText("text").insert(8, " draft");
    const firstUpdate = Y.encodeStateAsUpdate(first);
    const secondUpdate = Y.encodeStateAsUpdate(second);
    Y.applyUpdate(first, secondUpdate);
    Y.applyUpdate(second, firstUpdate);
    expect(first.getText("text").toString()).toBe(second.getText("text").toString());
    expect(first.getText("text").toString()).toContain("Team");
    first.destroy(); second.destroy();
  });
  it("retains deletions in the full persisted state", () => {
    const live = new Y.Doc();
    live.getText("text").insert(0, "old content");
    live.getText("text").delete(0, 4);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(live));
    expect(restored.getText("text").toString()).toBe("content");
    live.destroy(); restored.destroy();
  });
});

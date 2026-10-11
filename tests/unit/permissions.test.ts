import { describe, expect, it } from "vitest";
import { can, roles, colorForUser, branchRoom } from "@flux/shared";

describe("workspace permissions", () => {
  it.each(roles)("only editing roles can edit: %s", role => {
    expect(can(role, "edit")).toBe(["OWNER", "ADMIN", "EDITOR"].includes(role));
  });
  it.each(roles)("approval is separate from editing: %s", role => {
    expect(can(role, "review")).toBe(["OWNER", "ADMIN", "REVIEWER"].includes(role));
  });
  it.each(roles)("only owner and admin can manage members: %s", role => {
    expect(can(role, "manageMembers")).toBe(["OWNER", "ADMIN"].includes(role));
  });
  it("uses different collaboration rooms for different branches", () => {
    expect(branchRoom("main-id")).not.toBe(branchRoom("experiment-id"));
  });
  it("gives a user a stable, accessible presence color", () => {
    expect(colorForUser("alice")).toBe(colorForUser("alice"));
    expect(colorForUser("alice")).toMatch(/^#[a-f0-9]{6}$/);
  });
});

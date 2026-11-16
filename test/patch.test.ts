import { describe, expect, it } from "vitest";
import { isNear, touchedOldLines } from "../src/classify/patch.ts";

describe("touchedOldLines", () => {
  it("records deleted and replaced lines on the old side", () => {
    const patch = ["@@ -10,4 +10,4 @@", " a", "-b", "+B", " c", " d"].join("\n");
    // Only the replaced line counts, not its neighbours.
    expect(touchedOldLines(patch)).toEqual([11]);
  });

  it("records a pure insertion against the surrounding old lines", () => {
    const patch = ["@@ -20,2 +20,3 @@", " a", "+inserted", " b"].join("\n");
    // Inserted after old line 20, before old line 21.
    expect(touchedOldLines(patch)).toEqual([20, 21]);
  });

  it("tracks line numbers across several hunks", () => {
    const patch = ["@@ -1,2 +1,2 @@", "-x", "+y", " z", "@@ -50,2 +50,1 @@", " keep", "-gone"].join("\n");
    expect(touchedOldLines(patch)).toEqual([1, 51]);
  });

  it("ignores the no-newline marker", () => {
    const patch = ["@@ -3,1 +3,1 @@", "-old", "\\ No newline at end of file", "+new"].join("\n");
    expect(touchedOldLines(patch)).toEqual([3]);
  });
});

describe("isNear", () => {
  it("is inclusive of the proximity window", () => {
    expect(isNear([43], 40, 3)).toBe(true);
    expect(isNear([44], 40, 3)).toBe(false);
    expect(isNear([], 40, 3)).toBe(false);
  });
});

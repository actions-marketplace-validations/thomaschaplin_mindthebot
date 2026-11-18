import { describe, expect, it } from "vitest";
import { listInput, parseOutputs } from "../src/action-inputs.ts";

describe("listInput", () => {
  it("splits on commas and newlines and drops blanks", () => {
    expect(listInput("acme/api, acme/web\n\nacme/docs ,")).toEqual(["acme/api", "acme/web", "acme/docs"]);
    expect(listInput("")).toEqual([]);
  });
});

describe("parseOutputs", () => {
  it("accepts known targets", () => {
    expect(parseOutputs("job-summary, none")).toEqual(["job-summary", "none"]);
  });

  it("rejects unknown targets", () => {
    expect(() => parseOutputs("issue")).toThrow(/Unknown output "issue"/);
  });
});

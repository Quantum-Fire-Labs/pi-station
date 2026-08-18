import { describe, expect, it } from "vitest";
import { pwaIdentity } from "./pwa-identity";

describe("Pi Station PWA identity", () => {
  it("uses the canonical product name and application identity", () => {
    expect(pwaIdentity).toEqual({
      id: "/",
      name: "Pi Station",
      shortName: "Pi Station",
      description: "Work with Pi Sessions",
    });
  });
});

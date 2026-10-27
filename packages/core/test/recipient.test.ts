import { describe, expect, it } from "vitest";
import { checkRecipient } from "../src/recipient.ts";

describe("checkRecipient", () => {
  it("accepts well-formed addresses", () => {
    expect(checkRecipient("sol", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")).toBeNull();
    expect(checkRecipient("eth", "0x000000000000000000000000000000000000dEaD")).toBeNull();
    expect(checkRecipient("tron", "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7")).toBeNull();
    expect(checkRecipient("btc", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).toBeNull();
    expect(checkRecipient("near", "alice.near")).toBeNull();
  });

  it("rejects the wrong chain's format and empty input", () => {
    expect(checkRecipient("sol", "0x000000000000000000000000000000000000dEaD")).toMatch(/sol/);
    expect(checkRecipient("eth", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")).toMatch(/eth/);
    expect(checkRecipient("sol", "  ")).toMatch(/Enter/);
  });

  it("does not block chains it does not know", () => {
    expect(checkRecipient("cardano", "addr1anything")).toBeNull();
  });
});

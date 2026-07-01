import { describe, expect, test } from "@/test";
import { parseMailFrom } from "./parse-from";

describe("parseMailFrom", () => {
  test("parses name and email", () => {
    expect(parseMailFrom("Archestra <noreply@example.com>")).toEqual({
      name: "Archestra",
      email: "noreply@example.com",
    });
  });

  test("parses quoted display name", () => {
    expect(parseMailFrom('"Aleks M" <hello@alexmesch.com>')).toEqual({
      name: "Aleks M",
      email: "hello@alexmesch.com",
    });
  });

  test("parses bare email address", () => {
    expect(parseMailFrom("noreply@example.com")).toEqual({
      name: "Archestra",
      email: "noreply@example.com",
    });
  });

  test("returns null for empty input", () => {
    expect(parseMailFrom("")).toBeNull();
    expect(parseMailFrom("   ")).toBeNull();
  });
});

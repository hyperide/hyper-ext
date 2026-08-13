/**
 * @file Tests for Tamagui color token values and lookup functions
 *
 * Accessed via: Internal module, not exposed
 */
import { describe, expect, it } from "bun:test";
import {
  findNearestTamaguiTokens,
  getAllTamaguiColors,
  getTamaguiTokenFromHex,
  TAMAGUI_SEMANTIC_TOKENS,
} from "../values";

describe("getAllTamaguiColors", () => {
  it("should include palette tokens", () => {
    const colors = getAllTamaguiColors();
    const blue9 = colors.find((c) => c.token === "blue9");
    expect(blue9).toBeTruthy();
    expect(blue9?.hex).toBe("#0090ff");

    const red1 = colors.find((c) => c.token === "red1");
    expect(red1).toBeTruthy();
    expect(red1?.hex).toBe("#fffcfc");
  });

  it("should include semantic tokens", () => {
    const colors = getAllTamaguiColors();

    const color12 = colors.find((c) => c.token === "color12");
    expect(color12).toBeTruthy();
    expect(color12?.hex).toBe("#202020");

    const background1 = colors.find((c) => c.token === "background1");
    expect(background1).toBeTruthy();
    expect(background1?.hex).toBe("#fcfcfc");
  });

  it("should place palette tokens before semantic tokens", () => {
    const colors = getAllTamaguiColors();
    const gray9Index = colors.findIndex((c) => c.token === "gray9");
    const color9Index = colors.findIndex((c) => c.token === "color9");

    expect(gray9Index).toBeGreaterThanOrEqual(0);
    expect(color9Index).toBeGreaterThanOrEqual(0);
    expect(gray9Index).toBeLessThan(color9Index);
  });

  it("should have 144 entries total (120 palette + 24 semantic)", () => {
    const colors = getAllTamaguiColors();
    expect(colors).toHaveLength(144);
  });
});

describe("getTamaguiTokenFromHex", () => {
  it("should return palette token for a palette-only hex", () => {
    // #0090ff is blue9 in palette, not in semantic tokens
    expect(getTamaguiTokenFromHex("#0090ff")).toBe("blue9");
  });

  it("should prefer palette token over semantic for shared hex (e.g. gray9 over color9)", () => {
    // #8d8d8d is both gray9 (palette) and color9/background9 (semantic) — palette must win
    expect(getTamaguiTokenFromHex("#8d8d8d")).toBe("gray9");
  });

  it("should fall back to semantic token when hex is only in semantic tokens", () => {
    // Mutate TAMAGUI_SEMANTIC_TOKENS temporarily to simulate a custom theme hex
    // that exists only in semantic, not in palette.
    const uniqueHex = "#abcdef"; // not present in any palette or semantic by default
    const original = TAMAGUI_SEMANTIC_TOKENS.color[1];
    TAMAGUI_SEMANTIC_TOKENS.color[1] = uniqueHex;
    try {
      const result = getTamaguiTokenFromHex(uniqueHex);
      expect(result).toBe("color1");
    } finally {
      TAMAGUI_SEMANTIC_TOKENS.color[1] = original;
    }
  });

  it("should return null for an unknown hex", () => {
    expect(getTamaguiTokenFromHex("#123456")).toBeNull();
  });

  it("should return null for empty string", () => {
    expect(getTamaguiTokenFromHex("")).toBeNull();
  });

  it("should be case-insensitive", () => {
    expect(getTamaguiTokenFromHex("#0090FF")).toBe("blue9");
    expect(getTamaguiTokenFromHex("#0090ff")).toBe("blue9");
  });
});

describe("findNearestTamaguiTokens", () => {
  it("should prefer palette token over semantic for shared hex", () => {
    // #8d8d8d is both gray9 and color9 and background9
    const nearest = findNearestTamaguiTokens("#8d8d8d", 1);
    expect(nearest[0].token).toBe("gray9");
    expect(nearest[0].distance).toBe(0);
  });

  it("should include semantic tokens in nearest results", () => {
    // #8d8d8d matches gray9, color9, background9 — all distance 0
    const nearest = findNearestTamaguiTokens("#8d8d8d", 5);
    const tokens = nearest.map((n) => n.token);
    expect(tokens).toContain("color9");
    expect(tokens).toContain("background9");
  });
});

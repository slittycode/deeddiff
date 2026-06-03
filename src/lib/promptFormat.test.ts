import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { buildUserMessage, SYSTEM_PROMPT, PROMPT_VERSION } from "./ollama";
import type { ClausePair } from "./types";

// Golden test: the exact prompt strings are pinned so any change is a deliberate,
// reviewed edit (and bumps PROMPT_VERSION to invalidate cached notes).
describe("prompt format (golden)", () => {
  it("system prompt is the reviewed contract", () => {
    expect(SYSTEM_PROMPT).toMatchInlineSnapshot(`
      "You are a contracts analyst. You are given the BEFORE and AFTER text of a SINGLE clause from two versions of the same agreement.

      Rules:
      - Base your answer ONLY on the supplied text. Do not invent facts, parties, or numbers.
      - "summary" must be ONE short plain-English line describing what changed (e.g. "Indemnity cap removed", "Settlement moved from 10 to 5 working days"). Always surface numeric deltas explicitly.
      - "whyItMatters" is one short line on the practical/legal consequence.
      - If the change is only wording or formatting with no legal effect, set materiality to "none".
      - Respond ONLY with JSON matching the provided schema. No preamble, no markdown."
    `);
  });

  it("user message lays out BEFORE/AFTER for a fixed clause", () => {
    const pair: ClausePair = {
      id: "c1",
      kind: "modified",
      before: "settled within 10 working days",
      after: "settled within 5 working days",
    };
    expect(buildUserMessage(pair)).toMatchInlineSnapshot(`
      "Example
      BEFORE: The Provider shall indemnify the Client up to a cap of $1,000,000.
      AFTER: The Provider shall indemnify the Client.
      {"summary":"Indemnity cap removed","whyItMatters":"Provider's liability is now uncapped, increasing risk exposure.","category":"liability","materiality":"high","direction":"modified"}

      Now analyze this clause (kind: modified).
      BEFORE:
      settled within 10 working days
      AFTER:
      settled within 5 working days"
    `);
  });

  it("prompt version is set", () => {
    expect(PROMPT_VERSION).toBeTruthy();
  });
});

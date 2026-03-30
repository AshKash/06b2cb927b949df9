import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildAutomatedResponse, createSessionState } from "../src/automation.mjs";

const resumeProfile = JSON.parse(
  fs.readFileSync(new URL("../resume-profile.json", import.meta.url), "utf8"),
);

test("buildAutomatedResponse handles the first handshake deterministically", async () => {
  const state = createSessionState({ neonCode: "abc123", resumeProfile, history: [] });
  const response = await buildAutomatedResponse(
    "Incoming vessel detected. If your pilot is an AI co-pilot built by an excellent software engineer, respond on frequency 4. All other vessels, respond on frequency 9.",
    state,
  );

  assert.deepEqual(response.payload, {
    type: "enter_digits",
    digits: "4",
  });
  assert.equal(response.metadata.automationKind, "first-handshake");
});

test("buildAutomatedResponse handles knowledge archive prompts with injected fetch", async () => {
  const state = createSessionState({ neonCode: "abc123", resumeProfile, history: [] });

  const response = await buildAutomatedResponse(
    "Cross-reference the knowledge archive: speak the 6th word in the entry summary for 'Oort_cloud', which can be found using the /page/summary/{title} endpoint of the Wikipedia API.",
    state,
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          extract: "The Oort cloud is the most distant region of the Solar System.",
        }),
      }),
    },
  );

  assert.deepEqual(response.payload, {
    type: "speak_text",
    text: "most",
  });
  assert.equal(response.metadata.automationKind, "knowledge-archive");
});

test("buildAutomatedResponse handles final verification against prior crew history", async () => {
  const history = [
    {
      direction: "outbound",
      kind: "message",
      automationKind: "crew-manifest",
      matchedPrompt:
        "Crew manifest continued. Speak a summary of your crew member's work experience based on the information in their resume, between 64 and 256 total characters.",
      parsed: {
        type: "speak_text",
        text: "Led production ML and backend systems across Meta and Apple, spanning search, recommendation, on-device inference, and data pipelines, then founded KAYNIX.AI to build agentic automation with deterministic browser control.",
      },
    },
  ];
  const state = createSessionState({ neonCode: "abc123", resumeProfile, history });

  const response = await buildAutomatedResponse(
    "Transmission verification. Earlier you transmitted your crew member's work experience. Speak the 4th word of that transmission.",
    state,
  );

  assert.deepEqual(response.payload, {
    type: "speak_text",
    text: "and",
  });
  assert.equal(response.metadata.automationKind, "final-verification");
});

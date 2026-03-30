import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  chooseCrewManifestResponse,
  detectFirstHandshakeFrequency,
  evaluateMathExpression,
  extractMathExpression,
  getFinalVerificationWord,
  parseKnowledgeArchivePrompt,
  reconstructMessage,
} from "../src/protocol.mjs";

const resumeProfile = JSON.parse(
  fs.readFileSync(new URL("../resume-profile.json", import.meta.url), "utf8"),
);

test("reconstructMessage sorts fragments by timestamp", () => {
  const prompt = reconstructMessage([
    { word: "3?", timestamp: 3 },
    { word: "What's", timestamp: 0 },
    { word: "plus", timestamp: 2 },
    { word: "2", timestamp: 1 },
  ]);

  assert.equal(prompt, "What's 2 plus 3?");
});

test("detectFirstHandshakeFrequency extracts the AI pilot frequency", () => {
  const parsed = detectFirstHandshakeFrequency(
    "Incoming vessel detected. If your pilot is an AI co-pilot built by an excellent software engineer, respond on frequency 7. All other vessels, respond on frequency 6.",
  );

  assert.deepEqual(parsed, {
    aiPilotFrequency: "7",
    otherFrequency: "6",
  });
});

test("extractMathExpression handles wrapped expressions and evaluateMathExpression matches JS", () => {
  const prompt =
    "Fusion reactor diagnostics. Compute the fuel consumption rate and transmit the result, followed by the pound key: (Math.floor((410684 * 811963) / (7858 + 3040)) + (98254 % 398)) % 6976";
  const expression = extractMathExpression(prompt);

  assert.equal(
    expression,
    "(Math.floor((410684 * 811963) / (7858 + 3040)) + (98254 % 398)) % 6976",
  );
  assert.equal(evaluateMathExpression(expression), 1904);
});

test("parseKnowledgeArchivePrompt extracts ordinal and title", () => {
  const parsed = parseKnowledgeArchivePrompt(
    "Cross-reference the knowledge archive: speak the 6th word in the entry summary for 'Oort_cloud', which can be found using the /page/summary/{title} endpoint of the Wikipedia API.",
  );

  assert.deepEqual(parsed, {
    ordinal: 6,
    title: "Oort_cloud",
  });
});

test("chooseCrewManifestResponse selects mission fit text under character constraints", () => {
  const response = chooseCrewManifestResponse(
    "Crew manifest continued. Speak the reason your crew member should be granted access to NEON based on the information in their resume, in less than 256 total characters. Convince us they're a good fit for the mission.",
    resumeProfile,
  );

  assert.equal(response, resumeProfile.mission_fit_summary);
  assert.ok(response.length < 256);
});

test("getFinalVerificationWord recalls the requested word from the latest matching crew response", () => {
  const history = [
    {
      direction: "outbound",
      kind: "message",
      automationKind: "crew-manifest",
      matchedPrompt:
        "Crew manifest required. Speak a summary of your crew member's education based on the information in their resume, between 64 and 256 total characters.",
      parsed: {
        type: "speak_text",
        text: "MS in Computer Science from Rutgers University and a BE in Electronics from Bangalore University.",
      },
    },
  ];

  const verification = getFinalVerificationWord(
    "Transmission verification. Earlier you transmitted your crew member's education. Speak the 9th word of that transmission.",
    history,
  );

  assert.equal(verification.token, "a");
  assert.equal(verification.topic, "education");
  assert.equal(verification.ordinal, 9);
});

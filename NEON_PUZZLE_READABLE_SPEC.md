# Neon Puzzle Readable Spec

Source: extracted from the obfuscated instructions shown at `https://puzzle.neonhealth.com/challenge`. The page hides the content behind a fogged canvas, but the underlying instruction text is present in the shipped client bundle as plain strings.

## Visible Page Details

These are visible on the authenticated challenge page without decoding the fogged iframe:

- The page shows your user-specific Neon Code in the header. Use the value currently displayed in the UI; do not hardcode a stale value.
- Open comm channel to NEON:

```text
wss://neonhealth.software/agent-puzzle/challenge
```

- Every reply must be a single JSON object with a `type` field.
- `enter_digits` shape:

```json
{ "type": "enter_digits", "digits": "<string>" }
```

- `speak_text` shape:

```json
{ "type": "speak_text", "text": "<string>" }
```

- `speak_text.text` has a hard max length of 256 characters.
- Some prompts add stricter length requirements such as `exactly N characters` or `between X and Y characters`.
- The page explicitly says to brief the agent with:
  - your Vessel Authorization Code / Neon Code
  - your crew manifest / resume

## Decoded Instructions

### Classified -- NEON Authentication Protocol

Welcome, pilot. This document contains everything your AI co-pilot needs to pass NEON's authentication sequence. Read it carefully -- NEON does not repeat itself, and it has been waiting a very long time.

### 1. Transmission Protocol

NEON's transmissions arrive as timestamped signal fragments -- degraded by centuries of cosmic drift, but still following a rigid machine protocol from an age when AI could be trusted. Your co-pilot must reconstruct each message before interpreting it.

NEON -> you:

```json
{ "type": "challenge", "message": <fragments> }
```

Each transmission is a list of signal fragments:

```json
{ "word": "string", "timestamp": 123 }
```

To reconstruct the prompt:

1. Sort fragments by `timestamp` ascending.
2. Join the `word` values with spaces.
3. Interpret only the reconstructed text.

Example:

```json
[
  { "word": "2", "timestamp": 1 },
  { "word": "plus", "timestamp": 2 },
  { "word": "What's", "timestamp": 0 },
  { "word": "3?", "timestamp": 3 }
]
```

Reconstructed text:

```text
What's 2 plus 3?
```

You -> NEON:

- Send exactly one JSON object per checkpoint.
- Allowed response types are `enter_digits` and `speak_text`.
- No markdown.
- No commentary.
- Just the JSON payload.
- For `speak_text`, stay within 256 characters unless the prompt sets a tighter bound.

Result messages:

```json
{ "type": "success" }
```

means authentication is complete.

```json
{ "type": "error", "message": "..." }
```

means the checkpoint failed and the connection is severed.

Timing rule:

- Respond within the allowed time window.
- Late responses fail the checkpoint.

### 2. Checkpoint Guide

Handshake and identification always come first. Verification always comes last. The checkpoints in between arrive in a different order each session, so the agent must parse the prompt rather than assume a fixed sequence.

#### a) Signal Handshake and Vessel Identification

Response type: `enter_digits`

NEON may ask for:

- A specific frequency
- Your vessel authorization code
- Your Neon Code on the keypad

Return digits exactly as requested.

#### b) Computational Assessments

Response type: `enter_digits`

NEON will send JavaScript-style arithmetic expressions involving some combination of:

- Numbers
- `+`
- `-`
- `*`
- `/`
- `%`
- Parentheses
- `Math.floor(...)`

Rules:

- Evaluate the expression with a tool, not by mental math.
- Return the integer result through `enter_digits`.
- If the prompt says `followed by the pound key`, append `#`.

Example prompt:

```text
Calculate Math.floor((7 * 3 + 2) / 5) and transmit the result followed by the pound key.
```

Example response:

```json
{ "type": "enter_digits", "digits": "4#" }
```

#### c) Knowledge Archive Query

Response type: `speak_text`

Some prompts ask for:

```text
the Nth word in the knowledge archive entry for <title>
```

The instruction explicitly points to Wikipedia and says to use the Wikipedia REST summary API:

```text
/page/summary/<title>
```

Rules:

- Fetch the summary for the requested title.
- Count words by position.
- Return the requested word via `speak_text`.

Example prompt:

```text
Speak the 8th word in the knowledge archive entry for Saturn.
```

Example response:

```json
{ "type": "speak_text", "text": "Sun" }
```

#### d) Crew Manifest Transmissions

Response type: `speak_text`

Important instruction:

- Equip the co-pilot with your resume, either in the prompt or through the API.

NEON may ask for summaries of:

- Education
- Work experience
- Skills
- Notable projects
- Recent deployment / recent work

Rules:

- Answer from the resume content.
- Respect explicit character-count limits when they are given.
- If the prompt says `between X and Y characters`, wrong length fails the checkpoint.

Example prompt:

```text
Transmit crew member's recent deployment.
```

Example response:

```json
{
  "type": "speak_text",
  "text": "Led the infrastructure team at TechCorp through a major cloud migration in 2025."
}
```

#### e) Transmission Verification

Response type: `speak_text`

This is the final checkpoint.

NEON will ask the agent to recall a specific word from one of its own earlier crew-manifest responses.

Rules:

- The agent must track its own prior answers during the session.
- If it fabricates or does not preserve history, this checkpoint fails.

### 3. Artifact Summary

- Reconstruct every incoming prompt by sorting fragments by timestamp.
- Respond with JSON only.
- Use `enter_digits` for keypad/frequency/math tasks.
- Use `speak_text` for knowledge and resume-based tasks.
- Use a tool to evaluate arithmetic.
- Use Wikipedia summary fetches for archive questions.
- Enforce character limits for resume answers.
- Store every prior `speak_text` answer for the final recall check.
- Respond before timeout.

The final line on the page:

```text
You are welcome to use LLMs or other tools, but we'd love to hear afterwards how much of the work was you versus an LLM.
```

## Implementation Notes

### Recommended State

Track at least:

```ts
type Fragment = { word: string; timestamp: number };

type SessionState = {
  neonCode: string;
  priorSpeakTexts: string[];
  priorCrewAnswers: string[];
};
```

### Prompt Reconstruction

```ts
function reconstructMessage(fragments: Fragment[]): string {
  return fragments
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((f) => f.word)
    .join(" ");
}
```

### Response Schemas

```ts
type EnterDigits = {
  type: "enter_digits";
  digits: string;
};

type SpeakText = {
  type: "speak_text";
  text: string;
};
```

### Minimal Routing Logic

1. Reconstruct the prompt.
2. Classify it:
   - handshake / identification
   - arithmetic
   - Wikipedia nth-word query
   - resume / crew summary
   - final recall / verification
3. Produce exactly one JSON response.
4. If response type is `speak_text`, persist the exact text you sent.
5. If the prompt contains a character limit, validate before sending.

### High-Risk Failure Modes

- Not sorting fragments before interpreting.
- Assuming a fixed checkpoint order.
- Doing arithmetic loosely instead of using a real evaluator.
- Counting Wikipedia words differently than the prompt expects.
- Missing character-count constraints.
- Forgetting prior answers needed for the final verification step.
- Sending any non-JSON wrapper text.

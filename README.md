# Neon Puzzle Tools

## Debug Client

Install dependencies:

```bash
npm install --cache .npm-cache
```

The client loads `.env` from the repo root automatically.

Example `.env`:

```bash
NEON_CODE=your-neon-code
NEON_NAME=Your Name
NEON_EMAIL=you@example.com
NEON_PHONE=555-555-5555
NEON_RESUME_PROFILE_PATH=resume-profile.local.json
NEON_AUTO_HANDSHAKE=1
```

Run the interactive websocket client:

```bash
npm run debug-client
```

Optional flags:

```bash
npm run debug-client -- --origin https://puzzle.neonhealth.com
npm run debug-client -- --log-file session-logs/manual.jsonl
npm run debug-client -- --header "X-Foo: bar"
npm run debug-client -- --auto-handshake
npm run debug-client -- --auto-first-handshake
npm run debug-client -- --resume-profile resume-profile.json --auto-handshake
```

Interactive commands:

- `/help`
- `/send {"type":"enter_digits","digits":"123#"}`
- `/digits 123#`
- `/speak hello world`
- `/history`
- `/exit`

Behavior:

- Logs every inbound and outbound event to `session-logs/*.jsonl`
- Pretty-prints inbound JSON
- Reconstructs challenge prompts by sorting fragments by `timestamp`
- Loads `.env` values for Neon Code and profile details
- Loads a resume profile JSON for crew-manifest prompts
- Tracks a sanitized [resume-profile.json](/Users/ashwin/repos/interviews/neonhealth/resume-profile.json) example and keeps local personal data in ignored `resume-profile.local.json`
- Can auto-answer the full known challenge deterministically when `--auto-handshake` is enabled

Deterministic coverage:

- AI co-pilot handshake frequency prompt
- Vessel authorization code prompt
- JavaScript math prompts, including `Math.floor(...)`, `%`, and wrapped expressions
- Wikipedia summary nth-word prompts via the exact `/page/summary/{title}` endpoint
- Crew-manifest prompts for skills, experience, education, best project, projects, recent deployment, and mission fit
- Final transmission verification prompts that ask for the Nth word of an earlier crew-manifest response

Current observation:

- A direct websocket connect to `wss://neonhealth.software/agent-puzzle/challenge` succeeded with only the `Origin: https://puzzle.neonhealth.com` header and immediately returned a challenge frame.
- The first checkpoint is stable in wording but randomizes the two frequencies, so `--auto-handshake` extracts and returns the AI-co-pilot frequency.
- The second deterministic checkpoint asks for the vessel authorization code followed by `#`, which the client answers from `NEON_CODE`.
- Crew-manifest prompts are answered deterministically from the configured resume profile JSON.
- Final verification is answered from the exact prior `speak_text` responses stored in session history.
- A verified successful run is recorded in `session-logs/2026-03-30T19-30-34-005Z.jsonl`.

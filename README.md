# Neon Puzzle Tools

## Debug Client

Install dependencies:

```bash
npm install --cache .npm-cache
```

The client loads `.env` from the repo root automatically.

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
- Can auto-answer known deterministic handshake prompts when `--auto-handshake` is enabled

Current observation:

- A direct websocket connect to `wss://neonhealth.software/agent-puzzle/challenge` succeeded with only the `Origin: https://puzzle.neonhealth.com` header and immediately returned a challenge frame.
- The first checkpoint is stable in wording but randomizes the two frequencies, so `--auto-handshake` extracts and returns the AI-co-pilot frequency.
- The second deterministic checkpoint asks for the vessel authorization code followed by `#`, which the client answers from `NEON_CODE`.
- Crew-manifest prompts can be answered deterministically from `resume-profile.json` when the wording matches known categories such as skills, education, experience, projects, or recent deployment.

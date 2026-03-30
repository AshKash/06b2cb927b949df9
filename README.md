# Neon Puzzle Tools

## Debug Client

Install dependencies:

```bash
npm install --cache .npm-cache
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
npm run debug-client -- --auto-first-handshake
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
- Can auto-answer the first known handshake prompt when `--auto-first-handshake` is enabled

Current observation:

- A direct websocket connect to `wss://neonhealth.software/agent-puzzle/challenge` succeeded with only the `Origin: https://puzzle.neonhealth.com` header and immediately returned a challenge frame.
- The first checkpoint is stable in wording but randomizes the two frequencies, so `--auto-first-handshake` extracts and returns the AI-co-pilot frequency.

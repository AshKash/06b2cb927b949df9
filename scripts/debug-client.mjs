import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import process from "node:process";
import WebSocket from "ws";

const DEFAULT_URL = "wss://neonhealth.software/agent-puzzle/challenge";
const DEFAULT_ORIGIN = "https://puzzle.neonhealth.com";

function parseArgs(argv) {
  const options = {
    url: process.env.NEON_WS_URL || DEFAULT_URL,
    origin: process.env.NEON_WS_ORIGIN || DEFAULT_ORIGIN,
    cookie: process.env.NEON_WS_COOKIE || "",
    logFile: process.env.NEON_WS_LOG_FILE || "",
    headers: {},
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--url" && next) {
      options.url = next;
      index += 1;
      continue;
    }

    if (arg === "--origin" && next) {
      options.origin = next;
      index += 1;
      continue;
    }

    if (arg === "--cookie" && next) {
      options.cookie = next;
      index += 1;
      continue;
    }

    if (arg === "--cookie-file" && next) {
      options.cookie = fs.readFileSync(next, "utf8").trim();
      index += 1;
      continue;
    }

    if (arg === "--log-file" && next) {
      options.logFile = next;
      index += 1;
      continue;
    }

    if (arg === "--header" && next) {
      const separator = next.indexOf(":");
      if (separator === -1) {
        throw new Error(`Invalid header format: ${next}`);
      }

      const name = next.slice(0, separator).trim();
      const value = next.slice(separator + 1).trim();
      options.headers[name] = value;
      index += 1;
      continue;
    }

    if (arg === "--help") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printUsage() {
  console.log(`Usage:
  npm run debug-client -- [options]

Options:
  --url <wss-url>           Override websocket URL
  --origin <origin>         Set Origin header
  --cookie <cookie-string>  Set Cookie header directly
  --cookie-file <path>      Read Cookie header value from a file
  --header "K: V"           Add any extra header, repeatable
  --log-file <path>         Write JSONL session log to a file
  --help                    Show this help

Environment variables:
  NEON_WS_URL
  NEON_WS_ORIGIN
  NEON_WS_COOKIE
  NEON_WS_LOG_FILE

Interactive commands:
  /help
  /send {"type":"enter_digits","digits":"123#"}
  /digits 123#
  /speak some text
  /history
  /exit

If a line starts with "{", it is sent as raw JSON.
`);
}

function nowIso() {
  return new Date().toISOString();
}

function ensureLogFile(logFile) {
  if (!logFile) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return path.join(process.cwd(), "session-logs", `${stamp}.jsonl`);
  }

  return path.resolve(logFile);
}

function createLogger(logFile) {
  const target = ensureLogFile(logFile);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  return {
    target,
    write(event) {
      fs.appendFileSync(target, `${JSON.stringify(event)}\n`, "utf8");
    },
  };
}

function reconstructMessage(fragments) {
  if (!Array.isArray(fragments)) {
    return null;
  }

  return fragments
    .slice()
    .sort((left, right) => left.timestamp - right.timestamp)
    .map((fragment) => fragment.word)
    .join(" ");
}

function stringifyJson(value) {
  return JSON.stringify(value, null, 2);
}

function buildHeaders(options) {
  const headers = {
    Origin: options.origin,
    ...options.headers,
  };

  if (options.cookie) {
    headers.Cookie = options.cookie;
  }

  return headers;
}

function printBanner(options, logPath) {
  console.log("NEON debug client");
  console.log(`URL: ${options.url}`);
  console.log(`Origin: ${options.origin}`);
  console.log(`Cookie header: ${options.cookie ? "set" : "not set"}`);
  console.log(`Session log: ${logPath}`);
  console.log('Type "/help" for commands.');
}

function safeParseJson(raw) {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error };
  }
}

function printInbound(parsed, raw) {
  console.log("\n< inbound");

  if (!parsed.ok) {
    console.log(raw);
    return;
  }

  console.log(stringifyJson(parsed.value));

  if (parsed.value?.type === "challenge" && Array.isArray(parsed.value.message)) {
    const reconstructed = reconstructMessage(parsed.value.message);
    console.log("\n< reconstructed prompt");
    console.log(reconstructed);
  }
}

function normalizeOutgoing(command, history) {
  if (!command) {
    return null;
  }

  if (command === "/help") {
    printUsage();
    return null;
  }

  if (command === "/history") {
    const tail = history.slice(-10);
    console.log(`Showing ${tail.length} recent events`);
    for (const event of tail) {
      console.log(`${event.timestamp} ${event.direction} ${event.kind}`);
    }
    return null;
  }

  if (command === "/exit") {
    return { localOnly: true, exit: true };
  }

  if (command.startsWith("/send ")) {
    return { payload: command.slice(6).trim() };
  }

  if (command.startsWith("/digits ")) {
    const digits = command.slice(8).trim();
    return {
      payload: JSON.stringify({ type: "enter_digits", digits }),
    };
  }

  if (command.startsWith("/speak ")) {
    const text = command.slice(7);
    return {
      payload: JSON.stringify({ type: "speak_text", text }),
    };
  }

  if (command.startsWith("{")) {
    return { payload: command };
  }

  console.log('Unknown command. Use "/help" for usage.');
  return null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const logger = createLogger(options.logFile);
  const history = [];

  printBanner(options, logger.target);

  const socket = new WebSocket(options.url, {
    headers: buildHeaders(options),
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "neon> ",
  });

  const pushHistory = (event) => {
    history.push(event);
    logger.write(event);
  };

  socket.on("open", () => {
    const event = {
      timestamp: nowIso(),
      direction: "local",
      kind: "open",
      url: options.url,
    };
    pushHistory(event);
    console.log("\nConnection opened.");
    rl.prompt();
  });

  socket.on("message", (data, isBinary) => {
    const raw = isBinary ? data.toString("base64") : data.toString("utf8");
    const parsed = isBinary ? { ok: false } : safeParseJson(raw);
    const reconstructed =
      parsed.ok &&
      parsed.value?.type === "challenge" &&
      Array.isArray(parsed.value.message)
        ? reconstructMessage(parsed.value.message)
        : null;

    pushHistory({
      timestamp: nowIso(),
      direction: "inbound",
      kind: isBinary ? "binary" : "message",
      raw,
      parsed: parsed.ok ? parsed.value : null,
      reconstructed,
    });

    printInbound(parsed, raw);
    rl.prompt();
  });

  socket.on("close", (code, reasonBuffer) => {
    const reason = reasonBuffer.toString("utf8");
    pushHistory({
      timestamp: nowIso(),
      direction: "local",
      kind: "close",
      code,
      reason,
    });
    console.log(`\nConnection closed. code=${code} reason=${reason || "<empty>"}`);
    rl.close();
  });

  socket.on("error", (error) => {
    pushHistory({
      timestamp: nowIso(),
      direction: "local",
      kind: "error",
      error: error.message,
    });
    console.error(`\nSocket error: ${error.message}`);
    rl.prompt();
  });

  rl.on("line", (line) => {
    const command = line.trim();
    const normalized = normalizeOutgoing(command, history);

    if (!normalized) {
      rl.prompt();
      return;
    }

    if (normalized.exit) {
      socket.close();
      return;
    }

    const parsed = safeParseJson(normalized.payload);
    if (!parsed.ok) {
      console.error(`Invalid JSON: ${parsed.error.message}`);
      rl.prompt();
      return;
    }

    if (socket.readyState !== WebSocket.OPEN) {
      console.error("Socket is not open.");
      rl.prompt();
      return;
    }

    socket.send(normalized.payload);

    pushHistory({
      timestamp: nowIso(),
      direction: "outbound",
      kind: "message",
      raw: normalized.payload,
      parsed: parsed.value,
    });

    console.log("\n> outbound");
    console.log(stringifyJson(parsed.value));
    rl.prompt();
  });

  rl.on("SIGINT", () => {
    socket.close();
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

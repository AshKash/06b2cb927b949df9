import readline from "node:readline";
import process from "node:process";
import WebSocket from "ws";
import { buildAutomatedResponse, createSessionState } from "./automation.mjs";
import { buildHeaders, loadEnvFile, loadResumeProfile, parseArgs } from "./env.mjs";
import { createLogger, nowIso } from "./logger.mjs";
import { reconstructMessage, safeParseJson, stringifyJson } from "./protocol.mjs";

export function printUsage() {
  console.log(`Usage:
  npm run debug-client -- [options]

Options:
  --url <wss-url>           Override websocket URL
  --origin <origin>         Set Origin header
  --cookie <cookie-string>  Set Cookie header directly
  --cookie-file <path>      Read Cookie header value from a file
  --header "K: V"           Add any extra header, repeatable
  --log-file <path>         Write JSONL session log to a file
  --neon-code <code>        Neon Code used for vessel authorization prompts
  --name <full-name>        Profile name override
  --email <email>           Profile email override
  --phone <phone>           Profile phone override
  --resume-profile <path>   Resume profile JSON for crew-manifest prompts
  --auto-handshake          Auto-answer known deterministic handshake prompts
  --help                    Show this help

Environment variables:
  NEON_WS_URL
  NEON_WS_ORIGIN
  NEON_WS_COOKIE
  NEON_WS_LOG_FILE
  NEON_CODE
  NEON_NAME
  NEON_EMAIL
  NEON_PHONE
  NEON_RESUME_PROFILE_PATH
  NEON_AUTO_HANDSHAKE=1

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

function printBanner(options, logPath) {
  console.log("NEON debug client");
  console.log(`URL: ${options.url}`);
  console.log(`Origin: ${options.origin}`);
  console.log(`Cookie header: ${options.cookie ? "set" : "not set"}`);
  console.log(`Neon code: ${options.neonCode ? "set" : "not set"}`);
  console.log(`Profile name: ${options.profile.name ? "set" : "not set"}`);
  console.log(`Profile email: ${options.profile.email ? "set" : "not set"}`);
  console.log(`Profile phone: ${options.profile.phone ? "set" : "not set"}`);
  console.log(`Resume profile: ${options.resumeProfilePath ? options.resumeProfilePath : "not set"}`);
  console.log(`Auto handshake: ${options.autoHandshake ? "on" : "off"}`);
  console.log(`Session log: ${logPath}`);
  console.log('Type "/help" for commands.');
}

function printInbound(parsed, raw) {
  console.log("\n< inbound");

  if (!parsed.ok) {
    console.log(raw);
    return;
  }

  console.log(stringifyJson(parsed.value));

  if (parsed.value?.type === "challenge" && Array.isArray(parsed.value.message)) {
    console.log("\n< reconstructed prompt");
    console.log(reconstructMessage(parsed.value.message));
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
    return { exit: true };
  }

  if (command.startsWith("/send ")) {
    return { payload: command.slice(6).trim() };
  }

  if (command.startsWith("/digits ")) {
    return {
      payload: JSON.stringify({
        type: "enter_digits",
        digits: command.slice(8).trim(),
      }),
    };
  }

  if (command.startsWith("/speak ")) {
    return {
      payload: JSON.stringify({
        type: "speak_text",
        text: command.slice(7),
      }),
    };
  }

  if (command.startsWith("{")) {
    return { payload: command };
  }

  console.log('Unknown command. Use "/help" for usage.');
  return null;
}

function inferAutomationKind(error) {
  const message = error.message || "";

  if (message.includes("Wikipedia")) {
    return "knowledge-archive";
  }

  if (message.includes("Crew response")) {
    return "crew-manifest";
  }

  if (message.includes("final verification")) {
    return "final-verification";
  }

  return "automation";
}

export async function main(argv = process.argv.slice(2)) {
  loadEnvFile();
  const options = parseArgs(argv);
  if (options.help) {
    printUsage();
    return;
  }

  const logger = createLogger(options.logFile);
  const history = [];
  const state = createSessionState({
    neonCode: options.neonCode,
    resumeProfile: loadResumeProfile(options.resumeProfilePath),
    history,
  });

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

  const sendPayload = (payload, metadata = {}) => {
    const parsed = safeParseJson(payload);
    if (!parsed.ok) {
      console.error(`Invalid JSON: ${parsed.error.message}`);
      return false;
    }

    if (socket.readyState !== WebSocket.OPEN) {
      console.error("Socket is not open.");
      return false;
    }

    socket.send(payload);

    pushHistory({
      timestamp: nowIso(),
      direction: "outbound",
      kind: "message",
      raw: payload,
      parsed: parsed.value,
      ...metadata,
    });

    console.log("\n> outbound");
    console.log(stringifyJson(parsed.value));
    return true;
  };

  socket.on("open", () => {
    pushHistory({
      timestamp: nowIso(),
      direction: "local",
      kind: "open",
      url: options.url,
    });
    console.log("\nConnection opened.");
    rl.prompt();
  });

  socket.on("message", async (data, isBinary) => {
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

    if (options.autoHandshake && reconstructed) {
      try {
        const response = await buildAutomatedResponse(reconstructed, state);
        if (response) {
          sendPayload(JSON.stringify(response.payload), response.metadata);
        }
      } catch (error) {
        pushHistory({
          timestamp: nowIso(),
          direction: "local",
          kind: "automation_error",
          automationKind: inferAutomationKind(error),
          matchedPrompt: reconstructed,
          error: error.message,
        });
        console.error(`\nAutomation failed: ${error.message}`);
      }
    }

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
    const normalized = normalizeOutgoing(line.trim(), history);
    if (!normalized) {
      rl.prompt();
      return;
    }

    if (normalized.exit) {
      socket.close();
      return;
    }

    sendPayload(normalized.payload);
    rl.prompt();
  });

  rl.on("SIGINT", () => {
    socket.close();
  });
}

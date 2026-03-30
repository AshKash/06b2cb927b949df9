import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import process from "node:process";
import vm from "node:vm";
import WebSocket from "ws";

const DEFAULT_URL = "wss://neonhealth.software/agent-puzzle/challenge";
const DEFAULT_ORIGIN = "https://puzzle.neonhealth.com";

loadEnvFile();

function loadEnvFile(envPath = path.join(process.cwd(), ".env")) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv) {
  const options = {
    url: process.env.NEON_WS_URL || DEFAULT_URL,
    origin: process.env.NEON_WS_ORIGIN || DEFAULT_ORIGIN,
    cookie: process.env.NEON_WS_COOKIE || "",
    logFile: process.env.NEON_WS_LOG_FILE || "",
    neonCode: process.env.NEON_CODE || "",
    profile: {
      name: process.env.NEON_NAME || "",
      email: process.env.NEON_EMAIL || "",
      phone: process.env.NEON_PHONE || "",
    },
    resumeProfilePath: process.env.NEON_RESUME_PROFILE_PATH || "",
    autoHandshake:
      process.env.NEON_AUTO_HANDSHAKE === "1" ||
      process.env.NEON_AUTO_FIRST_HANDSHAKE === "1",
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

    if (arg === "--neon-code" && next) {
      options.neonCode = next;
      index += 1;
      continue;
    }

    if (arg === "--name" && next) {
      options.profile.name = next;
      index += 1;
      continue;
    }

    if (arg === "--email" && next) {
      options.profile.email = next;
      index += 1;
      continue;
    }

    if (arg === "--phone" && next) {
      options.profile.phone = next;
      index += 1;
      continue;
    }

    if (arg === "--resume-profile" && next) {
      options.resumeProfilePath = next;
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

    if (arg === "--auto-handshake" || arg === "--auto-first-handshake") {
      options.autoHandshake = true;
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

function loadResumeProfile(resumeProfilePath) {
  if (!resumeProfilePath) {
    return null;
  }

  const resolved = path.resolve(resumeProfilePath);
  if (!fs.existsSync(resolved)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(resolved, "utf8"));
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
  console.log(`Neon code: ${options.neonCode ? "set" : "not set"}`);
  console.log(`Profile name: ${options.profile.name ? "set" : "not set"}`);
  console.log(`Profile email: ${options.profile.email ? "set" : "not set"}`);
  console.log(`Profile phone: ${options.profile.phone ? "set" : "not set"}`);
  console.log(`Resume profile: ${options.resumeProfilePath ? options.resumeProfilePath : "not set"}`);
  console.log(`Auto handshake: ${options.autoHandshake ? "on" : "off"}`);
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

function detectFirstHandshakeFrequency(prompt) {
  if (typeof prompt !== "string") {
    return null;
  }

  if (
    !prompt.includes("Incoming vessel detected.") ||
    !prompt.includes("If your pilot is an AI co-pilot built by an excellent software engineer") ||
    !prompt.includes("All other vessels, respond on frequency")
  ) {
    return null;
  }

  const match = prompt.match(
    /respond on frequency\s+(\d+)\.\s+All other vessels,\s+respond on frequency\s+(\d+)\.?/i,
  );

  if (!match) {
    return null;
  }

  return {
    aiPilotFrequency: match[1],
    otherFrequency: match[2],
  };
}

function detectVesselAuthorizationPrompt(prompt) {
  if (typeof prompt !== "string") {
    return false;
  }

  return (
    prompt.includes("vessel authorization code") &&
    prompt.includes("followed by the pound key")
  );
}

function extractMathExpression(prompt) {
  if (typeof prompt !== "string" || !prompt.includes("Math.floor")) {
    return null;
  }

  const afterColon = prompt.includes(":")
    ? prompt.slice(prompt.lastIndexOf(":") + 1).trim()
    : prompt.trim();

  if (/^[\d\s()+\-*/%.A-Za-z]+$/u.test(afterColon)) {
    return afterColon;
  }

  const fallback = prompt.match(
    /(\(?Math\.floor\([^]+?\)(?:\s*[%+\-*/]\s*\(?\d+[)\d\s+\-*/%]*)*)/u,
  );
  return fallback ? fallback[1] : null;
}

function evaluateMathExpression(expression) {
  if (!expression) {
    return null;
  }

  const result = vm.runInNewContext(expression, { Math }, { timeout: 50 });
  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new Error(`Expression did not evaluate to a finite number: ${expression}`);
  }

  if (!Number.isInteger(result)) {
    throw new Error(`Expression did not evaluate to an integer: ${expression}`);
  }

  return result;
}

function extractCharacterConstraint(prompt) {
  if (typeof prompt !== "string") {
    return null;
  }

  const between = prompt.match(/between\s+(\d+)\s+and\s+(\d+)\s+total characters/i);
  if (between) {
    return { min: Number(between[1]), max: Number(between[2]) };
  }

  const exactly = prompt.match(/exactly\s+(\d+)\s+characters/i);
  if (exactly) {
    return { min: Number(exactly[1]), max: Number(exactly[1]) };
  }

  return null;
}

function chooseCrewManifestResponse(prompt, resumeProfile) {
  if (typeof prompt !== "string" || !resumeProfile) {
    return null;
  }

  const normalized = prompt.toLowerCase();
  let text = null;

  if (normalized.includes("summary") && normalized.includes("skills")) {
    text = resumeProfile.skills_summary;
  } else if (normalized.includes("recent deployment")) {
    text = resumeProfile.recent_deployment_summary;
  } else if (normalized.includes("education")) {
    text = resumeProfile.education_summary;
  } else if (normalized.includes("work experience") || normalized.includes("experience")) {
    text = resumeProfile.experience_summary;
  } else if (normalized.includes("best project")) {
    text = resumeProfile.best_project_summary || resumeProfile.projects_summary;
  } else if (normalized.includes("project")) {
    text = resumeProfile.projects_summary;
  } else if (normalized.includes("projects")) {
    text = resumeProfile.projects_summary;
  }

  if (!text) {
    return null;
  }

  const constraint = extractCharacterConstraint(prompt);
  if (constraint) {
    const length = text.length;
    if (length < constraint.min || length > constraint.max) {
      throw new Error(
        `Crew response length ${length} is outside ${constraint.min}-${constraint.max}: ${text}`,
      );
    }
  }

  if (text.length > 256) {
    throw new Error(`Crew response exceeds 256 characters: ${text.length}`);
  }

  return text;
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
  const resumeProfile = loadResumeProfile(options.resumeProfilePath);
  const history = [];
  let autoFirstHandshakeSent = false;
  let autoVesselAuthorizationSent = false;
  let autoMathSentCount = 0;
  let autoCrewSentCount = 0;

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

    if (
      options.autoHandshake &&
      !autoFirstHandshakeSent &&
      reconstructed
    ) {
      const firstHandshake = detectFirstHandshakeFrequency(reconstructed);
      if (firstHandshake) {
        autoFirstHandshakeSent = true;
        sendPayload(
          JSON.stringify({
            type: "enter_digits",
            digits: firstHandshake.aiPilotFrequency,
          }),
          {
            automated: true,
            automationKind: "first-handshake",
            matchedPrompt: reconstructed,
          },
        );
      }
    }

    if (
      options.autoHandshake &&
      options.neonCode &&
      !autoVesselAuthorizationSent &&
      reconstructed &&
      detectVesselAuthorizationPrompt(reconstructed)
    ) {
      autoVesselAuthorizationSent = true;
      sendPayload(
        JSON.stringify({
          type: "enter_digits",
          digits: `${options.neonCode}#`,
        }),
        {
          automated: true,
          automationKind: "vessel-authorization",
          matchedPrompt: reconstructed,
        },
      );
    }

    if (options.autoHandshake && reconstructed) {
      const expression = extractMathExpression(reconstructed);
      if (expression) {
        try {
          const result = evaluateMathExpression(expression);
          const digits = reconstructed.includes("pound key")
            ? `${result}#`
            : String(result);
          autoMathSentCount += 1;
          sendPayload(
            JSON.stringify({
              type: "enter_digits",
              digits,
            }),
            {
              automated: true,
              automationKind: "math",
              matchedPrompt: reconstructed,
              expression,
              result,
              sequence: autoMathSentCount,
            },
          );
        } catch (error) {
          pushHistory({
            timestamp: nowIso(),
            direction: "local",
            kind: "automation_error",
            automationKind: "math",
            matchedPrompt: reconstructed,
            expression,
            error: error.message,
          });
          console.error(`\nMath automation failed: ${error.message}`);
        }
      }
    }

    if (options.autoHandshake && reconstructed && resumeProfile) {
      try {
        const crewResponse = chooseCrewManifestResponse(reconstructed, resumeProfile);
        if (crewResponse) {
          autoCrewSentCount += 1;
          sendPayload(
            JSON.stringify({
              type: "speak_text",
              text: crewResponse,
            }),
            {
              automated: true,
              automationKind: "crew-manifest",
              matchedPrompt: reconstructed,
              sequence: autoCrewSentCount,
            },
          );
        }
      } catch (error) {
        pushHistory({
          timestamp: nowIso(),
          direction: "local",
          kind: "automation_error",
          automationKind: "crew-manifest",
          matchedPrompt: reconstructed,
          error: error.message,
        });
        console.error(`\nCrew manifest automation failed: ${error.message}`);
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

    sendPayload(normalized.payload);
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

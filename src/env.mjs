import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export const DEFAULT_URL = "wss://neonhealth.software/agent-puzzle/challenge";
export const DEFAULT_ORIGIN = "https://puzzle.neonhealth.com";

export function loadEnvFile(envPath = path.join(process.cwd(), ".env")) {
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

export function parseArgs(argv) {
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
      return { ...options, help: true };
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export function buildHeaders(options) {
  const headers = {
    Origin: options.origin,
    ...options.headers,
  };

  if (options.cookie) {
    headers.Cookie = options.cookie;
  }

  return headers;
}

export function loadResumeProfile(resumeProfilePath) {
  if (!resumeProfilePath) {
    return null;
  }

  const resolved = path.resolve(resumeProfilePath);
  if (!fs.existsSync(resolved)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

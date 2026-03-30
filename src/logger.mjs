import fs from "node:fs";
import path from "node:path";

export function nowIso() {
  return new Date().toISOString();
}

export function ensureLogFile(logFile) {
  if (!logFile) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return path.join(process.cwd(), "session-logs", `${stamp}.jsonl`);
  }

  return path.resolve(logFile);
}

export function createLogger(logFile) {
  const target = ensureLogFile(logFile);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  return {
    target,
    write(event) {
      fs.appendFileSync(target, `${JSON.stringify(event)}\n`, "utf8");
    },
  };
}

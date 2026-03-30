import vm from "node:vm";

export function reconstructMessage(fragments) {
  if (!Array.isArray(fragments)) {
    return null;
  }

  return fragments
    .slice()
    .sort((left, right) => left.timestamp - right.timestamp)
    .map((fragment) => fragment.word)
    .join(" ");
}

export function safeParseJson(raw) {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error };
  }
}

export function stringifyJson(value) {
  return JSON.stringify(value, null, 2);
}

export function detectFirstHandshakeFrequency(prompt) {
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

export function detectVesselAuthorizationPrompt(prompt) {
  if (typeof prompt !== "string") {
    return false;
  }

  return (
    prompt.includes("vessel authorization code") &&
    prompt.includes("followed by the pound key")
  );
}

export function extractMathExpression(prompt) {
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

export function evaluateMathExpression(expression) {
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

export function extractCharacterConstraint(prompt) {
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

export function classifyCrewManifestTopic(prompt) {
  if (typeof prompt !== "string") {
    return null;
  }

  const normalized = prompt.toLowerCase();

  if (normalized.includes("summary") && normalized.includes("skills")) {
    return "skills";
  }

  if (
    normalized.includes("granted access to neon") ||
    (normalized.includes("good fit") && normalized.includes("mission"))
  ) {
    return "mission-fit";
  }

  if (normalized.includes("recent deployment")) {
    return "recent-deployment";
  }

  if (normalized.includes("education")) {
    return "education";
  }

  if (normalized.includes("work experience") || normalized.includes("experience")) {
    return "experience";
  }

  if (normalized.includes("best project")) {
    return "best-project";
  }

  if (normalized.includes("project") || normalized.includes("projects")) {
    return "projects";
  }

  return null;
}

export function chooseCrewManifestResponse(prompt, resumeProfile) {
  if (typeof prompt !== "string" || !resumeProfile) {
    return null;
  }

  const normalized = prompt.toLowerCase();
  const looksLikeResumePrompt =
    normalized.includes("resume") ||
    normalized.includes("crew manifest") ||
    normalized.includes("manifest continued") ||
    normalized.includes("manifest required");

  if (!looksLikeResumePrompt) {
    return null;
  }

  const topic = classifyCrewManifestTopic(prompt);
  let text = null;

  if (topic === "skills") {
    text = resumeProfile.skills_summary;
  } else if (topic === "mission-fit") {
    text = resumeProfile.mission_fit_summary;
  } else if (topic === "recent-deployment") {
    text = resumeProfile.recent_deployment_summary;
  } else if (topic === "education") {
    text = resumeProfile.education_summary;
  } else if (topic === "experience") {
    text = resumeProfile.experience_summary;
  } else if (topic === "best-project") {
    text = resumeProfile.best_project_summary || resumeProfile.projects_summary;
  } else if (topic === "projects") {
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

export function parseOrdinal(value) {
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) ? numeric : null;
}

export function parseKnowledgeArchivePrompt(prompt) {
  if (typeof prompt !== "string") {
    return null;
  }

  if (
    !prompt.includes("knowledge archive") ||
    !prompt.includes("entry summary") ||
    !prompt.includes("Wikipedia API")
  ) {
    return null;
  }

  const ordinalMatch = prompt.match(/\b(\d+)(?:st|nd|rd|th)\s+word\b/i);
  const titleMatch = prompt.match(/entry summary for ['"]([^'"]+)['"]/i);

  if (!ordinalMatch || !titleMatch) {
    return null;
  }

  const ordinal = parseOrdinal(ordinalMatch[1]);
  const title = titleMatch[1];
  if (!ordinal || !title) {
    return null;
  }

  return { ordinal, title };
}

export function normalizeWikipediaTitle(title) {
  return title.trim().replace(/\s+/g, "_");
}

export function tokenizeText(text) {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^[“"'([{]+|[”"')\]}.,:;!?]+$/g, ""))
    .filter(Boolean);
}

export function parseFinalVerificationPrompt(prompt) {
  if (typeof prompt !== "string") {
    return null;
  }

  const normalized = prompt.toLowerCase();
  if (
    !normalized.includes("word") ||
    (!normalized.includes("earlier") &&
      !normalized.includes("previous") &&
      !normalized.includes("prior") &&
      !normalized.includes("last") &&
      !normalized.includes("recent"))
  ) {
    return null;
  }

  const ordinalMatch = prompt.match(/\b(\d+)(?:st|nd|rd|th)\s+word\b/i);
  if (!ordinalMatch) {
    return null;
  }

  const ordinal = parseOrdinal(ordinalMatch[1]);
  if (!ordinal) {
    return null;
  }

  let recency = "latest";
  if (normalized.includes("first")) {
    recency = "first";
  } else if (
    normalized.includes("last") ||
    normalized.includes("most recent") ||
    normalized.includes("latest")
  ) {
    recency = "latest";
  }

  return {
    ordinal,
    recency,
    topic: classifyCrewManifestTopic(prompt),
  };
}

export function getCrewManifestHistory(history) {
  return history.filter(
    (event) =>
      event.direction === "outbound" &&
      event.kind === "message" &&
      event.parsed?.type === "speak_text" &&
      event.automationKind === "crew-manifest" &&
      typeof event.parsed.text === "string",
  );
}

export function getFinalVerificationWord(prompt, history) {
  const parsed = parseFinalVerificationPrompt(prompt);
  if (!parsed) {
    return null;
  }

  let candidates = getCrewManifestHistory(history);
  if (parsed.topic) {
    candidates = candidates.filter(
      (event) => classifyCrewManifestTopic(event.matchedPrompt) === parsed.topic,
    );
  }

  if (candidates.length === 0) {
    throw new Error(`No prior crew-manifest response available for final verification: ${prompt}`);
  }

  const chosen =
    parsed.recency === "first" ? candidates[0] : candidates[candidates.length - 1];
  const tokens = tokenizeText(chosen.parsed.text);
  const index = parsed.ordinal - 1;

  if (index < 0 || index >= tokens.length) {
    throw new Error(
      `Requested word ${parsed.ordinal} out of range for final verification response with ${tokens.length} tokens`,
    );
  }

  return {
    ordinal: parsed.ordinal,
    recency: parsed.recency,
    topic: parsed.topic,
    token: tokens[index],
    sourceText: chosen.parsed.text,
    tokenCount: tokens.length,
  };
}

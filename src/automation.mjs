import {
  chooseCrewManifestResponse,
  detectFirstHandshakeFrequency,
  detectVesselAuthorizationPrompt,
  evaluateMathExpression,
  extractMathExpression,
  getFinalVerificationWord,
  normalizeWikipediaTitle,
  parseKnowledgeArchivePrompt,
  tokenizeText,
} from "./protocol.mjs";

export function createSessionState({ neonCode = "", resumeProfile = null, history = [] } = {}) {
  return {
    neonCode,
    resumeProfile,
    history,
    wikipediaCache: new Map(),
    sent: {
      firstHandshake: false,
      vesselAuthorization: false,
    },
    sequences: {
      math: 0,
      crew: 0,
      knowledge: 0,
      finalVerification: 0,
    },
  };
}

export async function fetchWikipediaSummary(title, cache, fetchImpl = fetch) {
  const normalizedTitle = normalizeWikipediaTitle(title);
  if (cache.has(normalizedTitle)) {
    return cache.get(normalizedTitle);
  }

  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(normalizedTitle)}`;
  const response = await fetchImpl(url, {
    headers: {
      "user-agent": "neonhealth-puzzle/0.1",
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Wikipedia summary fetch failed for ${normalizedTitle}: ${response.status} ${response.statusText}`,
    );
  }

  const payload = await response.json();
  if (!payload.extract || typeof payload.extract !== "string") {
    throw new Error(`Wikipedia summary missing extract for ${normalizedTitle}`);
  }

  cache.set(normalizedTitle, payload);
  return payload;
}

export async function getKnowledgeArchiveWord(prompt, cache, fetchImpl = fetch) {
  const parsed = parseKnowledgeArchivePrompt(prompt);
  if (!parsed) {
    return null;
  }

  const summary = await fetchWikipediaSummary(parsed.title, cache, fetchImpl);
  const tokens = tokenizeText(summary.extract);
  const index = parsed.ordinal - 1;
  if (index < 0 || index >= tokens.length) {
    throw new Error(
      `Requested word ${parsed.ordinal} out of range for ${parsed.title}; extract only has ${tokens.length} tokens`,
    );
  }

  return {
    title: parsed.title,
    ordinal: parsed.ordinal,
    extract: summary.extract,
    token: tokens[index],
    tokenCount: tokens.length,
  };
}

function buildResponse(payload, metadata) {
  return { payload, metadata };
}

export async function buildAutomatedResponse(prompt, state, options = {}) {
  const { fetchImpl = fetch } = options;

  if (state.sent.firstHandshake === false) {
    const firstHandshake = detectFirstHandshakeFrequency(prompt);
    if (firstHandshake) {
      state.sent.firstHandshake = true;
      return buildResponse(
        {
          type: "enter_digits",
          digits: firstHandshake.aiPilotFrequency,
        },
        {
          automated: true,
          automationKind: "first-handshake",
          matchedPrompt: prompt,
        },
      );
    }
  }

  if (
    state.sent.vesselAuthorization === false &&
    state.neonCode &&
    detectVesselAuthorizationPrompt(prompt)
  ) {
    state.sent.vesselAuthorization = true;
    return buildResponse(
      {
        type: "enter_digits",
        digits: `${state.neonCode}#`,
      },
      {
        automated: true,
        automationKind: "vessel-authorization",
        matchedPrompt: prompt,
      },
    );
  }

  const expression = extractMathExpression(prompt);
  if (expression) {
    const result = evaluateMathExpression(expression);
    const digits = prompt.includes("pound key") ? `${result}#` : String(result);
    state.sequences.math += 1;
    return buildResponse(
      {
        type: "enter_digits",
        digits,
      },
      {
        automated: true,
        automationKind: "math",
        matchedPrompt: prompt,
        expression,
        result,
        sequence: state.sequences.math,
      },
    );
  }

  const verification = getFinalVerificationWord(prompt, state.history);
  if (verification) {
    state.sequences.finalVerification += 1;
    return buildResponse(
      {
        type: "speak_text",
        text: verification.token,
      },
      {
        automated: true,
        automationKind: "final-verification",
        matchedPrompt: prompt,
        ordinal: verification.ordinal,
        recency: verification.recency,
        topic: verification.topic,
        token: verification.token,
        tokenCount: verification.tokenCount,
        sourceText: verification.sourceText,
        sequence: state.sequences.finalVerification,
      },
    );
  }

  const crewResponse = chooseCrewManifestResponse(prompt, state.resumeProfile);
  if (crewResponse) {
    state.sequences.crew += 1;
    return buildResponse(
      {
        type: "speak_text",
        text: crewResponse,
      },
      {
        automated: true,
        automationKind: "crew-manifest",
        matchedPrompt: prompt,
        sequence: state.sequences.crew,
      },
    );
  }

  const knowledge = await getKnowledgeArchiveWord(prompt, state.wikipediaCache, fetchImpl);
  if (knowledge) {
    state.sequences.knowledge += 1;
    return buildResponse(
      {
        type: "speak_text",
        text: knowledge.token,
      },
      {
        automated: true,
        automationKind: "knowledge-archive",
        matchedPrompt: prompt,
        title: knowledge.title,
        ordinal: knowledge.ordinal,
        token: knowledge.token,
        tokenCount: knowledge.tokenCount,
        sequence: state.sequences.knowledge,
      },
    );
  }

  return null;
}

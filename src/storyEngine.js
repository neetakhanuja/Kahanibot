// src/storyEngine.js

function normalizeYesNo(text) {
  const t = (text || "").trim().toLowerCase();
  if (["y", "yes", "haan", "ha"].includes(t)) return "YES";
  if (["n", "no", "nahi", "na"].includes(t)) return "NO";
  return "UNKNOWN";
}

// Simple local draft generator (non-AI fallback)
function makeDraft(transcript) {
  const clean = (transcript || "").trim();

  const lines = clean
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const greetingWords = new Set([
    "hello",
    "hi",
    "hey",
    "namaste",
    "hola",
    "good morning",
    "good afternoon",
    "good evening",
  ]);

  const firstMeaningful =
    lines.find((l) => !greetingWords.has(l.toLowerCase())) || "A Memory";

  const title = firstMeaningful.slice(0, 60);
  const body = clean;

  return { title, body };
}

export { normalizeYesNo, makeDraft };
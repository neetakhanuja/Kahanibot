// src/storyEngine.js

function normalizeYesNo(text) {
  const t = (text || "").trim().toLowerCase();
  if (["y", "yes", "haan", "ha"].includes(t)) return "YES";
  if (["n", "no", "nahi", "na"].includes(t)) return "NO";
  return "UNKNOWN";
}

// Simple draft generator for V1 (no AI yet)
function makeDraft(transcript) {
  const clean = (transcript || "").trim();

  // Split into non-empty lines
  const lines = clean
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Words to ignore as title
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

  // Find first meaningful line
  const firstMeaningful =
    lines.find((l) => !greetingWords.has(l.toLowerCase())) || "A Memory";

  const title = firstMeaningful.slice(0, 60);

  const storyBody =
    `Title: ${title}\n\n` +
    `Story:\n${clean}\n\n` +
    `Share this on your public page? YES/NO`;

  return { title, storyBody };
}

export { normalizeYesNo, makeDraft };
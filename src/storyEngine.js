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
  const firstLine = clean.split("\n")[0] || "A Memory";
  const title = firstLine.slice(0, 60);

  const storyBody =
    `Title: ${title}\n\n` +
    `Story:\n${clean}\n\n` +
    `Share this on your public page? YES/NO`;

  return { title, storyBody };
}

export { normalizeYesNo, makeDraft };
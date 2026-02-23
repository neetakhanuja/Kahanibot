// src/repo.js
import { db } from "./db.js";

function findUserByToken(userToken) {
  return db.prepare("SELECT * FROM users WHERE userToken = ?").get(userToken);
}

function createUser(userToken) {
  const info = db.prepare("INSERT INTO users (userToken) VALUES (?)").run(userToken);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
}

function getSession(userId) {
  return db.prepare("SELECT * FROM sessions WHERE userId = ?").get(userId);
}

function upsertSession({ userId, status, currentStoryId, transcript }) {
  db.prepare(`
    INSERT INTO sessions (userId, status, currentStoryId, transcript, updatedAt)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(userId) DO UPDATE SET
      status=excluded.status,
      currentStoryId=excluded.currentStoryId,
      transcript=excluded.transcript,
      updatedAt=datetime('now')
  `).run(userId, status, currentStoryId ?? null, transcript ?? "");
}

function deleteSession(userId) {
  db.prepare("DELETE FROM sessions WHERE userId = ?").run(userId);
}

function createStory(userId) {
  const info = db.prepare("INSERT INTO stories (userId, transcript) VALUES (?, '')").run(userId);
  return db.prepare("SELECT * FROM stories WHERE id = ?").get(info.lastInsertRowid);
}

function updateStoryTranscript(storyId, transcript) {
  db.prepare("UPDATE stories SET transcript = ? WHERE id = ?").run(transcript, storyId);
}

function saveDraft(storyId, finalTitle, finalStory) {
  db.prepare("UPDATE stories SET finalTitle = ?, finalStory = ? WHERE id = ?").run(finalTitle, finalStory, storyId);
}

function setPublish(storyId, publish) {
  db.prepare("UPDATE stories SET publish = ? WHERE id = ?").run(publish ? 1 : 0, storyId);
}

export {
  findUserByToken,
  createUser,
  getSession,
  upsertSession,
  deleteSession,
  createStory,
  updateStoryTranscript,
  saveDraft,
  setPublish,
};

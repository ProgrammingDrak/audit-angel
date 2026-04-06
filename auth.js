/**
 * auth.js — User authentication for The Audit Angel
 *
 * Email/password auth with bcryptjs. Follows DCC patterns.
 */

const bcrypt = require("bcryptjs");
const db = require("./db");

const BCRYPT_ROUNDS = 12;

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

async function registerUser(email, displayName, password) {
  const hash = await hashPassword(password);
  return db.createUser(email, displayName, hash);
}

async function ensureDefaultUser() {
  const email = process.env.DEFAULT_USER_EMAIL || "drake@clever.com";
  const existing = await db.findUserByEmail(email);
  if (existing) return existing;
  const password = process.env.DEFAULT_USER_PASSWORD || "clever123";
  console.log(`[auth] Creating default user '${email}'`);
  return registerUser(email, "Drake Shadwell", password);
}

module.exports = { hashPassword, verifyPassword, registerUser, ensureDefaultUser };

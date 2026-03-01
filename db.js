const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "database.sqlite"));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    xp INTEGER DEFAULT 0,
    rank TEXT DEFAULT 'Cosmic Beginner',
    day_streak INTEGER DEFAULT 0,
    best_streak INTEGER DEFAULT 0,
    total_days INTEGER DEFAULT 0,
    last_active DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS quests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    xp_reward INTEGER DEFAULT 10,
    category TEXT DEFAULT 'general',
    is_daily INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS completed_quests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    quest_id INTEGER NOT NULL,
    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (quest_id) REFERENCES quests(id)
  );

  CREATE TABLE IF NOT EXISTS badges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    xp_required INTEGER DEFAULT 0,
    streak_required INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS user_badges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    badge_id INTEGER NOT NULL,
    earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (badge_id) REFERENCES badges(id)
  );
`);

// Seed default daily quests if none exist
const questCount = db.prepare("SELECT COUNT(*) as count FROM quests").get();
if (questCount.count === 0) {
  const seedQuests = db.prepare(
    "INSERT INTO quests (title, description, xp_reward, category) VALUES (?, ?, ?, ?)"
  );
  seedQuests.run("Morning Stretch", "Complete a 5-min morning stretch routine", 10, "flexibility");
  seedQuests.run("Hydration Check", "Drink 8 glasses of water today", 5, "wellness");
  seedQuests.run("Cosmic Cardio", "30 minutes of cardio under the stars", 25, "cardio");
  seedQuests.run("Strength Circuit", "Complete 3 sets of bodyweight exercises", 20, "strength");
  seedQuests.run("Mindful Cool-down", "10-min post-workout meditation", 10, "wellness");
}

// Seed default badges if none exist
const badgeCount = db.prepare("SELECT COUNT(*) as count FROM badges").get();
if (badgeCount.count === 0) {
  const seedBadge = db.prepare(
    "INSERT INTO badges (name, description, icon, xp_required, streak_required) VALUES (?, ?, ?, ?, ?)"
  );
  seedBadge.run("First Light", "Complete your first quest", "✦", 0, 0);
  seedBadge.run("Star Seeker", "Earn 100 XP", "⭐", 100, 0);
  seedBadge.run("Constellation", "Maintain a 7-day streak", "🌟", 0, 7);
  seedBadge.run("Supernova", "Earn 500 XP", "💫", 500, 0);
  seedBadge.run("Galaxy Guardian", "Maintain a 30-day streak", "🏆", 0, 30);
}

module.exports = db;

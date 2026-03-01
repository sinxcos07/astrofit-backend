const express = require("express");
const db = require("../db");

const router = express.Router();

// --- RANK HELPERS ---
function getRank(xp) {
  if (xp >= 2000) return "Galactic Master";
  if (xp >= 1000) return "Nebula Warrior";
  if (xp >= 500)  return "Star Voyager";
  if (xp >= 200)  return "Cosmic Explorer";
  if (xp >= 100)  return "Star Seeker";
  return "Cosmic Beginner";
}

function getNextRankXP(xp) {
  if (xp < 100)  return 100;
  if (xp < 200)  return 200;
  if (xp < 500)  return 500;
  if (xp < 1000) return 1000;
  if (xp < 2000) return 2000;
  return null; // max rank
}

function checkAndAwardBadges(userId) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  const allBadges = db.prepare("SELECT * FROM badges").all();
  const earnedIds = db
    .prepare("SELECT badge_id FROM user_badges WHERE user_id = ?")
    .all(userId)
    .map((b) => b.badge_id);

  const completedCount = db
    .prepare("SELECT COUNT(*) as count FROM completed_quests WHERE user_id = ?")
    .get(userId).count;

  const newBadges = [];

  for (const badge of allBadges) {
    if (earnedIds.includes(badge.id)) continue;

    const xpMet = badge.xp_required === 0 || user.xp >= badge.xp_required;
    const streakMet = badge.streak_required === 0 || user.day_streak >= badge.streak_required;
    const firstQuestMet = badge.name !== "First Light" || completedCount >= 1;

    if (xpMet && streakMet && firstQuestMet) {
      db.prepare("INSERT INTO user_badges (user_id, badge_id) VALUES (?, ?)").run(userId, badge.id);
      newBadges.push(badge);
    }
  }

  return newBadges;
}

// GET /api/astrofit/profile — full user profile with stats
router.get("/profile", (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  const badges = db
    .prepare(
      `SELECT b.*, ub.earned_at FROM badges b
       JOIN user_badges ub ON b.id = ub.badge_id
       WHERE ub.user_id = ?`
    )
    .all(req.user.id);

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    xp: user.xp,
    rank: user.rank,
    nextRankXP: getNextRankXP(user.xp),
    day_streak: user.day_streak,
    best_streak: user.best_streak,
    total_days: user.total_days,
    badges,
  });
});

// GET /api/astrofit/quests — get today's quests + completion status
router.get("/quests", (req, res) => {
  const today = new Date().toISOString().split("T")[0];

  const quests = db.prepare("SELECT * FROM quests WHERE is_daily = 1").all();
  const completedToday = db
    .prepare(
      `SELECT quest_id FROM completed_quests
       WHERE user_id = ? AND DATE(completed_at) = ?`
    )
    .all(req.user.id, today)
    .map((c) => c.quest_id);

  const questsWithStatus = quests.map((q) => ({
    ...q,
    completed: completedToday.includes(q.id),
  }));

  const totalXPAvailable = quests.reduce((sum, q) => sum + q.xp_reward, 0);
  const xpEarned = quests
    .filter((q) => completedToday.includes(q.id))
    .reduce((sum, q) => sum + q.xp_reward, 0);

  res.json({ quests: questsWithStatus, totalXPAvailable, xpEarned });
});

// POST /api/astrofit/quests/:id/complete — complete a quest
router.post("/quests/:id/complete", (req, res) => {
  const questId = parseInt(req.params.id);
  const today = new Date().toISOString().split("T")[0];

  const quest = db.prepare("SELECT * FROM quests WHERE id = ?").get(questId);
  if (!quest) return res.status(404).json({ error: "Quest not found" });

  // Check if already completed today
  const alreadyDone = db
    .prepare(
      `SELECT id FROM completed_quests
       WHERE user_id = ? AND quest_id = ? AND DATE(completed_at) = ?`
    )
    .get(req.user.id, questId, today);

  if (alreadyDone) {
    return res.status(409).json({ error: "Quest already completed today" });
  }

  // Log completion
  db.prepare("INSERT INTO completed_quests (user_id, quest_id) VALUES (?, ?)").run(
    req.user.id,
    questId
  );

  // Update XP
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  const newXP = user.xp + quest.xp_reward;
  const newRank = getRank(newXP);

  // Update streak
  let dayStreak = user.day_streak;
  let bestStreak = user.best_streak;
  let totalDays = user.total_days;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  const activeToday = db
    .prepare(
      `SELECT id FROM completed_quests
       WHERE user_id = ? AND DATE(completed_at) = ?`
    )
    .get(req.user.id, today);

  if (!user.last_active || user.last_active === yesterdayStr) {
    // Active yesterday or first quest today → extend/start streak
    if (user.last_active !== today) {
      dayStreak += 1;
      totalDays += 1;
    }
  } else if (user.last_active !== today) {
    // Missed a day — reset streak
    dayStreak = 1;
    totalDays += 1;
  }

  if (dayStreak > bestStreak) bestStreak = dayStreak;

  db.prepare(
    `UPDATE users SET xp = ?, rank = ?, day_streak = ?, best_streak = ?,
     total_days = ?, last_active = ? WHERE id = ?`
  ).run(newXP, newRank, dayStreak, bestStreak, totalDays, today, req.user.id);

  // Check for new badges
  const newBadges = checkAndAwardBadges(req.user.id);

  res.json({
    message: "Quest completed! ✦",
    xpEarned: quest.xp_reward,
    totalXP: newXP,
    rank: newRank,
    day_streak: dayStreak,
    best_streak: bestStreak,
    newBadges,
  });
});

// GET /api/astrofit/leaderboard — top 10 by XP
router.get("/leaderboard", (req, res) => {
  const leaders = db
    .prepare(
      `SELECT id, name, xp, rank, day_streak FROM users
       ORDER BY xp DESC LIMIT 10`
    )
    .all();

  res.json({ leaderboard: leaders });
});

module.exports = router;

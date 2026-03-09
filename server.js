import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware
app.use(cors());
app.use(express.json());

// Initialize SQLite Database
const db = new sqlite3.Database('./astrofit.db', (err) => {
  if (err) console.error('Database error:', err);
  else console.log('Connected to SQLite database');
});

// Create tables if they don't exist
db.serialize(() => {
  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // User profiles/progress table
  db.run(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      xp INTEGER DEFAULT 0,
      rank TEXT DEFAULT 'Cosmic Beginner',
      day_streak INTEGER DEFAULT 0,
      last_active_date DATE,
      total_workouts INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Badges table
  db.run(`
    CREATE TABLE IF NOT EXISTS user_badges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      badge_name TEXT NOT NULL,
      badge_icon TEXT,
      earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Workout log
  db.run(`
    CREATE TABLE IF NOT EXISTS workout_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      workout_type TEXT,
      duration_minutes INTEGER,
      xp_earned INTEGER DEFAULT 0,
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
});

// ─────────────────────────────────────────────────
// AUTH ENDPOINTS
// ─────────────────────────────────────────────────

// Signup
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    db.run(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      [name, email, hashedPassword],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Email already exists' });
          }
          return res.status(500).json({ error: 'Signup failed' });
        }

        const userId = this.lastID;

        // Create user profile
        db.run(
          'INSERT INTO user_profiles (user_id, rank, day_streak) VALUES (?, ?, ?)',
          [userId, 'Cosmic Beginner', 0],
          (profileErr) => {
            if (profileErr) {
              return res.status(500).json({ error: 'Failed to create profile' });
            }

            const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '30d' });
            res.json({ 
              token, 
              message: 'Account created successfully',
              user: { id: userId, name, email }
            });
          }
        );
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'Signup error: ' + err.message });
  }
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Login error' });
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    try {
      const validPassword = await bcrypt.compare(password, user.password);

      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
      res.json({ 
        token,
        user: { id: user.id, name: user.name, email: user.email }
      });
    } catch (err) {
      res.status(500).json({ error: 'Login error: ' + err.message });
    }
  });
});

// ─────────────────────────────────────────────────
// AUTH MIDDLEWARE
// ─────────────────────────────────────────────────

const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// ─────────────────────────────────────────────────
// PROFILE ENDPOINTS
// ─────────────────────────────────────────────────

// Get user profile
app.get('/api/astrofit/profile', verifyToken, (req, res) => {
  db.get(
    `SELECT u.id, u.name, u.email, up.xp, up.rank, up.day_streak, up.total_workouts
     FROM users u
     LEFT JOIN user_profiles up ON u.id = up.user_id
     WHERE u.id = ?`,
    [req.userId],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Profile fetch error' });
      }

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Get badges
      db.all(
        'SELECT badge_name, badge_icon FROM user_badges WHERE user_id = ?',
        [req.userId],
        (badgesErr, badges) => {
          if (badgesErr) {
            return res.status(500).json({ error: 'Badges fetch error' });
          }

          res.json({
            id: user.id,
            name: user.name,
            email: user.email,
            xp: user.xp || 0,
            rank: user.rank || 'Cosmic Beginner',
            day_streak: user.day_streak || 0,
            total_workouts: user.total_workouts || 0,
            badges: badges || [],
            nextRankXP: getNextRankXP(user.xp || 0)
          });
        }
      );
    }
  );
});

// Update XP and check for level up
app.post('/api/astrofit/add-xp', verifyToken, (req, res) => {
  const { xp, workoutType } = req.body;

  if (!xp || xp < 0) {
    return res.status(400).json({ error: 'Valid XP amount required' });
  }

  // Add XP to profile
  db.run(
    `UPDATE user_profiles 
     SET xp = xp + ?, total_workouts = total_workouts + 1, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ?`,
    [xp, req.userId],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'XP update failed' });
      }

      // Log workout
      db.run(
        'INSERT INTO workout_logs (user_id, workout_type, xp_earned) VALUES (?, ?, ?)',
        [req.userId, workoutType || 'general', xp]
      );

      // Get updated profile
      db.get(
        'SELECT xp, rank FROM user_profiles WHERE user_id = ?',
        [req.userId],
        (getErr, profile) => {
          if (getErr) {
            return res.status(500).json({ error: 'Profile fetch error' });
          }

          const newRank = calculateRank(profile.xp);
          const oldRank = profile.rank;

          if (newRank !== oldRank) {
            db.run(
              'UPDATE user_profiles SET rank = ? WHERE user_id = ?',
              [newRank, req.userId]
            );
          }

          res.json({
            newXP: profile.xp,
            rank: newRank,
            ranked_up: newRank !== oldRank,
            nextRankXP: getNextRankXP(profile.xp)
          });
        }
      );
    }
  );
});

// Update streak
app.post('/api/astrofit/update-streak', verifyToken, (req, res) => {
  db.run(
    `UPDATE user_profiles 
     SET day_streak = day_streak + 1, last_active_date = DATE('now'), updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ?`,
    [req.userId],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Streak update failed' });
      }

      db.get(
        'SELECT day_streak FROM user_profiles WHERE user_id = ?',
        [req.userId],
        (getErr, profile) => {
          if (getErr) {
            return res.status(500).json({ error: 'Profile fetch error' });
          }

          res.json({ day_streak: profile.day_streak });
        }
      );
    }
  );
});

// Add badge
app.post('/api/astrofit/add-badge', verifyToken, (req, res) => {
  const { badge_name, badge_icon } = req.body;

  if (!badge_name) {
    return res.status(400).json({ error: 'Badge name required' });
  }

  db.run(
    'INSERT INTO user_badges (user_id, badge_name, badge_icon) VALUES (?, ?, ?)',
    [req.userId, badge_name, badge_icon || '✦'],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Badge add failed' });
      }

      res.json({ 
        badgeId: this.lastID,
        message: 'Badge earned!'
      });
    }
  );
});

// Get workout history
app.get('/api/astrofit/workout-history', verifyToken, (req, res) => {
  db.all(
    `SELECT * FROM workout_logs 
     WHERE user_id = ?
     ORDER BY completed_at DESC
     LIMIT 50`,
    [req.userId],
    (err, workouts) => {
      if (err) {
        return res.status(500).json({ error: 'Workout history fetch error' });
      }

      res.json({ workouts: workouts || [] });
    }
  );
});

// Reset daily data (run daily)
app.post('/api/astrofit/reset-daily', verifyToken, (req, res) => {
  db.get(
    'SELECT last_active_date FROM user_profiles WHERE user_id = ?',
    [req.userId],
    (err, profile) => {
      if (err) {
        return res.status(500).json({ error: 'Profile fetch error' });
      }

      const lastActive = profile?.last_active_date;
      const today = new Date().toISOString().split('T')[0];

      if (lastActive !== today) {
        // Check if it's been more than 1 day - reset streak
        if (lastActive) {
          const lastDate = new Date(lastActive);
          const todayDate = new Date(today);
          const daysDiff = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));

          if (daysDiff > 1) {
            db.run(
              'UPDATE user_profiles SET day_streak = 0, last_active_date = ? WHERE user_id = ?',
              [today, req.userId]
            );
          }
        }
      }

      res.json({ message: 'Daily reset checked' });
    }
  );
});

// ─────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────

function calculateRank(xp) {
  if (xp >= 5000) return 'Cosmic Ascendant';
  if (xp >= 2500) return 'Stellar Champion';
  if (xp >= 1500) return 'Galactic Hero';
  if (xp >= 800) return 'Space Voyager';
  if (xp >= 400) return 'Cosmic Warrior';
  if (xp >= 200) return 'Star Seeker';
  if (xp >= 100) return 'Cosmic Explorer';
  return 'Cosmic Beginner';
}

function getNextRankXP(currentXp) {
  const thresholds = [100, 200, 400, 800, 1500, 2500, 5000];
  return thresholds.find(t => t > currentXp) || 5000;
}

// ─────────────────────────────────────────────────
// ERROR HANDLING
// ─────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`✦ AstroFit Backend running on port ${PORT}`);
});

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

dotenv.config();

const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || '*'
}));
app.use(express.json());

// Initialize PostgreSQL Database (for Supabase)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Create tables if they don't exist
async function initDatabase() {
  try {
    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // User profiles/progress table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL,
        xp INTEGER DEFAULT 0,
        rank TEXT DEFAULT 'Cosmic Beginner',
        day_streak INTEGER DEFAULT 0,
        last_active_date DATE,
        total_workouts INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Badges table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_badges (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        badge_name TEXT NOT NULL,
        badge_icon TEXT,
        earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Workout log
    await pool.query(`
      CREATE TABLE IF NOT EXISTS workout_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        workout_type TEXT,
        duration_minutes INTEGER,
        xp_earned INTEGER DEFAULT 0,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    console.log('✓ Database tables initialized');
  } catch (err) {
    console.error('Database initialization error:', err.message);
  }
}

// Initialize on startup
initDatabase();

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

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert user
      const userResult = await client.query(
        'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id',
        [name, email, hashedPassword]
      );

      const userId = userResult.rows[0].id;

      // Create user profile
      await client.query(
        'INSERT INTO user_profiles (user_id, rank, day_streak) VALUES ($1, $2, $3)',
        [userId, 'Cosmic Beginner', 0]
      );

      await client.query('COMMIT');

      const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '30d' });
      res.json({
        token,
        message: 'Account created successfully',
        user: { id: userId, name, email }
      });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') { // Unique constraint violation
        return res.status(400).json({ error: 'Email already exists' });
      }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: 'Signup error: ' + err.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = userResult.rows[0];
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
app.get('/api/astrofit/profile', verifyToken, async (req, res) => {
  try {
    const userResult = await pool.query(
      `SELECT u.id, u.name, u.email, up.xp, up.rank, up.day_streak, up.total_workouts
       FROM users u
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE u.id = $1`,
      [req.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    const badgesResult = await pool.query(
      'SELECT badge_name, badge_icon FROM user_badges WHERE user_id = $1',
      [req.userId]
    );

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      xp: user.xp || 0,
      rank: user.rank || 'Cosmic Beginner',
      day_streak: user.day_streak || 0,
      total_workouts: user.total_workouts || 0,
      badges: badgesResult.rows || [],
      nextRankXP: getNextRankXP(user.xp || 0)
    });
  } catch (err) {
    res.status(500).json({ error: 'Profile fetch error: ' + err.message });
  }
});

// Update XP and check for level up
app.post('/api/astrofit/add-xp', verifyToken, async (req, res) => {
  const { xp, workoutType } = req.body;

  if (!xp || xp < 0) {
    return res.status(400).json({ error: 'Valid XP amount required' });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update XP
      await client.query(
        `UPDATE user_profiles 
         SET xp = xp + $1, total_workouts = total_workouts + 1, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2`,
        [xp, req.userId]
      );

      // Log workout
      await client.query(
        'INSERT INTO workout_logs (user_id, workout_type, xp_earned) VALUES ($1, $2, $3)',
        [req.userId, workoutType || 'general', xp]
      );

      // Get updated profile
      const profileResult = await client.query(
        'SELECT xp, rank FROM user_profiles WHERE user_id = $1',
        [req.userId]
      );

      const profile = profileResult.rows[0];
      const newRank = calculateRank(profile.xp);
      const oldRank = profile.rank;

      if (newRank !== oldRank) {
        await client.query(
          'UPDATE user_profiles SET rank = $1 WHERE user_id = $2',
          [newRank, req.userId]
        );
      }

      await client.query('COMMIT');

      res.json({
        newXP: profile.xp,
        rank: newRank,
        ranked_up: newRank !== oldRank,
        nextRankXP: getNextRankXP(profile.xp)
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: 'XP update failed: ' + err.message });
  }
});

// Update streak
app.post('/api/astrofit/update-streak', verifyToken, async (req, res) => {
  try {
    await pool.query(
      `UPDATE user_profiles 
       SET day_streak = day_streak + 1, last_active_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [req.userId]
    );

    const result = await pool.query(
      'SELECT day_streak FROM user_profiles WHERE user_id = $1',
      [req.userId]
    );

    res.json({ day_streak: result.rows[0].day_streak });
  } catch (err) {
    res.status(500).json({ error: 'Streak update failed: ' + err.message });
  }
});

// Add badge
app.post('/api/astrofit/add-badge', verifyToken, async (req, res) => {
  const { badge_name, badge_icon } = req.body;

  if (!badge_name) {
    return res.status(400).json({ error: 'Badge name required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO user_badges (user_id, badge_name, badge_icon) VALUES ($1, $2, $3) RETURNING id',
      [req.userId, badge_name, badge_icon || '✦']
    );

    res.json({
      badgeId: result.rows[0].id,
      message: 'Badge earned!'
    });
  } catch (err) {
    res.status(500).json({ error: 'Badge add failed: ' + err.message });
  }
});

// Get workout history
app.get('/api/astrofit/workout-history', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM workout_logs 
       WHERE user_id = $1
       ORDER BY completed_at DESC
       LIMIT 50`,
      [req.userId]
    );

    res.json({ workouts: result.rows || [] });
  } catch (err) {
    res.status(500).json({ error: 'Workout history fetch error: ' + err.message });
  }
});

// Reset daily data (run daily)
app.post('/api/astrofit/reset-daily', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT last_active_date FROM user_profiles WHERE user_id = $1',
      [req.userId]
    );

    const lastActive = result.rows[0]?.last_active_date;
    const today = new Date().toISOString().split('T')[0];

    if (lastActive !== today) {
      if (lastActive) {
        const lastDate = new Date(lastActive);
        const todayDate = new Date(today);
        const daysDiff = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));

        if (daysDiff > 1) {
          await pool.query(
            'UPDATE user_profiles SET day_streak = 0, last_active_date = $1 WHERE user_id = $2',
            [today, req.userId]
          );
        }
      }
    }

    res.json({ message: 'Daily reset checked' });
  } catch (err) {
    res.status(500).json({ error: 'Daily reset error: ' + err.message });
  }
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

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Closing database pool...');
  await pool.end();
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log(`✦ AstroFit Backend running on port ${PORT}`);
});

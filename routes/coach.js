const express = require("express");
const router = express.Router();

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// POST /api/coach/chat
router.post("/chat", async (req, res) => {
  const { message, userStats } = req.body;

  if (!message) return res.status(400).json({ error: "Message is required" });

  const systemContext = `You are AstroCoach, an elite cosmic fitness coach for the AstroFit app — a gamified fitness tracker themed around stars and the universe. 

Your personality: Motivating, energetic, knowledgeable, with subtle cosmic/space references. Keep responses concise (2-4 sentences max unless giving a workout plan).

${userStats ? `The user's current stats:
- Name: ${userStats.name || "Cosmic Explorer"}
- XP: ${userStats.xp || 0}
- Rank: ${userStats.rank || "Cosmic Beginner"}
- Current Streak: ${userStats.day_streak || 0} days
- Best Streak: ${userStats.best_streak || 0} days
- Badges earned: ${userStats.badges || 0}

Use their stats to personalize your advice and motivation.` : ""}

You specialize in:
- Personalized workout plans based on fitness level
- Diet and nutrition advice
- Motivating users based on their progress and streaks
- Answering fitness questions clearly and accurately

Always stay in character as AstroCoach. Use occasional cosmic metaphors but don't overdo it.`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: systemContext + "\n\nUser: " + message }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 500,
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini error:", data);
      return res.status(500).json({ error: "AI service error" });
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "The cosmos is silent... try again!";
    res.json({ reply });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to reach AI service" });
  }
});

module.exports = router;

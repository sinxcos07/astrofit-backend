require("dotenv").config();
const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth");
const astrofitRoutes = require("./routes/astrofit");
const { authenticateToken } = require("./middleware/auth");
const coachRoutes = require("./routes/coach");
app.use("/api/coach", coachRoutes); // no auth needed

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: ["https://astrofitt.vercel.app", "http://localhost:3000"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/astrofit", authenticateToken, astrofitRoutes); // protected

// Health check
app.get("/", (req, res) => {
  res.json({ message: "AstroFit backend is running ✦" });
});

app.listen(PORT, () => {
  console.log(`AstroFit server running on http://localhost:${PORT}`);
});

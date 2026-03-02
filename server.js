require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const astrofitRoutes = require("./routes/astrofit");
const { authenticateToken } = require("./middleware/auth");

const app = express();
const PORT = process.env.PORT || 3000;

// CORS (allow all for now)
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/astrofit", authenticateToken, astrofitRoutes);

// Health check
app.get("/", (req, res) => {
  res.json({ message: "AstroFit backend is running ✦" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
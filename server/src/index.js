import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// TODO (týden 6–7): endpointy pro gateway, místnosti, hádanky a hry

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server běží na http://localhost:${port}`);
});

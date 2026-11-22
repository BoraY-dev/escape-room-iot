// Spuštění serveru: připojení k databázi, naslouchání na portu a hlídání vypršení her.
import { config } from "./config.js";
import { connectDb } from "./db.js";
import { createApp } from "./app.js";
import { expireGames } from "./abl/game.js";

await connectDb(config.mongodbUri);
createApp().listen(config.port, () => {
  console.log(`Server běží na http://localhost:${config.port}`);
});

// Hra vyprší i tehdy, když se na ni nikdo nedívá (command-list-webapp.md, game/getCurrent krok 2)
setInterval(() => {
  expireGames().catch((e) => console.error("[expireGames]", e));
}, 5000);

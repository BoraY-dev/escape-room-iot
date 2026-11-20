// Spuštění serveru: připojení k databázi a naslouchání na portu.
import { config } from "./config.js";
import { connectDb } from "./db.js";
import { createApp } from "./app.js";

await connectDb(config.mongodbUri);
createApp().listen(config.port, () => {
  console.log(`Server běží na http://localhost:${config.port}`);
});

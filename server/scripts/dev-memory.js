// Lokální vývoj bez Atlasu: spustí dočasnou MongoDB v paměti (replica set kvůli transakcím),
// založí demo provozovnu se dvěma uživateli a spustí server. Po ukončení data zmizí.
//   npm run dev:memory
import { MongoMemoryReplSet } from "mongodb-memory-server";
import bcrypt from "bcryptjs";
import { config } from "../src/config.js";
import { connectDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { venueDao, userDao } from "../src/dao/index.js";

// Jen pro lokální vývoj – stejné hodnoty jsou v server/README.md
const DEMO_PASSWORD = "demo-heslo-123";
const DEMO_USERS = [
  { email: "operator@demo.local", name: "Demo provozovatel", role: "operator" },
  { email: "gamemaster@demo.local", name: "Demo game master", role: "gameMaster" },
];

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
await connectDb(replSet.getUri("escape-room-iot"));

const venue = await venueDao.create("Demo provozovna");
const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
for (const u of DEMO_USERS) await userDao.create({ ...u, venueId: venue._id, passwordHash });

createApp().listen(config.port, () => {
  console.log(`Server (databáze v paměti) běží na http://localhost:${config.port}`);
  console.log(`Demo účty: ${DEMO_USERS.map((u) => u.email).join(", ")} – heslo v server/README.md`);
});

const stop = async () => { await replSet.stop(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

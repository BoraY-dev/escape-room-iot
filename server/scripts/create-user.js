// Založení uživatele webové aplikace (application-profiles.md, otevřený bod 1).
//
// První provozovna a provozovatel:
//   $env:USER_PASSWORD = "<heslo>"; npm run create-user -- --venue "Únikovky Praha" --email jan@example.com --name "Jan Novák"
// Game master do existující provozovny:
//   $env:USER_PASSWORD = "<heslo>"; npm run create-user -- --venue-id <venueId> --role gameMaster --email eva@example.com --name "Eva"
//
// Heslo se bere z proměnné prostředí USER_PASSWORD, aby nezůstalo v historii příkazů ani ve výpisu procesů.
import { parseArgs } from "node:util";
import bcrypt from "bcryptjs";
import { config } from "../src/config.js";
import { connectDb, disconnectDb } from "../src/db.js";
import { venueDao, userDao } from "../src/dao/index.js";

const { values } = parseArgs({
  options: {
    venue: { type: "string" },
    "venue-id": { type: "string" },
    email: { type: "string" },
    name: { type: "string" },
    role: { type: "string", default: "operator" },
  },
});

const password = process.env.USER_PASSWORD;
if (!values.email || !values.name || !password || (!values.venue && !values["venue-id"])) {
  console.error("Použití: viz komentář v scripts/create-user.js (povinné: --email, --name, --venue nebo --venue-id, USER_PASSWORD)");
  process.exit(1);
}
if (!["operator", "gameMaster"].includes(values.role)) {
  console.error("--role musí být operator nebo gameMaster");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Heslo musí mít aspoň 8 znaků.");
  process.exit(1);
}

await connectDb(config.mongodbUri);
try {
  const venue = values["venue-id"] ? await venueDao.get(values["venue-id"]) : await venueDao.create(values.venue);
  if (!venue) throw new Error(`Provozovna ${values["venue-id"]} neexistuje.`);
  const user = await userDao.create({
    venueId: venue._id,
    email: values.email,
    name: values.name,
    role: values.role,
    passwordHash: await bcrypt.hash(password, 10),
  });
  console.log(`Založeno: provozovna ${venue._id} (${venue.name}), uživatel ${user.email} (${user.role}).`);
} finally {
  await disconnectDb();
}

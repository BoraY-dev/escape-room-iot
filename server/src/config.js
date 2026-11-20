// Nastavení serveru z proměnných prostředí (.env); tajné hodnoty nikdy nejsou v kódu.
import "dotenv/config";

const isProduction = process.env.NODE_ENV === "production";

function jwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (isProduction) throw new Error("Chybí JWT_SECRET – v produkci je povinný.");
  return "dev-only-secret-change-me"; // jen pro lokální vývoj a testy
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  mongodbUri: process.env.MONGODB_URI,
  jwtSecret: jwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "12h",

  // Rozhodnutí návrhu (Command List pro gateway, kap. 1)
  heartbeatIntervalSec: 30,
  onlineThresholdSec: 60,          // online = kontakt za posledních 60 s (2× heartbeat)
  commandPollIntervalSec: 2,
  batchSize: 100,
  futureToleranceSec: 60,          // tolerance hodin gateway pro události a měření z „budoucnosti“
  registrationCodeTtlMs: 24 * 60 * 60 * 1000,
  downsampling: { sampleIntervalSec: 10, windowSec: 300, aggregation: "median" },

  // Limit List (Persistence Layer)
  limits: { roomsPerVenue: 50, devicesPerRoom: 32 },
};

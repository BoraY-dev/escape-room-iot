// Ověření volajícího a kontrola profilu (application-profiles.md).
// Web: JWT po přihlášení (role → Operators / GameMasters). Gateway: náhodný token z registrace (profil Gateways).
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { Errors } from "./errors.js";
import { gatewayDao } from "./dao/index.js";

export const PUBLIC = "Public"; // command bez tokenu (user/login, gateway/register)

// Registrační kódy a tokeny gateway mají 128+ bitů náhody → stačí rychlý SHA-256 (hesla uživatelů jdou přes bcrypt)
export const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
export const randomSecret = (bytes) => crypto.randomBytes(bytes).toString("base64url");

export function signUserToken(user) {
  return jwt.sign(
    { venueId: String(user.venueId), role: user.role },
    config.jwtSecret,
    { subject: String(user._id), expiresIn: config.jwtExpiresIn },
  );
}

async function resolveSession(token) {
  // JWT má tři části oddělené tečkou, token gateway (base64url) tečky nemá
  if (token.split(".").length === 3) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      return {
        profile: payload.role === "operator" ? "Operators" : "GameMasters",
        userId: payload.sub,
        venueId: payload.venueId,
      };
    } catch {
      return null;
    }
  }
  const gateway = await gatewayDao.getByTokenHash(sha256(token));
  if (!gateway) return null; // neexistující, smazaná nebo zablokovaná gateway → 401
  return {
    profile: "Gateways",
    gatewayId: String(gateway._id),
    venueId: String(gateway.venueId),
    roomId: String(gateway.roomId),
  };
}

export async function authenticate(req, profiles) {
  if (profiles.includes(PUBLIC)) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(req.get("authorization") ?? "");
  if (!match) throw Errors.userNotAuthenticated();
  const session = await resolveSession(match[1]);
  if (!session) throw Errors.userNotAuthenticated();
  if (!profiles.includes(session.profile)) throw Errors.userNotAuthorized();
  return session;
}

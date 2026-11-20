// Společné pomocné funkce pro commandy: online stav, převod dokumentů na dtoOut, omezení četnosti.
import rateLimit from "express-rate-limit";
import { config } from "../config.js";

export const iso = (date) => (date ? new Date(date).toISOString() : null);
export const sid = (id) => (id ? String(id) : null);

// online = poslední kontakt není starší než 60 s (Command List pro gateway, kap. 1)
export function isOnline(lastSeenAt, now = Date.now()) {
  return Boolean(lastSeenAt) && now - new Date(lastSeenAt).getTime() <= config.onlineThresholdSec * 1000;
}

export function gatewaySummary(gateway, now = Date.now()) {
  if (!gateway) return null;
  return {
    id: sid(gateway._id),
    name: gateway.name,
    state: gateway.state,
    online: gateway.state === "active" && isOnline(gateway.lastSeenAt, now),
    lastSeenAt: iso(gateway.lastSeenAt),
  };
}

// Zařízení je online jen tehdy, když je online i gateway místnosti
export function deviceDto(device, gatewayOnline, now = Date.now()) {
  return {
    id: sid(device._id),
    roomId: sid(device.roomId),
    hwId: device.hwId,
    type: device.type,
    name: device.name,
    online: gatewayOnline && isOnline(device.lastSeenAt, now),
    lastSeenAt: iso(device.lastSeenAt),
    lastValue: device.lastValue ? { event: device.lastValue.event, value: device.lastValue.value } : null,
  };
}

// Omezení četnosti pokusů (registrace gateway, přihlášení) → 429 s uuAppErrorMap
export function createRateLimiter(commandName, limit) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === "test",
    handler: (req, res) => res.status(429).json({
      uuAppErrorMap: {
        [`escape-room-iot/${commandName}/tooManyRequests`]: { type: "error", message: "Too many requests, try again later." },
      },
    }),
  });
}

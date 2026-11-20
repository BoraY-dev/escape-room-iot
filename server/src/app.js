// Express aplikace: zaregistruje všechny commandy. Odděleno od index.js, aby ji testy mohly volat bez spuštění serveru.
import express from "express";
import cors from "cors";
import { registerCommand } from "./command.js";
import { userCommands } from "./abl/user.js";
import { roomCommands } from "./abl/room.js";
import { deviceCommands } from "./abl/device.js";
import { gatewayCommands } from "./abl/gateway.js";

export const commands = [...userCommands, ...roomCommands, ...deviceCommands, ...gatewayCommands];

export function createApp() {
  const app = express();
  app.set("trust proxy", 1); // za proxy cloudového hostingu (HTTPS končí na proxy) – kvůli IP v rate limitu
  app.use(cors());
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  for (const command of commands) registerCommand(app, command);

  // Neplatný JSON v těle požadavku
  app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({
        uuAppErrorMap: { "escape-room-iot/invalidDtoIn": { type: "error", message: "Request body is not valid JSON." } },
      });
    }
    next(err);
  });

  // Neexistující endpoint
  app.use((req, res) => {
    res.status(404).json({
      uuAppErrorMap: { "escape-room-iot/commandDoesNotExist": { type: "error", message: `Command ${req.method} ${req.path} does not exist.` } },
    });
  });

  return app;
}

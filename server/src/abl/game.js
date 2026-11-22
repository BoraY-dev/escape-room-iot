// Řízení hry a živý přehled (command-list-webapp.md, kap. 6 a 7).
// Každý řídicí command v jedné transakci: změní hru → zapíše událost (source "user") → vloží povel pro gateway.
import mongoose from "mongoose";
import { AppError, Errors } from "../errors.js";
import { roomDao, scenarioDao, puzzleDao, gameDao, deviceDao, gatewayDao, eventDao, gatewayCommandDao } from "../dao/index.js";
import { shape, string, id, boolean, datetime } from "../validation.js";
import { iso, sid, isOnline, gatewaySummary } from "./common.js";

const WEB_USERS = ["Operators", "GameMasters"];
const HINT_ALERT_MS = 2 * 60 * 1000;   // upozornění na nápovědu svítí 2 minuty

// ---------------------------------------------------------------------------
// Pomocné funkce
// ---------------------------------------------------------------------------

// Uplynulý a zbývající čas se počítají, neukládají
export function gameTiming(game, nowMs = Date.now()) {
  if (!game.startedAt) return { elapsedSec: 0, remainingSec: game.timeLimitMin * 60 };
  const end = game.endedAt ? new Date(game.endedAt).getTime() : game.pausedAt ? new Date(game.pausedAt).getTime() : nowMs;
  const elapsedSec = Math.max(0, Math.round((end - new Date(game.startedAt).getTime()) / 1000) - (game.pausedDurationSec ?? 0));
  return { elapsedSec, remainingSec: Math.max(0, game.timeLimitMin * 60 - elapsedSec) };
}

export const gameDto = (g, nowMs = Date.now()) => ({
  id: sid(g._id),
  roomId: sid(g.roomId),
  state: g.state,
  scenarioRevision: g.scenarioRevision,
  timeLimitMin: g.timeLimitMin,
  startedAt: iso(g.startedAt),
  pausedAt: iso(g.pausedAt),
  pausedDurationSec: g.pausedDurationSec ?? 0,
  endedAt: iso(g.endedAt),
  ...gameTiming(g, nowMs),
  hintCount: g.hintCount ?? 0,
  puzzleStateList: (g.puzzleStateList ?? []).map((p) => ({
    puzzleId: sid(p.puzzleId), name: p.name, state: p.state, solvedAt: iso(p.solvedAt), solvedBy: p.solvedBy ?? null,
  })),
});

const invalidGameState = (state, allowedStateList) =>
  new AppError("invalidGameState", 409, "The operation is not allowed in the current game state.", { state, allowedStateList });

async function loadRoom(session, roomId) {
  const room = await roomDao.get(session.venueId, roomId);
  if (!room) throw Errors.doesNotExist("room", { roomId });
  return room;
}

async function loadGame(session, roomId, allowed) {
  const room = await loadRoom(session, roomId);
  const game = await gameDao.get(room.currentGameId);
  if (!game) throw new AppError("gameDoesNotExist", 404, "The room has no current game; call game/reset first.", { roomId });
  if (!allowed.includes(game.state)) throw invalidGameState(game.state, allowed);
  return { room, game };
}

async function gatewayOf(roomId) {
  const gateway = await gatewayDao.getByRoom(roomId);
  return { gateway, online: Boolean(gatewaySummary(gateway)?.online) };
}

// Událost a povel pro gateway v rámci transakce tx. Bez gateway (zatím nebyla vytvořena) se povel nevkládá.
async function recordAndCommand(tx, { game, room, gateway, userId, eventType, eventExtra = {}, command }) {
  await eventDao.create({
    venueId: room.venueId, roomId: room._id, gameId: game._id, ...(userId && { userId }),
    type: eventType, source: userId ? "user" : "system", occurredAt: new Date(), ...eventExtra,
  }, tx);
  if (gateway && command) {
    await gatewayCommandDao.create({ venueId: room.venueId, gatewayId: gateway._id, type: command.type, payload: command.payload }, tx);
  }
}

const warnIfGatewayOffline = (warn, online) => {
  if (!online) warn("gatewayOffline", "Gateway is offline; the command will be delivered when it reconnects.");
};

// Společný průběh řídicího commandu: podmíněná změna hry, událost a povel v jedné transakci
async function control({ session, room, game, allowed, update, arrayFilters, eventType, eventExtra, command, warn }) {
  const { gateway, online } = await gatewayOf(room._id);
  let updated;
  await mongoose.connection.transaction(async (tx) => {
    updated = await gameDao.updateIfState(game._id, allowed, update, tx, arrayFilters);
    if (!updated) throw invalidGameState((await gameDao.get(game._id))?.state, allowed); // souběžná změna stavu
    await recordAndCommand(tx, { game: updated, room, gateway, userId: session.userId, eventType, eventExtra, command: command(updated) });
  });
  warnIfGatewayOffline(warn, online);
  return gameDto(updated);
}

// ---------------------------------------------------------------------------
// Vypršení času: běží každých 5 s (index.js) a před každým game/getCurrent
// ---------------------------------------------------------------------------
export async function expireGames({ gameId, nowMs = Date.now() } = {}) {
  const games = gameId ? [await gameDao.get(gameId)].filter((g) => g?.state === "running") : await gameDao.listRunning();
  let expired = 0;
  for (const game of games) {
    const deadline = new Date(game.startedAt).getTime() + game.timeLimitMin * 60000 + (game.pausedDurationSec ?? 0) * 1000;
    if (deadline > nowMs) continue;
    const room = await roomDao.getById(game.roomId);
    if (!room) continue;
    const { gateway } = await gatewayOf(game.roomId);
    await mongoose.connection.transaction(async (tx) => {
      const updated = await gameDao.updateIfState(game._id, ["running"], { $set: { state: "expired", endedAt: new Date(deadline) } }, tx);
      if (!updated) return; // mezitím pozastavena nebo ukončena
      await recordAndCommand(tx, {
        game: updated, room, gateway, eventType: "gameExpired",
        command: { type: "stopGame", payload: { gameId: sid(game._id), state: "expired" } },
      });
      expired++;
    });
  }
  return expired;
}

// ---------------------------------------------------------------------------
// Commandy
// ---------------------------------------------------------------------------
const roomOnly = shape({ roomId: id().isRequired() });

export const gameCommands = [
  {
    name: "game/reset",
    profiles: WEB_USERS,
    dtoInType: roomOnly,
    async handler(dtoIn, { session, warn }) {
      const room = await loadRoom(session, dtoIn.roomId);
      const current = await gameDao.get(room.currentGameId);
      const allowed = ["ready", "completed", "expired", "terminated"];
      if (current && !allowed.includes(current.state)) throw invalidGameState(current.state, allowed);
      const [scenario, puzzles, devices, { gateway, online }] = await Promise.all([
        scenarioDao.getByRoom(room._id), puzzleDao.listByRoom(room._id), deviceDao.listByRoom(room._id), gatewayOf(room._id),
      ]);
      if (!puzzles.length) throw new AppError("scenarioHasNoPuzzles", 409, "The scenario has no puzzles.", { roomId: dtoIn.roomId });

      let game;
      await mongoose.connection.transaction(async (tx) => {
        if (current?.state === "ready" && current.scenarioRevision === scenario.revision) {
          game = current; // připravená hra se stejnými pravidly zůstává, jen se znovu pošle reset
        } else {
          // připravená hra se starými pravidly se zruší, aby šla nová spustit (jinak by start hlásil scenarioChanged)
          if (current?.state === "ready") await gameDao.updateIfState(current._id, ["ready"], { $set: { state: "terminated", endedAt: new Date() } }, tx);
          game = await gameDao.create({
            venueId: room.venueId, roomId: room._id, scenarioRevision: scenario.revision, state: "ready",
            timeLimitMin: scenario.timeLimitMin, pausedDurationSec: 0, hintCount: 0,
            puzzleStateList: puzzles.map((p) => ({ puzzleId: p._id, name: p.name, state: "unsolved" })),
          }, tx);
          await roomDao.setCurrentGame(room._id, game._id, tx);
        }
        await recordAndCommand(tx, {
          game, room, gateway, userId: session.userId, eventType: "roomReset",
          command: { type: "resetRoom", payload: { gameId: sid(game._id), scenarioRevision: game.scenarioRevision } },
        });
      });

      warnIfGatewayOffline(warn, online);
      const offline = devices.filter((d) => !online || !isOnline(d.lastSeenAt));
      if (offline.length) warn("devicesOffline", "Some devices are offline.", { deviceIdList: offline.map((d) => sid(d._id)) });
      return gameDto(game);
    },
  },
  {
    name: "game/start",
    profiles: WEB_USERS,
    dtoInType: roomOnly,
    async handler(dtoIn, ctx) {
      const { room, game } = await loadGame(ctx.session, dtoIn.roomId, ["ready"]);
      // pravidla vyhodnocuje gateway – hra, o které neví, by nefungovala
      if (!(await gatewayOf(room._id)).online) throw new AppError("gatewayOffline", 409, "Gateway is offline; the game cannot start.");
      const scenario = await scenarioDao.getByRoom(room._id);
      if (scenario.revision !== game.scenarioRevision) {
        throw new AppError("scenarioChanged", 409, "The scenario changed since the reset; reset the room again.",
          { gameRevision: game.scenarioRevision, scenarioRevision: scenario.revision });
      }
      const startedAt = new Date();
      return control({
        ...ctx, room, game, allowed: ["ready"], update: { $set: { state: "running", startedAt } }, eventType: "gameStarted",
        command: (g) => ({ type: "startGame", payload: { gameId: sid(g._id), startedAt: iso(startedAt), timeLimitMin: g.timeLimitMin } }),
      });
    },
  },
  {
    name: "game/pause",
    profiles: WEB_USERS,
    dtoInType: roomOnly,
    async handler(dtoIn, ctx) {
      const { room, game } = await loadGame(ctx.session, dtoIn.roomId, ["running"]);
      return control({
        ...ctx, room, game, allowed: ["running"], update: { $set: { state: "paused", pausedAt: new Date() } }, eventType: "gamePaused",
        command: (g) => ({ type: "pauseGame", payload: { gameId: sid(g._id) } }),
      });
    },
  },
  {
    name: "game/resume",
    profiles: WEB_USERS,
    dtoInType: roomOnly,
    async handler(dtoIn, ctx) {
      const { room, game } = await loadGame(ctx.session, dtoIn.roomId, ["paused"]);
      const pausedSec = Math.max(0, Math.round((Date.now() - new Date(game.pausedAt).getTime()) / 1000));
      return control({
        ...ctx, room, game, allowed: ["paused"], eventType: "gameResumed",
        update: { $set: { state: "running", pausedAt: null }, $inc: { pausedDurationSec: pausedSec } },
        command: (g) => ({ type: "resumeGame", payload: { gameId: sid(g._id) } }),
      });
    },
  },
  {
    name: "game/stop",
    profiles: WEB_USERS,
    dtoInType: shape({ roomId: id().isRequired(), reason: string(0, 500) }),
    async handler(dtoIn, ctx) {
      const allowed = ["running", "paused"];
      const { room, game } = await loadGame(ctx.session, dtoIn.roomId, allowed);
      const pausedSec = game.state === "paused" ? Math.max(0, Math.round((Date.now() - new Date(game.pausedAt).getTime()) / 1000)) : 0;
      return control({
        ...ctx, room, game, allowed, eventType: "gameTerminated",
        eventExtra: dtoIn.reason ? { value: { reason: dtoIn.reason } } : {},
        update: { $set: { state: "terminated", endedAt: new Date(), pausedAt: null }, $inc: { pausedDurationSec: pausedSec } },
        command: (g) => ({ type: "stopGame", payload: { gameId: sid(g._id), state: "terminated" } }),
      });
    },
  },
  {
    name: "game/solvePuzzle",
    profiles: WEB_USERS,
    dtoInType: shape({ roomId: id().isRequired(), puzzleId: id().isRequired(), runActions: boolean() }),
    async handler(dtoIn, ctx) {
      const allowed = ["running", "paused"];
      const { room, game } = await loadGame(ctx.session, dtoIn.roomId, allowed);
      const item = game.puzzleStateList.find((p) => String(p.puzzleId) === dtoIn.puzzleId);
      if (!item) throw new AppError("puzzleNotInGame", 404, "The puzzle is not part of the game.", { puzzleId: dtoIn.puzzleId });
      if (item.state === "solved") throw new AppError("puzzleAlreadySolved", 409, "The puzzle is already solved.", { puzzleId: dtoIn.puzzleId });

      const now = new Date();
      const lastOne = game.puzzleStateList.every((p) => p.state === "solved" || String(p.puzzleId) === dtoIn.puzzleId);
      const pausedSec = lastOne && game.state === "paused" ? Math.max(0, Math.round((now - new Date(game.pausedAt)) / 1000)) : 0;
      const set = {
        "puzzleStateList.$[p].state": "solved", "puzzleStateList.$[p].solvedAt": now, "puzzleStateList.$[p].solvedBy": "user",
        // poslední vyřešená hádanka hru dokončí
        ...(lastOne && { state: "completed", endedAt: now, pausedAt: null }),
      };
      const runActions = dtoIn.runActions ?? true; // výchozí true: gateway provede i akce hádanky (LED)
      return control({
        ...ctx, room, game, allowed, eventType: "puzzleSolvedManually", eventExtra: { puzzleId: dtoIn.puzzleId },
        update: { $set: set, $inc: { pausedDurationSec: pausedSec } },
        arrayFilters: [{ "p.puzzleId": new mongoose.Types.ObjectId(dtoIn.puzzleId) }],
        command: (g) => ({ type: "solvePuzzle", payload: { gameId: sid(g._id), puzzleId: dtoIn.puzzleId, runActions } }),
      });
    },
  },
  {
    name: "game/unsolvePuzzle",
    profiles: WEB_USERS,
    dtoInType: shape({ roomId: id().isRequired(), puzzleId: id().isRequired() }),
    async handler(dtoIn, ctx) {
      const allowed = ["running", "paused"];
      const { room, game } = await loadGame(ctx.session, dtoIn.roomId, allowed);
      const item = game.puzzleStateList.find((p) => String(p.puzzleId) === dtoIn.puzzleId);
      if (!item) throw new AppError("puzzleNotInGame", 404, "The puzzle is not part of the game.", { puzzleId: dtoIn.puzzleId });
      if (item.state !== "solved") throw new AppError("puzzleNotSolved", 409, "The puzzle is not solved.", { puzzleId: dtoIn.puzzleId });
      return control({
        ...ctx, room, game, allowed, eventType: "puzzleUnsolved", eventExtra: { puzzleId: dtoIn.puzzleId },
        update: { $set: { "puzzleStateList.$[p].state": "unsolved", "puzzleStateList.$[p].solvedAt": null, "puzzleStateList.$[p].solvedBy": null } },
        arrayFilters: [{ "p.puzzleId": new mongoose.Types.ObjectId(dtoIn.puzzleId) }],
        command: (g) => ({ type: "unsolvePuzzle", payload: { gameId: sid(g._id), puzzleId: dtoIn.puzzleId } }),
      });
    },
  },
  {
    name: "game/getCurrent",
    method: "get",
    profiles: WEB_USERS,
    dtoInType: shape({ roomId: id().isRequired(), eventsSince: datetime() }),
    async handler(dtoIn, { session }) {
      const room = await loadRoom(session, dtoIn.roomId);
      if (room.currentGameId) await expireGames({ gameId: room.currentGameId }); // hra vyprší, i když server zrovna nekontroloval
      const game = await gameDao.get(room.currentGameId);
      if (!game) return { game: null, alertList: [], eventList: [] }; // nová místnost hru zatím nemá – není to chyba

      const now = Date.now();
      const [{ gateway, online }, devices, hint, events] = await Promise.all([
        gatewayOf(room._id),
        deviceDao.listByRoom(room._id),
        eventDao.lastHintRequest(game._id, new Date(now - HINT_ALERT_MS)),
        eventDao.listForGame(room._id, game._id, dtoIn.eventsSince, dtoIn.eventsSince ? 100 : 20),
      ]);
      const alertList = [];
      if (hint) alertList.push({ type: "hintRequested", at: iso(hint.occurredAt) });
      if (game.state === "expired") alertList.push({ type: "timeExpired", at: iso(game.endedAt) });
      if (gateway && !online) alertList.push({ type: "gatewayOffline", since: iso(gateway.lastSeenAt) });
      if (online) {
        for (const d of devices) if (!isOnline(d.lastSeenAt, now)) alertList.push({ type: "deviceOffline", deviceId: sid(d._id), since: iso(d.lastSeenAt) });
      }
      const nameById = new Map(devices.map((d) => [String(d._id), d.name]));
      const eventList = events
        .sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt))
        .map((e) => ({
          id: sid(e._id), type: e.type,
          ...(e.deviceId && { deviceId: sid(e.deviceId), deviceName: nameById.get(String(e.deviceId)) ?? null }),
          ...(e.puzzleId && { puzzleId: sid(e.puzzleId) }),
          ...(e.value && { value: e.value }),
          source: e.source, occurredAt: iso(e.occurredAt), createdAt: iso(e.createdAt),
        }));
      return { game: gameDto(game, now), alertList, eventList };
    },
  },
];

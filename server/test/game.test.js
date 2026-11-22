// Testy scénáře, hádanek a řízení hry (command-list-webapp.md, kap. 5–7) proti MongoDB v paměti.
process.env.NODE_ENV = "test";

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import request from "supertest";
import bcrypt from "bcryptjs";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { connectDb, disconnectDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { venueDao, userDao } from "../src/dao/index.js";
import { Game, Gateway, Event } from "../src/models/index.js";
import { expireGames } from "../src/abl/game.js";

const PASSWORD = "test-heslo-123";
let replSet;
let app;
const t = {};          // tokeny
const dev = {};        // hwId → deviceId
let roomId;
let gwToken;

const err = (res, code) => Object.keys(res.body.uuAppErrorMap).find((k) => k.endsWith(`/${code}`));
const post = (path, token, body) => request(app).post(path).set("Authorization", `Bearer ${token}`).send(body);
const get = (path, token, query) => request(app).get(path).set("Authorization", `Bearer ${token}`).query(query ?? {});
const heartbeat = () => post("/gateway/heartbeat", gwToken, {
  scenarioRevision: 0,
  deviceList: [["node1.btn1", "button"], ["node1.btn2", "button"], ["node1.acc1", "accelerometer"], ["node1.temp1", "thermometer"], ["node1.led1", "led"]]
    .map(([hwId, type]) => ({ hwId, type })),
});
// povely, které si gateway vyzvedne, a jejich potvrzení (jako to dělá Node-RED flow)
async function takeCommands() {
  const res = await get("/gateway/getCommands", gwToken);
  const items = res.body.itemList;
  if (items.length) await post("/gateway/ackCommands", gwToken, { commandIdList: items.map((c) => c.id) });
  return items;
}

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await connectDb(replSet.getUri("escape-room-iot-game"));
  app = createApp();
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const venue = await venueDao.create("Hra");
  await userDao.create({ venueId: venue._id, email: "op@game.local", name: "Op", role: "operator", passwordHash });
  await userDao.create({ venueId: venue._id, email: "gm@game.local", name: "GM", role: "gameMaster", passwordHash });
  for (const [key, email] of [["op", "op@game.local"], ["gm", "gm@game.local"]]) {
    t[key] = (await request(app).post("/user/login").send({ email, password: PASSWORD })).body.token;
  }
  roomId = (await post("/room/create", t.op, { name: "Pirátská kajuta", timeLimitMin: 60 })).body.id;
  const code = (await post("/gateway/create", t.op, { roomId, name: "RPi" })).body.registrationCode;
  gwToken = (await request(app).post("/gateway/register").send({ registrationCode: code })).body.accessToken;
  for (const d of (await heartbeat()).body.deviceList) dev[d.hwId] = d.id;
});

after(async () => {
  await disconnectDb();
  await replSet.stop();
});

describe("scénář a hádanky", () => {
  test("scenario/get a scenario/update (tlačítko pro nápovědu)", async () => {
    const s = await get("/scenario/get", t.gm, { roomId });
    assert.equal(s.status, 200);
    assert.equal(s.body.revision, 1);
    assert.deepEqual(s.body.puzzleList, []);

    const notButton = await post("/scenario/update", t.op, { roomId, hintDeviceId: dev["node1.temp1"] });
    assert.equal(notButton.status, 400);
    assert.ok(err(notButton, "deviceTypeMismatch"));

    const ok = await post("/scenario/update", t.op, { roomId, hintDeviceId: dev["node1.btn1"], timeLimitMin: 45 });
    assert.equal(ok.body.hintDeviceId, dev["node1.btn1"]);
    assert.equal(ok.body.timeLimitMin, 45);
    assert.equal(ok.body.revision, 2);

    assert.equal((await post("/scenario/update", t.gm, { roomId, timeLimitMin: 30 })).status, 403);
  });

  test("puzzle/create: validace pravidel", async () => {
    const base = { roomId, name: "Truhla" };
    const tilt = { trigger: { deviceId: dev["node1.acc1"], eventType: "tilt" }, condition: { operator: "gt", value: 45 }, actionList: [{ type: "solvePuzzle" }] };

    const noCondition = await post("/puzzle/create", t.op, { ...base, ruleList: [{ ...tilt, condition: undefined }] });
    assert.ok(err(noCondition, "invalidCondition"));
    const wrongEvent = await post("/puzzle/create", t.op, { ...base, ruleList: [{ ...tilt, trigger: { deviceId: dev["node1.btn1"], eventType: "tilt" } }] });
    assert.ok(err(wrongEvent, "eventTypeNotSupported"));
    const ledOnButton = await post("/puzzle/create", t.op, { ...base, ruleList: [{ ...tilt, actionList: [{ type: "solvePuzzle" }, { type: "setLed", deviceId: dev["node1.btn2"], state: "on" }] }] });
    assert.ok(err(ledOnButton, "deviceTypeMismatch"));
    const cannotSolve = await post("/puzzle/create", t.op, { ...base, ruleList: [{ ...tilt, actionList: [{ type: "setLed", deviceId: dev["node1.led1"], state: "on" }] }] });
    assert.ok(err(cannotSolve, "puzzleCannotBeSolved"));
    const foreign = await post("/puzzle/create", t.op, { ...base, ruleList: [{ ...tilt, trigger: { deviceId: "65a000000000000000000001", eventType: "tilt" } }] });
    assert.equal(foreign.status, 404);
  });

  test("puzzle/create, update a delete zvyšují revizi", async () => {
    const p1 = await post("/puzzle/create", t.op, {
      roomId, name: "Otevři truhlu", description: "nakloň truhlu",
      ruleList: [{
        trigger: { deviceId: dev["node1.acc1"], eventType: "tilt" }, condition: { operator: "gt", value: 45 },
        actionList: [{ type: "solvePuzzle" }, { type: "setLed", deviceId: dev["node1.led1"], state: "on" }],
      }],
    });
    assert.equal(p1.status, 200);
    assert.equal(p1.body.order, 1);
    const p2 = await post("/puzzle/create", t.op, {
      roomId, name: "Zmáčkni tlačítko",
      ruleList: [{ trigger: { deviceId: dev["node1.btn2"], eventType: "press" }, actionList: [{ type: "solvePuzzle" }] }],
    });
    assert.equal(p2.body.order, 2);
    const tmp = await post("/puzzle/create", t.op, {
      roomId, name: "Smazat",
      ruleList: [{ trigger: { deviceId: dev["node1.temp1"], eventType: "temperature" }, condition: { operator: "gte", value: 30 }, actionList: [{ type: "solvePuzzle" }] }],
    });
    const renamed = await post("/puzzle/update", t.op, { id: p2.body.id, name: "Zmáčkni modré tlačítko" });
    assert.equal(renamed.body.name, "Zmáčkni modré tlačítko");
    assert.equal((await post("/puzzle/delete", t.op, { id: tmp.body.id })).status, 200);

    const s = await get("/scenario/get", t.op, { roomId });
    assert.equal(s.body.puzzleList.length, 2);
    assert.equal(s.body.revision, 7); // 2 + 3× create + update + delete
    const config = await get("/gateway/getConfig", gwToken);
    assert.equal(config.body.scenario.revision, 7); // gateway dostane stejná pravidla
    assert.equal(config.body.scenario.puzzleList[0].ruleList[0].condition.value, 45);
  });
});

describe("řízení hry", () => {
  let puzzles;
  before(async () => { puzzles = (await get("/scenario/get", t.op, { roomId })).body.puzzleList; });

  test("bez hry: getCurrent vrátí null, start hlásí gameDoesNotExist", async () => {
    const current = await get("/game/getCurrent", t.gm, { roomId });
    assert.equal(current.body.game, null);
    const start = await post("/game/start", t.gm, { roomId });
    assert.equal(start.status, 404);
    assert.ok(err(start, "gameDoesNotExist"));
  });

  test("reset → start → pauza → pokračování, povely pro gateway", async () => {
    await takeCommands();
    const reset = await post("/game/reset", t.gm, { roomId });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.state, "ready");
    assert.equal(reset.body.puzzleStateList.length, 2);
    assert.equal(reset.body.remainingSec, 45 * 60);
    assert.deepEqual((await takeCommands()).map((c) => c.type), ["resetRoom"]);

    await heartbeat(); // gateway online
    const start = await post("/game/start", t.gm, { roomId });
    assert.equal(start.body.state, "running");
    const [startCmd] = await takeCommands();
    assert.equal(startCmd.type, "startGame");
    assert.equal(startCmd.payload.timeLimitMin, 45);

    const blocked = await post("/puzzle/create", t.op, { roomId, name: "X", ruleList: [{ trigger: { deviceId: dev["node1.btn1"], eventType: "press" }, actionList: [{ type: "solvePuzzle" }] }] });
    assert.ok(err(blocked, "gameInProgress")); // změny scénáře během hry zakázané

    assert.ok(err(await post("/game/resume", t.gm, { roomId }), "invalidGameState"));
    const paused = await post("/game/pause", t.gm, { roomId });
    assert.equal(paused.body.state, "paused");
    await Game.updateOne({ _id: paused.body.id }, { pausedAt: new Date(Date.now() - 30000) }); // pauza 30 s
    const resumed = await post("/game/resume", t.gm, { roomId });
    assert.equal(resumed.body.state, "running");
    assert.ok(resumed.body.pausedDurationSec >= 30);
    assert.deepEqual((await takeCommands()).map((c) => c.type), ["pauseGame", "resumeGame"]);
  });

  test("ruční vyřešení a vrácení hádanky", async () => {
    const p2 = puzzles[1].id;
    const solved = await post("/game/solvePuzzle", t.gm, { roomId, puzzleId: p2 });
    const item = solved.body.puzzleStateList.find((p) => p.puzzleId === p2);
    assert.equal(item.state, "solved");
    assert.equal(item.solvedBy, "user");
    assert.ok(err(await post("/game/solvePuzzle", t.gm, { roomId, puzzleId: p2 }), "puzzleAlreadySolved"));
    const undone = await post("/game/unsolvePuzzle", t.gm, { roomId, puzzleId: p2 });
    assert.equal(undone.body.puzzleStateList.find((p) => p.puzzleId === p2).state, "unsolved");
    assert.ok(err(await post("/game/unsolvePuzzle", t.gm, { roomId, puzzleId: p2 }), "puzzleNotSolved"));
    assert.equal((await post("/game/solvePuzzle", t.gm, { roomId, puzzleId: "65a000000000000000000001" })).status, 404);
    const commands = await takeCommands();
    assert.deepEqual(commands.map((c) => c.type), ["solvePuzzle", "unsolvePuzzle"]);
    assert.equal(commands[0].payload.runActions, true);
  });

  test("hádanku vyřeší gateway, poslední ručně → hra dokončena; živý přehled", async () => {
    const current = (await get("/game/getCurrent", t.gm, { roomId })).body;
    const since = current.eventList.at(-1).createdAt;
    const res = await post("/gateway/sendEvents", gwToken, {
      eventList: [
        { gatewayEventId: crypto.randomUUID(), occurredAt: new Date().toISOString(), type: "hintRequested", gameId: current.game.id, deviceId: dev["node1.btn1"] },
        { gatewayEventId: crypto.randomUUID(), occurredAt: new Date().toISOString(), type: "puzzleSolved", gameId: current.game.id, puzzleId: puzzles[0].id, deviceId: dev["node1.acc1"] },
      ],
    });
    assert.equal(res.body.acceptedCount, 2);

    const live = (await get("/game/getCurrent", t.gm, { roomId, eventsSince: since })).body;
    assert.equal(live.game.puzzleStateList[0].solvedBy, "gateway");
    assert.equal(live.game.hintCount, 1);
    assert.ok(live.alertList.some((a) => a.type === "hintRequested"));
    assert.deepEqual(live.eventList.map((e) => e.type), ["hintRequested", "puzzleSolved"]); // jen nové události
    assert.equal(live.eventList[0].deviceName, "node1.btn1");

    const done = await post("/game/solvePuzzle", t.gm, { roomId, puzzleId: puzzles[1].id, runActions: false });
    assert.equal(done.body.state, "completed");
    assert.ok(done.body.endedAt);
    assert.equal((await takeCommands()).at(-1).payload.runActions, false);
  });

  test("nová hra po dokončení, ukončení s důvodem", async () => {
    const reset = await post("/game/reset", t.op, { roomId });
    assert.equal(reset.body.state, "ready");
    assert.ok(reset.body.puzzleStateList.every((p) => p.state === "unsolved"));
    await heartbeat();
    await post("/game/start", t.op, { roomId });
    assert.ok(err(await post("/game/reset", t.op, { roomId }), "invalidGameState")); // běžící hru nejdřív ukončit
    const stopped = await post("/game/stop", t.op, { roomId, reason: "hráči odešli" });
    assert.equal(stopped.body.state, "terminated");
    const event = await Event.findOne({ type: "gameTerminated" }).lean();
    assert.deepEqual(event.value, { reason: "hráči odešli" });
    const cmds = await takeCommands();
    assert.deepEqual(cmds.at(-1).payload.state, "terminated");
  });

  test("vypršení času: hra expired, povel stopGame, upozornění timeExpired", async () => {
    await post("/game/reset", t.op, { roomId });
    await heartbeat();
    const started = await post("/game/start", t.op, { roomId });
    await takeCommands();
    await Game.updateOne({ _id: started.body.id }, { startedAt: new Date(Date.now() - 46 * 60000) }); // limit 45 min
    assert.equal(await expireGames(), 1);
    const live = (await get("/game/getCurrent", t.gm, { roomId })).body;
    assert.equal(live.game.state, "expired");
    assert.equal(live.game.remainingSec, 0);
    assert.ok(live.alertList.some((a) => a.type === "timeExpired"));
    const [cmd] = await takeCommands();
    assert.deepEqual({ type: cmd.type, state: cmd.payload.state }, { type: "stopGame", state: "expired" });
  });

  test("změna scénáře po resetu: start hlásí scenarioChanged, nový reset to vyřeší", async () => {
    await post("/game/reset", t.op, { roomId });
    await post("/puzzle/update", t.op, { id: puzzles[0].id, description: "upraveno" }); // hra je ready → změna povolená
    await heartbeat();
    const start = await post("/game/start", t.op, { roomId });
    assert.ok(err(start, "scenarioChanged"));
    const reset = await post("/game/reset", t.op, { roomId });
    assert.equal(reset.body.scenarioRevision, (await get("/scenario/get", t.op, { roomId })).body.revision);
    assert.equal((await post("/game/start", t.op, { roomId })).body.state, "running");
    await post("/game/stop", t.op, { roomId });
  });

  test("start s offline gateway: chyba gatewayOffline", async () => {
    await post("/game/reset", t.op, { roomId });
    await Gateway.updateOne({ roomId }, { lastSeenAt: new Date(Date.now() - 5 * 60000) });
    const start = await post("/game/start", t.op, { roomId });
    assert.equal(start.status, 409);
    assert.ok(err(start, "gatewayOffline"));
    const reset = await post("/game/reset", t.op, { roomId }); // reset jde, povel počká ve frontě
    assert.ok(reset.body.uuAppErrorMap["escape-room-iot/game/reset/gatewayOffline"]);
  });
});

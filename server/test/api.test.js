// Testy API proti dočasné MongoDB v paměti (replica set kvůli transakcím). Spuštění: npm test
process.env.NODE_ENV = "test"; // vypne omezení četnosti pokusů

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import request from "supertest";
import bcrypt from "bcryptjs";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { connectDb, disconnectDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { venueDao, userDao } from "../src/dao/index.js";
import { Room, Game, GatewayCommand, Event, Measurement, Device, Scenario } from "../src/models/index.js";

const PASSWORD = "test-heslo-123";
let replSet;
let app;
const tokens = {};

const err = (res, code) => Object.keys(res.body.uuAppErrorMap).find((k) => k.endsWith(`/${code}`));
const post = (path, token, body) => request(app).post(path).set("Authorization", `Bearer ${token}`).send(body);
const get = (path, token, query) => request(app).get(path).set("Authorization", `Bearer ${token}`).query(query ?? {});

// Dokončené pětiminutové UTC okno před 10 minutami
function lastWindow() {
  const end = Math.floor((Date.now() - 10 * 60 * 1000) / 300000) * 300000;
  return { windowStart: new Date(end - 300000).toISOString(), windowEnd: new Date(end).toISOString() };
}

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await connectDb(replSet.getUri("escape-room-iot-test"));
  app = createApp();

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const venue = await venueDao.create("Testovací provozovna");
  const otherVenue = await venueDao.create("Cizí provozovna");
  await userDao.create({ venueId: venue._id, email: "op@test.local", name: "Op", role: "operator", passwordHash });
  await userDao.create({ venueId: venue._id, email: "gm@test.local", name: "GM", role: "gameMaster", passwordHash });
  await userDao.create({ venueId: otherVenue._id, email: "other@test.local", name: "Other", role: "operator", passwordHash });

  for (const [key, email] of [["op", "op@test.local"], ["gm", "gm@test.local"], ["other", "other@test.local"]]) {
    const res = await request(app).post("/user/login").send({ email, password: PASSWORD });
    assert.equal(res.status, 200);
    tokens[key] = res.body.token;
  }
});

after(async () => {
  await disconnectDb();
  await replSet.stop();
});

describe("základ", () => {
  test("health", async () => {
    const res = await request(app).get("/health");
    assert.equal(res.body.status, "ok");
  });

  test("špatné heslo i neexistující e-mail vrací stejnou chybu", async () => {
    const a = await request(app).post("/user/login").send({ email: "op@test.local", password: "spatne" });
    const b = await request(app).post("/user/login").send({ email: "nikdo@test.local", password: "spatne" });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.ok(err(a, "invalidCredentials") && err(b, "invalidCredentials"));
  });

  test("bez tokenu 401, game master nesmí zakládat místnost (403)", async () => {
    const noToken = await request(app).post("/room/create").send({ name: "X" });
    assert.equal(noToken.status, 401);
    assert.ok(err(noToken, "userNotAuthenticated"));
    const gm = await post("/room/create", tokens.gm, { name: "X" });
    assert.equal(gm.status, 403);
    assert.ok(err(gm, "userNotAuthorized"));
  });

  test("neexistující command 404", async () => {
    const res = await get("/room/neexistuje", tokens.op);
    assert.equal(res.status, 404);
  });
});

describe("místnosti", () => {
  let roomId;

  test("room/create: založí místnost i scénář, nepodporované klíče jako varování", async () => {
    const res = await post("/room/create", tokens.op, { name: "Pirátská kajuta", timeLimitMin: 45, foo: 1 });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, "Pirátská kajuta");
    assert.equal(res.body.gateway, null);
    assert.deepEqual(res.body.uuAppErrorMap["escape-room-iot/room/create/unsupportedKeys"].paramMap.unsupportedKeyList, ["$.foo"]);
    roomId = res.body.id;
    const scenario = await Scenario.findOne({ roomId }).lean();
    assert.equal(scenario.timeLimitMin, 45);
    assert.equal(scenario.revision, 1);
  });

  test("room/create: neplatný dtoIn 400, duplicitní název 409", async () => {
    const invalid = await post("/room/create", tokens.op, { name: "", timeLimitMin: 1 });
    assert.equal(invalid.status, 400);
    const map = invalid.body.uuAppErrorMap["escape-room-iot/room/create/invalidDtoIn"].paramMap.invalidValueKeyMap;
    assert.ok(map["$.name"] && map["$.timeLimitMin"]);
    const dup = await post("/room/create", tokens.op, { name: "Pirátská kajuta" });
    assert.equal(dup.status, 409);
    assert.ok(err(dup, "roomNameAlreadyExists"));
  });

  test("room/get a room/list: game master čte, cizí provozovna nevidí (404)", async () => {
    await post("/room/create", tokens.op, { name: "Alchymistova laboratoř" });
    const got = await get("/room/get", tokens.gm, { id: roomId });
    assert.equal(got.status, 200);
    assert.deepEqual(got.body.deviceSummary, { total: 0, online: 0, offline: 0 });
    const foreign = await get("/room/get", tokens.other, { id: roomId });
    assert.equal(foreign.status, 404);
    assert.ok(err(foreign, "roomDoesNotExist"));

    const list = await get("/room/list", tokens.gm, { "pageInfo[pageSize]": "1", "pageInfo[pageIndex]": "0" });
    assert.equal(list.status, 200);
    assert.equal(list.body.itemList.length, 1);
    assert.equal(list.body.itemList[0].name, "Alchymistova laboratoř"); // řazeno podle názvu
    assert.deepEqual(list.body.pageInfo, { pageIndex: 0, pageSize: 1, total: 2 });
    const otherList = await get("/room/list", tokens.other);
    assert.equal(otherList.body.pageInfo.total, 0);
  });

  test("room/update", async () => {
    const res = await post("/room/update", tokens.op, { id: roomId, description: "Truhla s pokladem" });
    assert.equal(res.status, 200);
    assert.equal(res.body.description, "Truhla s pokladem");
    const dup = await post("/room/update", tokens.op, { id: roomId, name: "Alchymistova laboratoř" });
    assert.equal(dup.status, 409);
  });
});

describe("gateway a data", () => {
  let roomId;
  let gatewayId;
  let gwToken;
  const devices = {};

  before(async () => {
    const res = await post("/room/create", tokens.op, { name: "Místnost s gateway" });
    roomId = res.body.id;
  });

  test("gateway/create a register: kód platí jednou, druhá gateway do místnosti nejde", async () => {
    const created = await post("/gateway/create", tokens.op, { roomId, name: "RPi test" });
    assert.equal(created.status, 200);
    assert.equal(created.body.state, "pending");
    gatewayId = created.body.id;
    const code = created.body.registrationCode;
    assert.ok(code.length >= 22);

    const second = await post("/gateway/create", tokens.op, { roomId, name: "Druhá" });
    assert.equal(second.status, 409);
    assert.ok(err(second, "roomHasGateway"));

    const wrong = await request(app).post("/gateway/register").send({ registrationCode: "spatny-kod" });
    assert.equal(wrong.status, 401);

    const reg = await request(app).post("/gateway/register").send({ registrationCode: code });
    assert.equal(reg.status, 200);
    assert.equal(reg.body.state, "active");
    assert.equal(reg.body.gatewayId, gatewayId);
    gwToken = reg.body.accessToken;

    const again = await request(app).post("/gateway/register").send({ registrationCode: code });
    assert.equal(again.status, 401);
    assert.ok(err(again, "invalidRegistrationCode"));
  });

  test("token gateway nesmí volat command webu a token uživatele command gateway (403)", async () => {
    assert.equal((await get("/room/list", gwToken)).status, 403);
    assert.equal((await get("/gateway/getConfig", tokens.op)).status, 403);
  });

  test("gateway/heartbeat: založí zařízení z hello nodu a vrátí jejich id", async () => {
    const deviceList = [
      ["node1.btn1", "button"], ["node1.btn2", "button"], ["node1.btn3", "button"], ["node1.acc1", "accelerometer"],
      ["node1.temp1", "thermometer"], ["node1.led1", "led"], ["node1.led2", "led"],
    ].map(([hwId, type]) => ({ hwId, type }));
    const res = await post("/gateway/heartbeat", gwToken, { scenarioRevision: 0, deviceList });
    assert.equal(res.status, 200);
    assert.equal(res.body.deviceList.length, 7);
    assert.equal(res.body.configChanged, true); // gateway má revizi 0, scénář 1
    assert.equal(res.body.scenarioRevision, 1);
    for (const d of res.body.deviceList) devices[d.hwId] = d.id;

    const synced = await post("/gateway/heartbeat", gwToken, { scenarioRevision: 1, deviceList });
    assert.equal(synced.body.configChanged, false);
    assert.equal(await Device.countDocuments({ roomId }), 7); // opakovaný heartbeat nic nezdvojí
  });

  test("gateway/heartbeat: duplicitní hwId a jiný typ odmítne", async () => {
    const dup = await post("/gateway/heartbeat", gwToken, { scenarioRevision: 1, deviceList: [{ hwId: "a", type: "led" }, { hwId: "a", type: "led" }] });
    assert.equal(dup.status, 400);
    assert.ok(err(dup, "duplicateHwId"));
    const mismatch = await post("/gateway/heartbeat", gwToken, { scenarioRevision: 1, deviceList: [{ hwId: "node1.btn1", type: "led" }] });
    assert.equal(mismatch.status, 400);
    assert.ok(err(mismatch, "deviceTypeMismatch"));
  });

  test("room/get a device/list ukazují gateway a zařízení online", async () => {
    const room = await get("/room/get", tokens.op, { id: roomId });
    assert.equal(room.body.gateway.online, true);
    assert.deepEqual(room.body.deviceSummary, { total: 7, online: 7, offline: 0 });
    const list = await get("/device/list", tokens.gm, { roomId });
    assert.equal(list.body.itemList.length, 7);
    assert.ok(list.body.itemList.every((d) => d.online));
  });

  test("device/update: pojmenování a kolize názvu", async () => {
    const res = await post("/device/update", tokens.op, { id: devices["node1.acc1"], name: "Víko truhly" });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, "Víko truhly");
    assert.equal(res.body.hwId, "node1.acc1");
    const clash = await post("/device/update", tokens.op, { id: devices["node1.btn1"], name: "Víko truhly" });
    assert.equal(clash.status, 409);
    const gm = await post("/device/update", tokens.gm, { id: devices["node1.btn1"], name: "X" });
    assert.equal(gm.status, 403);
  });

  test("gateway/getConfig: zařízení, scénář a intervaly", async () => {
    const res = await get("/gateway/getConfig", gwToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.roomId, roomId);
    assert.equal(res.body.deviceList.length, 7);
    assert.equal(res.body.scenario.revision, 1);
    assert.deepEqual(res.body.downsampling, { sampleIntervalSec: 10, windowSec: 300, aggregation: "median" });
    assert.equal(res.body.currentGame, null);
  });

  test("gateway/sendMeasurements: uložení, duplicita, konflikt a neplatná okna", async () => {
    const m = { deviceId: devices["node1.temp1"], value: 23, sampleCount: 30, ...lastWindow() };
    const first = await post("/gateway/sendMeasurements", gwToken, { measurementList: [m] });
    assert.equal(first.status, 200);
    assert.equal(first.body.acceptedCount, 1);

    const repeat = await post("/gateway/sendMeasurements", gwToken, { measurementList: [m] });
    assert.equal(repeat.body.acceptedCount, 0);
    assert.equal(repeat.body.duplicateCount, 1);
    assert.equal(await Measurement.countDocuments({ deviceId: m.deviceId }), 1);

    const conflict = await post("/gateway/sendMeasurements", gwToken, { measurementList: [{ ...m, value: 30 }] });
    assert.equal(conflict.status, 409);
    assert.ok(err(conflict, "measurementConflict"));

    const unaligned = await post("/gateway/sendMeasurements", gwToken, {
      measurementList: [{ ...m, windowStart: new Date(Date.parse(m.windowStart) + 1000).toISOString() }],
    });
    assert.equal(unaligned.status, 400);
    assert.ok(err(unaligned, "invalidMeasurementWindow"));

    const notThermometer = await post("/gateway/sendMeasurements", gwToken, { measurementList: [{ ...m, deviceId: devices["node1.btn1"] }] });
    assert.equal(notThermometer.status, 400);
    assert.ok(err(notThermometer, "deviceTypeMismatch"));

    const tooMany = await post("/gateway/sendMeasurements", gwToken, { measurementList: Array(101).fill(m) });
    assert.equal(tooMany.status, 400);
    assert.ok(err(tooMany, "invalidDtoIn"));

    const thermometer = await Device.findById(m.deviceId).lean();
    assert.equal(thermometer.lastValue.value, 23);
  });

  test("gateway/sendEvents: událost zařízení, duplicita, konflikt a neplatné kombinace", async () => {
    const ev = {
      gatewayEventId: crypto.randomUUID(), occurredAt: new Date().toISOString(),
      type: "deviceEvent", deviceId: devices["node1.acc1"], value: { event: "tilt", value: 52 },
    };
    const first = await post("/gateway/sendEvents", gwToken, { eventList: [ev] });
    assert.equal(first.status, 200);
    assert.equal(first.body.acceptedCount, 1);

    const repeat = await post("/gateway/sendEvents", gwToken, { eventList: [ev, ev] });
    assert.equal(repeat.body.acceptedCount, 0);
    assert.equal(repeat.body.duplicateCount, 2);

    const conflict = await post("/gateway/sendEvents", gwToken, { eventList: [{ ...ev, value: { event: "tilt", value: 10 } }] });
    assert.equal(conflict.status, 409);
    assert.ok(err(conflict, "eventIdConflict"));

    const noValue = await post("/gateway/sendEvents", gwToken, { eventList: [{ ...ev, gatewayEventId: crypto.randomUUID(), value: { event: "tilt" } }] });
    assert.equal(noValue.status, 400);
    assert.ok(err(noValue, "invalidEvent"));

    const wrongDevice = await post("/gateway/sendEvents", gwToken, {
      eventList: [{ ...ev, gatewayEventId: crypto.randomUUID(), deviceId: devices["node1.temp1"], value: { event: "press" } }],
    });
    assert.equal(wrongDevice.status, 400);
    assert.ok(err(wrongDevice, "eventTypeNotSupported"));

    const future = await post("/gateway/sendEvents", gwToken, {
      eventList: [{ ...ev, gatewayEventId: crypto.randomUUID(), occurredAt: new Date(Date.now() + 5 * 60000).toISOString() }],
    });
    assert.equal(future.status, 400);

    const device = await Device.findById(devices["node1.acc1"]).lean();
    assert.deepEqual({ event: device.lastValue.event, value: device.lastValue.value }, { event: "tilt", value: 52 });
  });

  test("gateway/sendEvents: nápověda a vyřešení hádanky mění hru právě jednou", async () => {
    const puzzleId = "65a000000000000000000001";
    const game = await Game.create({
      venueId: (await Room.findById(roomId)).venueId, roomId, scenarioRevision: 1, state: "running", timeLimitMin: 60,
      startedAt: new Date(), puzzleStateList: [{ puzzleId, name: "Truhla", state: "unsolved" }],
    });
    await Room.updateOne({ _id: roomId }, { currentGameId: game._id });
    const gameId = String(game._id);

    const hint = { gatewayEventId: crypto.randomUUID(), occurredAt: new Date().toISOString(), type: "hintRequested", gameId, deviceId: devices["node1.btn1"] };
    await post("/gateway/sendEvents", gwToken, { eventList: [hint] });
    await post("/gateway/sendEvents", gwToken, { eventList: [hint] }); // opakované odeslání
    assert.equal((await Game.findById(gameId)).hintCount, 1);

    const solved = { gatewayEventId: crypto.randomUUID(), occurredAt: new Date().toISOString(), type: "puzzleSolved", gameId, puzzleId };
    const res = await post("/gateway/sendEvents", gwToken, { eventList: [solved] });
    assert.equal(res.status, 200);
    const finished = await Game.findById(gameId).lean();
    assert.equal(finished.puzzleStateList[0].state, "solved");
    assert.equal(finished.puzzleStateList[0].solvedBy, "gateway");
    assert.equal(finished.state, "completed"); // poslední hádanka ukončí hru

    const late = await post("/gateway/sendEvents", gwToken, { eventList: [{ ...hint, gatewayEventId: crypto.randomUUID() }] });
    assert.equal(late.status, 200);
    assert.ok(late.body.uuAppErrorMap["escape-room-iot/gateway/sendEvents/lateEvent"]);
    assert.equal((await Game.findById(gameId)).hintCount, 1);
    assert.equal(await Event.countDocuments({ roomId, type: "hintRequested" }), 2);

    const unknownPuzzle = await post("/gateway/sendEvents", gwToken, {
      eventList: [{ ...solved, gatewayEventId: crypto.randomUUID(), puzzleId: "65a000000000000000000099" }],
    });
    assert.equal(unknownPuzzle.status, 404);
  });

  test("gateway/getCommands a ackCommands: povel zůstává, dokud ho gateway nepotvrdí", async () => {
    const room = await Room.findById(roomId);
    const cmd = await GatewayCommand.create({ venueId: room.venueId, gatewayId, type: "resetRoom", payload: { scenarioRevision: 1 } });

    const listed = await get("/gateway/getCommands", gwToken);
    assert.equal(listed.headers["cache-control"], "no-store");
    assert.equal(listed.body.itemList.length, 1);
    assert.equal((await get("/gateway/getCommands", gwToken)).body.itemList.length, 1); // vyzvednutí stav nemění

    const hb = await post("/gateway/heartbeat", gwToken, { scenarioRevision: 1, deviceList: [] });
    assert.equal(hb.body.pendingCommandCount, 1);

    const ack = await post("/gateway/ackCommands", gwToken, { commandIdList: [String(cmd._id)] });
    assert.deepEqual(ack.body.acknowledgedCommandIdList, [String(cmd._id)]);
    const deliveredAt = (await GatewayCommand.findById(cmd._id)).deliveredAt;
    assert.ok(deliveredAt);
    assert.equal((await get("/gateway/getCommands", gwToken)).body.itemList.length, 0);

    const again = await post("/gateway/ackCommands", gwToken, { commandIdList: [String(cmd._id)] });
    assert.equal(again.status, 200);
    assert.equal((await GatewayCommand.findById(cmd._id)).deliveredAt.getTime(), deliveredAt.getTime());

    const unknown = await post("/gateway/ackCommands", gwToken, { commandIdList: ["65a000000000000000000077"] });
    assert.equal(unknown.status, 404);
    assert.ok(err(unknown, "gatewayCommandDoesNotExist"));
  });

  test("room/delete s gateway 409; po gateway/delete platí starý token 401 a místnost jde smazat", async () => {
    const blocked = await post("/room/delete", tokens.op, { id: roomId });
    assert.equal(blocked.status, 409);
    assert.ok(err(blocked, "roomHasGateway"));

    const deleted = await post("/gateway/delete", tokens.op, { id: gatewayId });
    assert.equal(deleted.status, 200);
    const oldToken = await get("/gateway/getConfig", gwToken);
    assert.equal(oldToken.status, 401);

    const room = await get("/room/get", tokens.op, { id: roomId });
    assert.equal(room.body.gateway, null);
    assert.equal(room.body.deviceSummary.online, 0); // bez gateway jsou zařízení offline

    const res = await post("/room/delete", tokens.op, { id: roomId });
    assert.equal(res.status, 200);
    assert.equal(await Device.countDocuments({ roomId }), 0);
    assert.equal(await Measurement.countDocuments({ roomId }), 0);
    assert.equal((await get("/room/get", tokens.op, { id: roomId })).status, 404);
  });
});

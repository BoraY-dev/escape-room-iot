// Commandy pro gateway (command-list-gateway.md): registrace, konfigurace, heartbeat, dávky dat, povely.
import mongoose from "mongoose";
import { config } from "../config.js";
import { PUBLIC, sha256, randomSecret } from "../auth.js";
import { AppError, Errors } from "../errors.js";
import {
  isDuplicateKey, roomDao, scenarioDao, puzzleDao, gameDao, deviceDao, gatewayDao, eventDao, measurementDao, gatewayCommandDao,
} from "../dao/index.js";
import { DEVICE_TYPES } from "../models/index.js";
import { shape, string, integer, number, id, uuid, datetime, oneOf, array } from "../validation.js";
import { createRateLimiter, iso, sid } from "./common.js";

const OPERATORS = ["Operators"];
const GATEWAYS = ["Gateways"];

const gameInProgress = () => new AppError("gameInProgress", 409, "A game is running or paused in the room.");

// ---------------------------------------------------------------------------
// Pomocné převody na dtoOut
// ---------------------------------------------------------------------------

const puzzleDto = (p) => ({
  id: sid(p._id),
  name: p.name,
  description: p.description ?? "",
  order: p.order,
  ruleList: (p.ruleList ?? []).map((r) => ({
    trigger: { deviceId: sid(r.trigger?.deviceId), eventType: r.trigger?.eventType },
    condition: r.condition ?? null,
    actionList: (r.actionList ?? []).map((a) => ({ type: a.type, deviceId: sid(a.deviceId), state: a.state })),
  })),
});

const gameDto = (g) => (g ? {
  id: sid(g._id),
  roomId: sid(g.roomId),
  state: g.state,
  scenarioRevision: g.scenarioRevision,
  timeLimitMin: g.timeLimitMin,
  startedAt: iso(g.startedAt),
  pausedAt: iso(g.pausedAt),
  endedAt: iso(g.endedAt),
  pausedDurationSec: g.pausedDurationSec ?? 0,
  hintCount: g.hintCount ?? 0,
  puzzleStateList: (g.puzzleStateList ?? []).map((p) => ({
    puzzleId: sid(p.puzzleId), name: p.name, state: p.state, solvedAt: iso(p.solvedAt), solvedBy: p.solvedBy ?? null,
  })),
} : null);

// ---------------------------------------------------------------------------
// gateway/sendEvents – validace a porovnání obsahu
// ---------------------------------------------------------------------------

// Které události smí hlásit který typ zařízení
const DEVICE_EVENTS = { button: ["press"], accelerometer: ["tilt", "move"] };

const invalidEvent = (index, reason) => new AppError("invalidEvent", 400, "Event is not valid.", { index, reason });

// Kanonická podoba obsahu – stejné UUID s jiným obsahem je konflikt, ne duplicita
function eventContent(e) {
  return JSON.stringify({
    occurredAt: new Date(e.occurredAt).toISOString(),
    type: e.type,
    gameId: sid(e.gameId),
    deviceId: sid(e.deviceId),
    puzzleId: sid(e.puzzleId),
    value: e.value ? { event: e.value.event ?? null, value: e.value.value ?? null } : null,
  });
}

// Kontrola povinných a nepříslušných polí podle typu (krok 1 v Command Listu)
function checkEventShape(e, index, maxTime) {
  if (e.occurredAt.getTime() > maxTime) throw invalidEvent(index, "occurredAt is in the future");
  if (e.type === "deviceEvent") {
    if (!e.deviceId || !e.value?.event) throw invalidEvent(index, "deviceEvent requires deviceId and value.event");
    if (e.puzzleId) throw invalidEvent(index, "deviceEvent must not contain puzzleId");
    if (e.value.event === "tilt") {
      if (e.value.value === undefined || e.value.value < 0 || e.value.value > 180) throw invalidEvent(index, "tilt requires value 0–180");
    } else if (e.value.value !== undefined) {
      throw invalidEvent(index, `${e.value.event} must not contain value.value`);
    }
  } else if (e.type === "puzzleSolved") {
    if (!e.gameId || !e.puzzleId) throw invalidEvent(index, "puzzleSolved requires gameId and puzzleId");
    if (e.value) throw invalidEvent(index, "puzzleSolved must not contain value");
  } else if (e.type === "hintRequested") {
    if (!e.gameId || !e.deviceId) throw invalidEvent(index, "hintRequested requires gameId and deviceId");
    if (e.puzzleId || e.value) throw invalidEvent(index, "hintRequested must not contain puzzleId or value");
  }
}

// ---------------------------------------------------------------------------
// gateway/sendMeasurements – okno downsamplingu
// ---------------------------------------------------------------------------

const WINDOW_MS = config.downsampling.windowSec * 1000;
const measurementKey = (m) => `${m.deviceId}|${new Date(m.windowStart).toISOString()}`;
const measurementContent = (m) => JSON.stringify({ value: m.value, sampleCount: m.sampleCount, windowEnd: new Date(m.windowEnd).toISOString() });

function checkWindow(m, index, maxTime) {
  const start = m.windowStart.getTime();
  const end = m.windowEnd.getTime();
  const reason =
    start >= end ? "windowStart must be before windowEnd"
      : end > maxTime ? "window has not ended yet"
        : start % WINDOW_MS !== 0 || end - start !== WINDOW_MS ? `window must be ${config.downsampling.windowSec} s aligned to UTC`
          : null;
  if (reason) throw new AppError("invalidMeasurementWindow", 400, "Measurement window is not valid.", { index, reason });
}

// ---------------------------------------------------------------------------
// Commandy
// ---------------------------------------------------------------------------

export const gatewayCommands = [
  // --- registrace a správa (kap. 2) ---
  {
    name: "gateway/create",
    profiles: OPERATORS,
    dtoInType: shape({ roomId: id().isRequired(), name: string(1, 100).isRequired() }),
    async handler(dtoIn, { session }) {
      const room = await roomDao.get(session.venueId, dtoIn.roomId);
      if (!room) throw Errors.doesNotExist("room", { roomId: dtoIn.roomId });
      const roomHasGateway = () => new AppError("roomHasGateway", 409, "The room already has a gateway.");
      if (await gatewayDao.getByRoom(room._id)) throw roomHasGateway();
      if (await gameDao.hasGameInProgress(room._id)) throw gameInProgress();

      const registrationCode = randomSecret(16); // 128 bitů náhody
      const registrationCodeExpiresAt = new Date(Date.now() + config.registrationCodeTtlMs);
      let gateway;
      try {
        gateway = await gatewayDao.create({
          venueId: session.venueId, roomId: room._id, name: dtoIn.name, state: "pending",
          registrationCodeHash: sha256(registrationCode), registrationCodeExpiresAt,
        });
      } catch (e) {
        if (isDuplicateKey(e)) throw roomHasGateway(); // souběžné založení – chrání unikátní index roomId
        throw e;
      }
      return {
        id: sid(gateway._id), roomId: sid(room._id), name: gateway.name, state: gateway.state,
        registrationCode, // jen v této odpovědi, uložený je pouze hash
        registrationCodeExpiresAt: iso(registrationCodeExpiresAt),
      };
    },
  },
  {
    name: "gateway/register",
    profiles: [PUBLIC],
    middleware: [createRateLimiter("gateway/register", 10)],
    dtoInType: shape({ registrationCode: string(1, 256).isRequired() }),
    async handler(dtoIn) {
      const accessToken = randomSecret(32);
      const gateway = await gatewayDao.activateByCodeHash(sha256(dtoIn.registrationCode), sha256(accessToken), new Date());
      if (!gateway) {
        // neexistující, prošlý i spotřebovaný kód – jednotná odpověď
        throw new AppError("invalidRegistrationCode", 401, "Registration code is invalid, expired or already used.");
      }
      return {
        gatewayId: sid(gateway._id), roomId: sid(gateway.roomId), state: gateway.state,
        accessToken, heartbeatIntervalSec: config.heartbeatIntervalSec,
      };
    },
  },
  {
    name: "gateway/delete",
    profiles: OPERATORS,
    dtoInType: shape({ id: id().isRequired() }),
    async handler(dtoIn, { session }) {
      const gateway = await gatewayDao.get(session.venueId, dtoIn.id);
      if (!gateway) throw Errors.doesNotExist("gateway", { gatewayId: dtoIn.id });
      if (await gameDao.hasGameInProgress(gateway.roomId)) throw gameInProgress();
      // Smazáním zmizí i hash tokenu → další požadavky gateway skončí 401.
      // Zařízení, scénář, měření a historie her zůstávají v místnosti.
      await gatewayDao.delete(session.venueId, gateway._id);
      await gatewayCommandDao.deleteByGateway(gateway._id);
      return {};
    },
  },

  // --- konfigurace a přítomnost (kap. 3) ---
  {
    name: "gateway/getConfig",
    method: "get",
    profiles: GATEWAYS,
    dtoInType: shape({}),
    async handler(dtoIn, { session }) {
      const room = await roomDao.getById(session.roomId);
      if (!room) throw Errors.doesNotExist("room");
      const scenario = await scenarioDao.getByRoom(room._id);
      if (!scenario) throw Errors.doesNotExist("scenario");
      const [devices, puzzles, game] = await Promise.all([
        deviceDao.listByRoom(room._id), puzzleDao.listByRoom(room._id), gameDao.get(room.currentGameId),
      ]);
      return {
        gatewayId: session.gatewayId,
        roomId: sid(room._id),
        serverTime: iso(new Date()),
        heartbeatIntervalSec: config.heartbeatIntervalSec,
        commandPollIntervalSec: config.commandPollIntervalSec,
        batchSize: config.batchSize,
        downsampling: config.downsampling,
        deviceList: devices.map((d) => ({ id: sid(d._id), hwId: d.hwId, type: d.type, name: d.name })),
        scenario: {
          id: sid(scenario._id), revision: scenario.revision, timeLimitMin: scenario.timeLimitMin,
          hintDeviceId: sid(scenario.hintDeviceId), puzzleList: puzzles.map(puzzleDto),
        },
        currentGame: gameDto(game),
      };
    },
  },
  {
    name: "gateway/heartbeat",
    profiles: GATEWAYS,
    dtoInType: shape({
      scenarioRevision: integer(0, null).isRequired(), // 0 = gateway zatím nemá konfiguraci
      deviceList: array(shape({
        hwId: string(1, 30).isRequired(),
        type: oneOf(DEVICE_TYPES).isRequired(),
      }), 0, config.limits.devicesPerRoom).isRequired(),
    }),
    async handler(dtoIn, { session }) {
      const roomId = session.roomId;
      const now = new Date();

      // 1. Validace celého snímku – při chybě se nic nezapíše
      const hwIds = dtoIn.deviceList.map((d) => d.hwId);
      const duplicates = [...new Set(hwIds.filter((h, i) => hwIds.indexOf(h) !== i))];
      if (duplicates.length) throw new AppError("duplicateHwId", 400, "Device list contains duplicate hwId.", { hwIdList: duplicates });

      const existing = await deviceDao.listByRoom(roomId);
      const byHwId = new Map(existing.map((d) => [d.hwId, d]));
      const mismatch = dtoIn.deviceList.filter((d) => byHwId.has(d.hwId) && byHwId.get(d.hwId).type !== d.type);
      if (mismatch.length) {
        throw new AppError("deviceTypeMismatch", 400, "Existing device has a different type.", { hwIdList: mismatch.map((d) => d.hwId) });
      }
      const newDevices = dtoIn.deviceList.filter((d) => !byHwId.has(d.hwId));
      if (existing.length + newDevices.length > config.limits.devicesPerRoom) {
        throw new AppError("deviceLimitExceeded", 409, "New devices would exceed the room device limit.", { limit: config.limits.devicesPerRoom });
      }
      // výchozí název nového zařízení = hwId; jiné zařízení se tak už může jmenovat
      const nameClash = existing.filter((d) => newDevices.some((n) => n.hwId === d.name)).map((d) => d.name);
      if (nameClash.length) {
        throw new AppError("deviceNameAlreadyExists", 409, "Default name of a new device is already used.", { nameList: nameClash });
      }

      // 2. Založení nových zařízení
      if (newDevices.length) {
        const created = await deviceDao.createMany(newDevices.map((d) => ({
          venueId: session.venueId, roomId, hwId: d.hwId, type: d.type, name: d.hwId, lastSeenAt: now,
        })));
        created.forEach((d) => byHwId.set(d.hwId, d));
      }

      // 3. Přítomnost: gateway a právě dostupná zařízení (chybějící se nemažou ani neobnovují)
      // 4. Revize, kterou gateway skutečně uložila
      const [scenario, pendingCommandCount] = await Promise.all([
        scenarioDao.getByRoom(roomId),
        gatewayCommandDao.countPending(session.gatewayId),
        deviceDao.updateLastSeen(roomId, hwIds, now),
        gatewayDao.heartbeat(session.gatewayId, now, dtoIn.scenarioRevision),
      ]);
      const revision = scenario?.revision ?? 0;
      return {
        serverTime: iso(now),
        scenarioRevision: revision,
        configChanged: revision !== dtoIn.scenarioRevision,
        pendingCommandCount,
        deviceList: dtoIn.deviceList.map((d) => ({ hwId: d.hwId, id: sid(byHwId.get(d.hwId)._id) })),
      };
    },
  },

  // --- dávky dat (kap. 4) ---
  {
    name: "gateway/sendEvents",
    profiles: GATEWAYS,
    dtoInType: shape({
      eventList: array(shape({
        gatewayEventId: uuid().isRequired(),
        occurredAt: datetime().isRequired(),
        gameId: id(),
        deviceId: id(),
        puzzleId: id(),
        type: oneOf(["deviceEvent", "puzzleSolved", "hintRequested"]).isRequired(),
        value: shape({ event: oneOf(["press", "tilt", "move"]), value: number() }),
      }), 1, config.batchSize).isRequired(),
    }),
    async handler(dtoIn, { session, warn }) {
      const { roomId, venueId } = session;
      const now = new Date();
      const maxTime = now.getTime() + config.futureToleranceSec * 1000;
      const events = dtoIn.eventList;

      // 1. Tvar událostí a duplicity uvnitř dávky
      const firstById = new Map();
      events.forEach((e, i) => {
        checkEventShape(e, i, maxTime);
        const seen = firstById.get(e.gatewayEventId);
        if (seen && eventContent(seen) !== eventContent(e)) {
          throw new AppError("eventIdConflict", 409, "The same gatewayEventId has different content.", { gatewayEventIdList: [e.gatewayEventId] });
        }
        if (!seen) firstById.set(e.gatewayEventId, e);
      });

      // Odkazy musí být ve vlastní místnosti
      const ids = (key) => [...new Set(events.map((e) => e[key]).filter(Boolean))];
      const [devices, games] = await Promise.all([deviceDao.getManyInRoom(roomId, ids("deviceId")), Promise.all(ids("gameId").map((g) => gameDao.getInRoom(roomId, g)))]);
      const deviceById = new Map(devices.map((d) => [String(d._id), d]));
      const gameById = new Map(games.filter(Boolean).map((g) => [String(g._id), g]));
      events.forEach((e, index) => {
        const device = e.deviceId && deviceById.get(e.deviceId);
        if (e.deviceId && !device) throw Errors.doesNotExist("device", { index, deviceId: e.deviceId });
        if (e.gameId && !gameById.has(e.gameId)) throw Errors.doesNotExist("game", { index, gameId: e.gameId });
        if (e.type === "deviceEvent" && !(DEVICE_EVENTS[device.type] ?? []).includes(e.value.event)) {
          throw new AppError("eventTypeNotSupported", 400, "Device does not support this event.", { index, deviceType: device.type, event: e.value.event });
        }
        if (e.type === "hintRequested" && device.type !== "button") {
          throw new AppError("eventTypeNotSupported", 400, "Hint can be requested only by a button.", { index, deviceType: device.type });
        }
        if (e.type === "puzzleSolved" && !gameById.get(e.gameId).puzzleStateList.some((p) => String(p.puzzleId) === e.puzzleId)) {
          throw Errors.doesNotExist("puzzle", { index, puzzleId: e.puzzleId });
        }
      });

      // Už uložené události: shodný obsah = duplicita, jiný = konflikt (nic se nezapíše)
      const stored = await eventDao.listByGatewayEventIds(roomId, [...firstById.keys()]);
      const storedById = new Map(stored.map((s) => [s.gatewayEventId, s]));
      const conflicts = [...firstById.values()].filter((e) => storedById.has(e.gatewayEventId) && eventContent(storedById.get(e.gatewayEventId)) !== eventContent(e));
      if (conflicts.length) {
        throw new AppError("eventIdConflict", 409, "The same gatewayEventId has different content.", { gatewayEventIdList: conflicts.map((e) => e.gatewayEventId) });
      }

      // 2.–4. Uložení v pořadí pole; nová událost a její efekt na hru v jedné transakci
      const accepted = [];
      const duplicate = [];
      const late = [];
      for (const e of events) {
        if (storedById.has(e.gatewayEventId) || accepted.includes(e.gatewayEventId)) {
          duplicate.push(e.gatewayEventId);
          continue;
        }
        const doc = {
          venueId, roomId, gatewayEventId: e.gatewayEventId, type: e.type, source: "gateway", occurredAt: e.occurredAt,
          ...(e.gameId && { gameId: e.gameId }), ...(e.deviceId && { deviceId: e.deviceId }), ...(e.puzzleId && { puzzleId: e.puzzleId }),
          ...(e.value && { value: { event: e.value.event, ...(e.value.value !== undefined && { value: e.value.value }) } }),
        };
        let isLate = false;
        try {
          await mongoose.connection.transaction(async (tx) => {
            isLate = false;
            await eventDao.create(doc, tx);
            if (e.type !== "puzzleSolved" && e.type !== "hintRequested") return;
            const room = await roomDao.getById(roomId, tx);
            const game = gameById.get(e.gameId);
            const current = room?.currentGameId && String(room.currentGameId) === e.gameId;
            if (!current) { isLate = true; return; } // uloží se, ale hru nemění
            if (e.type === "hintRequested") {
              const r = await gameDao.incrementHintCount(game._id, tx);
              if (!r.modifiedCount) isLate = true;
            } else {
              const updated = await gameDao.solvePuzzle(game._id, e.puzzleId, e.occurredAt, tx);
              if (!updated) { isLate = true; return; }
              if (updated.puzzleStateList.every((p) => p.state === "solved")) await gameDao.complete(game._id, e.occurredAt, tx);
            }
          });
        } catch (err) {
          if (!isDuplicateKey(err)) throw err;
          // souběžný požadavek stejnou událost právě uložil → ověřit, že jde o duplicitu
          const [again] = await eventDao.listByGatewayEventIds(roomId, [e.gatewayEventId]);
          if (!again || eventContent(again) !== eventContent(e)) {
            throw new AppError("eventIdConflict", 409, "The same gatewayEventId has different content.", { gatewayEventIdList: [e.gatewayEventId] });
          }
          duplicate.push(e.gatewayEventId);
          continue;
        }
        accepted.push(e.gatewayEventId);
        if (isLate) late.push(e.gatewayEventId);

        // 5. Zařízení: lastSeenAt jen dopředu a ne do budoucnosti, lastValue jen novější událostí
        if (e.deviceId) {
          await deviceDao.advanceLastSeen(e.deviceId, new Date(Math.min(e.occurredAt.getTime(), now.getTime())));
          if (e.type === "deviceEvent") {
            await deviceDao.setLastValueIfNewer(e.deviceId, { event: e.value.event, value: e.value.value ?? null, occurredAt: e.occurredAt });
          }
        }
      }

      if (late.length) warn("lateEvent", "Events were stored without changing the game.", { gatewayEventIdList: late });
      return { acceptedCount: accepted.length, duplicateCount: duplicate.length, acceptedEventIdList: accepted, duplicateEventIdList: duplicate };
    },
  },
  {
    name: "gateway/sendMeasurements",
    profiles: GATEWAYS,
    dtoInType: shape({
      measurementList: array(shape({
        deviceId: id().isRequired(),
        value: number().isRequired(),
        sampleCount: integer(1, null).isRequired(),
        windowStart: datetime().isRequired(),
        windowEnd: datetime().isRequired(),
      }), 1, config.batchSize).isRequired(),
    }),
    async handler(dtoIn, { session }) {
      const { roomId, venueId } = session;
      const maxTime = Date.now() + config.futureToleranceSec * 1000;
      const list = dtoIn.measurementList;

      // Validace celé dávky – při chybě se nezapíše nic
      list.forEach((m, i) => checkWindow(m, i, maxTime));
      const devices = await deviceDao.getManyInRoom(roomId, [...new Set(list.map((m) => m.deviceId))]);
      const deviceById = new Map(devices.map((d) => [String(d._id), d]));
      list.forEach((m, index) => {
        const device = deviceById.get(m.deviceId);
        if (!device) throw Errors.doesNotExist("device", { index, deviceId: m.deviceId });
        if (device.type !== "thermometer") throw new AppError("deviceTypeMismatch", 400, "Device is not a thermometer.", { index, deviceId: m.deviceId });
      });

      // Duplicity v dávce a v databázi (klíč deviceId + windowStart)
      const conflict = (m) => new AppError("measurementConflict", 409, "The same measurement window has different content.",
        { deviceId: m.deviceId, windowStart: iso(m.windowStart) });
      const firstByKey = new Map();
      for (const m of list) {
        const seen = firstByKey.get(measurementKey(m));
        if (seen && measurementContent(seen) !== measurementContent(m)) throw conflict(m);
        if (!seen) firstByKey.set(measurementKey(m), m);
      }
      const classify = async () => {
        const stored = await measurementDao.listByKeys([...firstByKey.values()]);
        const storedByKey = new Map(stored.map((s) => [measurementKey({ deviceId: String(s.deviceId), windowStart: s.windowStart }), s]));
        for (const m of firstByKey.values()) {
          const s = storedByKey.get(measurementKey(m));
          if (s && measurementContent(s) !== measurementContent(m)) throw conflict(m);
        }
        return storedByKey;
      };
      let storedByKey = await classify();

      const toInsert = [...firstByKey.values()].filter((m) => !storedByKey.has(measurementKey(m)));
      if (toInsert.length) {
        try {
          await measurementDao.insertMany(toInsert.map((m) => ({ venueId, roomId, ...m })));
        } catch (e) {
          const onlyDuplicates = isDuplicateKey(e) || (e.writeErrors ?? []).every((w) => (w.code ?? w.err?.code) === 11000);
          if (!onlyDuplicates) throw e;
          storedByKey = await classify(); // souběžné uložení stejného okna → znovu porovnat
        }
      }
      const insertedKeys = new Set(toInsert.map(measurementKey));
      const accepted = [];
      const duplicate = [];
      for (const m of list) {
        const entry = { deviceId: m.deviceId, windowStart: iso(m.windowStart) };
        const key = measurementKey(m);
        if (insertedKeys.has(key) && !accepted.some((a) => `${a.deviceId}|${a.windowStart}` === key)) accepted.push(entry);
        else duplicate.push(entry);
      }

      // lastValue teploměru novějším oknem; lastSeenAt se měřením neposouvá (historická data nejsou důkaz přítomnosti)
      for (const m of firstByKey.values()) {
        await deviceDao.setLastValueIfNewer(m.deviceId, { event: "temperature", value: m.value, occurredAt: m.windowEnd });
      }
      return { acceptedCount: accepted.length, duplicateCount: duplicate.length, acceptedMeasurementList: accepted, duplicateMeasurementList: duplicate };
    },
  },

  // --- povely (kap. 5) ---
  {
    name: "gateway/getCommands",
    method: "get",
    profiles: GATEWAYS,
    noStore: true,
    dtoInType: shape({ limit: integer(1, 100) }),
    async handler(dtoIn, { session }) {
      const limit = dtoIn.limit ?? 100;
      const items = await gatewayCommandDao.listPending(session.gatewayId, limit + 1);
      return {
        itemList: items.slice(0, limit).map((c) => ({ id: sid(c._id), type: c.type, payload: c.payload ?? {}, createdAt: iso(c.createdAt) })),
        hasMore: items.length > limit,
      };
    },
  },
  {
    name: "gateway/ackCommands",
    profiles: GATEWAYS,
    dtoInType: shape({ commandIdList: array(id(), 1, 100).isRequired() }),
    async handler(dtoIn, { session }) {
      const ids = [...new Set(dtoIn.commandIdList)];
      const found = await gatewayCommandDao.getManyByIds(session.gatewayId, ids);
      const missing = ids.filter((i) => !found.some((c) => String(c._id) === i));
      if (missing.length) throw Errors.doesNotExist("gatewayCommand", { commandIdList: missing }); // nepotvrdí nic
      await gatewayCommandDao.markDelivered(session.gatewayId, ids, new Date()); // už doručené se nemění
      return { acknowledgedCommandIdList: ids };
    },
  },
];

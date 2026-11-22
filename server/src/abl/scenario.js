// Scénář a hádanky (command-list-webapp.md, kap. 5): scenario/get, scenario/update, puzzle/create, update, delete.
// Každá změna zvýší scenario.revision → gateway si v heartbeatu všimne a stáhne nová pravidla.
import mongoose from "mongoose";
import { AppError, Errors } from "../errors.js";
import { roomDao, scenarioDao, puzzleDao, gameDao, deviceDao } from "../dao/index.js";
import { shape, string, integer, number, id, oneOf, array } from "../validation.js";
import { scenarioDto, puzzleDto } from "./common.js";

const OPERATORS = ["Operators"];
const WEB_USERS = ["Operators", "GameMasters"];
const PUZZLE_LIMIT = 50;

// Které události podporuje který vstupní typ zařízení (katalog typů, kap. 2)
const INPUT_EVENTS = { button: ["press"], accelerometer: ["tilt", "move"], thermometer: ["temperature"] };
const EVENTS_WITH_CONDITION = ["tilt", "temperature"];

const ruleType = shape({
  trigger: shape({
    deviceId: id().isRequired(),
    eventType: oneOf(["press", "tilt", "move", "temperature"]).isRequired(),
  }).isRequired(),
  condition: shape({                         // povinná u "tilt" a "temperature", jinde zakázaná
    operator: oneOf(["gt", "gte", "lt", "lte"]).isRequired(),
    value: number().isRequired(),
  }),
  actionList: array(shape({
    type: oneOf(["solvePuzzle", "setLed"]).isRequired(),
    deviceId: id(),                          // povinné u setLed
    state: oneOf(["on", "off", "blink"]),    // povinné u setLed
  }), 1, 5).isRequired(),
});

const gameInProgress = () => new AppError("gameInProgress", 409, "A game is running or paused in the room; changes are not allowed.");

async function loadRoom(session, roomId) {
  const room = await roomDao.get(session.venueId, roomId);
  if (!room) throw Errors.doesNotExist("room", { roomId });
  return room;
}

async function ensureNoGameInProgress(roomId) {
  if (await gameDao.hasGameInProgress(roomId)) throw gameInProgress();
}

// Validace pravidel (společná pro puzzle/create a puzzle/update)
async function validateRules(roomId, ruleList) {
  const ids = new Set();
  for (const r of ruleList) {
    ids.add(r.trigger.deviceId);
    for (const a of r.actionList) if (a.deviceId) ids.add(a.deviceId);
  }
  const devices = await deviceDao.getManyInRoom(roomId, [...ids]);
  const byId = new Map(devices.map((d) => [String(d._id), d]));

  ruleList.forEach((r, ruleIndex) => {
    // 1. všechna zařízení jsou ze stejné místnosti
    for (const deviceId of [r.trigger.deviceId, ...r.actionList.map((a) => a.deviceId).filter(Boolean)]) {
      if (!byId.has(deviceId)) throw Errors.doesNotExist("device", { ruleIndex, deviceId });
    }
    // 2. spouštěcí zařízení je vstup a podporuje událost
    const trigger = byId.get(r.trigger.deviceId);
    if (!(INPUT_EVENTS[trigger.type] ?? []).includes(r.trigger.eventType)) {
      throw new AppError("eventTypeNotSupported", 400, "Trigger device does not support this event.",
        { ruleIndex, deviceType: trigger.type, eventType: r.trigger.eventType });
    }
    // 3. podmínka právě u tilt a temperature
    const needsCondition = EVENTS_WITH_CONDITION.includes(r.trigger.eventType);
    if (needsCondition !== Boolean(r.condition)) {
      throw new AppError("invalidCondition", 400, needsCondition ? "Condition is required for this event." : "Condition is not allowed for this event.",
        { ruleIndex, eventType: r.trigger.eventType });
    }
    // 4. setLed míří na LED a má stav
    r.actionList.forEach((a, actionIndex) => {
      if (a.type !== "setLed") return;
      if (!a.deviceId || !a.state || byId.get(a.deviceId)?.type !== "led") {
        throw new AppError("deviceTypeMismatch", 400, "setLed action requires a led device and a state.", { ruleIndex, actionIndex });
      }
    });
  });
  // 5. hádanka musí jít vyřešit
  if (!ruleList.some((r) => r.actionList.some((a) => a.type === "solvePuzzle"))) {
    throw new AppError("puzzleCannotBeSolved", 400, "At least one rule must contain the solvePuzzle action.");
  }
}

// Uloží se jen podporované atributy (podmínka a deviceId akce jen tam, kde dávají smysl)
const toStoredRules = (ruleList) => ruleList.map((r) => ({
  trigger: { deviceId: r.trigger.deviceId, eventType: r.trigger.eventType },
  ...(r.condition && { condition: { operator: r.condition.operator, value: r.condition.value } }),
  actionList: r.actionList.map((a) => (a.type === "setLed" ? { type: a.type, deviceId: a.deviceId, state: a.state } : { type: a.type })),
}));

export const scenarioCommands = [
  {
    name: "scenario/get",
    method: "get",
    profiles: WEB_USERS,
    dtoInType: shape({ roomId: id().isRequired() }),
    async handler(dtoIn, { session }) {
      const room = await loadRoom(session, dtoIn.roomId);
      const scenario = await scenarioDao.getByRoom(room._id);
      if (!scenario) throw Errors.doesNotExist("scenario", { roomId: dtoIn.roomId });
      return scenarioDto(scenario, await puzzleDao.listByRoom(room._id));
    },
  },
  {
    name: "scenario/update",
    profiles: OPERATORS,
    dtoInType: shape({ roomId: id().isRequired(), timeLimitMin: integer(5, 240), hintDeviceId: id() }),
    async handler(dtoIn, { session }) {
      const room = await loadRoom(session, dtoIn.roomId);
      await ensureNoGameInProgress(room._id);
      const set = {};
      if (dtoIn.timeLimitMin !== undefined) set.timeLimitMin = dtoIn.timeLimitMin;
      if (dtoIn.hintDeviceId !== undefined) {
        const [device] = await deviceDao.getManyInRoom(room._id, [dtoIn.hintDeviceId]);
        if (!device) throw Errors.doesNotExist("device", { deviceId: dtoIn.hintDeviceId });
        if (device.type !== "button") throw new AppError("deviceTypeMismatch", 400, "Hint device must be a button.", { deviceId: dtoIn.hintDeviceId });
        set.hintDeviceId = device._id;
      }
      const scenario = await scenarioDao.update(room._id, set);
      if (!scenario) throw Errors.doesNotExist("scenario", { roomId: dtoIn.roomId });
      return scenarioDto(scenario, await puzzleDao.listByRoom(room._id));
    },
  },
  {
    name: "puzzle/create",
    profiles: OPERATORS,
    dtoInType: shape({
      roomId: id().isRequired(),
      name: string(1, 100).isRequired(),
      description: string(0, 2000),
      order: integer(1, 50),
      ruleList: array(ruleType, 1, 10).isRequired(),
    }),
    async handler(dtoIn, { session }) {
      const room = await loadRoom(session, dtoIn.roomId);
      await ensureNoGameInProgress(room._id);
      if ((await puzzleDao.countByRoom(room._id)) >= PUZZLE_LIMIT) {
        throw new AppError("puzzleLimitExceeded", 409, "The scenario has the maximum number of puzzles.", { limit: PUZZLE_LIMIT });
      }
      await validateRules(room._id, dtoIn.ruleList);
      const order = dtoIn.order ?? Math.min(PUZZLE_LIMIT, (await puzzleDao.maxOrder(room._id)) + 1);
      let puzzle;
      await mongoose.connection.transaction(async (tx) => {
        puzzle = await puzzleDao.create({
          venueId: session.venueId, roomId: room._id, name: dtoIn.name, description: dtoIn.description ?? "",
          order, ruleList: toStoredRules(dtoIn.ruleList),
        }, tx);
        await scenarioDao.incrementRevision(room._id, tx);
      });
      return puzzleDto(puzzle);
    },
  },
  {
    name: "puzzle/update",
    profiles: OPERATORS,
    dtoInType: shape({
      id: id().isRequired(),
      name: string(1, 100),
      description: string(0, 2000),
      order: integer(1, 50),
      ruleList: array(ruleType, 1, 10),        // nahradí celý seznam pravidel
    }),
    async handler(dtoIn, { session }) {
      const puzzle = await puzzleDao.get(session.venueId, dtoIn.id);
      if (!puzzle) throw Errors.doesNotExist("puzzle", { puzzleId: dtoIn.id });
      await ensureNoGameInProgress(puzzle.roomId);
      if (dtoIn.ruleList) await validateRules(puzzle.roomId, dtoIn.ruleList);
      const set = {};
      for (const key of ["name", "description", "order"]) if (dtoIn[key] !== undefined) set[key] = dtoIn[key];
      if (dtoIn.ruleList) set.ruleList = toStoredRules(dtoIn.ruleList);
      let updated;
      await mongoose.connection.transaction(async (tx) => {
        updated = await puzzleDao.update(puzzle._id, set, tx);
        await scenarioDao.incrementRevision(puzzle.roomId, tx);
      });
      return puzzleDto(updated);
    },
  },
  {
    name: "puzzle/delete",
    profiles: OPERATORS,
    dtoInType: shape({ id: id().isRequired() }),
    async handler(dtoIn, { session }) {
      const puzzle = await puzzleDao.get(session.venueId, dtoIn.id);
      if (!puzzle) throw Errors.doesNotExist("puzzle", { puzzleId: dtoIn.id });
      await ensureNoGameInProgress(puzzle.roomId);
      // odehrané hry si drží vlastní kopii názvů hádanek (puzzleStateList), historie zůstane čitelná
      await mongoose.connection.transaction(async (tx) => {
        await puzzleDao.delete(puzzle._id, tx);
        await scenarioDao.incrementRevision(puzzle.roomId, tx);
      });
      return {};
    },
  },
];

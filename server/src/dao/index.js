// DAO – jediná vrstva, která mluví s databází (persistence-layer.md, DAO Method List).
// Metody volané z webové aplikace dostávají venueId, takže cizí provozovna se „tváří“, jako by data neexistovala.
import mongoose from "mongoose";
import {
  Venue, User, Gateway, Room, Device, Scenario, Puzzle, Game, Event, Measurement, GatewayCommand, ACTIVE_GAME_STATES,
} from "../models/index.js";

export const isDuplicateKey = (e) => e?.code === 11000;
const oid = (v) => new mongoose.Types.ObjectId(String(v));

export const venueDao = {
  create: (name) => Venue.create({ name }),
  get: (id) => Venue.findById(id).lean(),
};

export const userDao = {
  create: (user) => User.create(user),
  getByEmail: (email) => User.findOne({ email: String(email).toLowerCase().trim() }).lean(),
};

export const roomDao = {
  create: (room) => Room.create(room),
  get: (venueId, id) => Room.findOne({ _id: id, venueId }).lean(),
  // pro gateway: místnost je daná tokenem, ne vstupem
  getById: (id, session) => Room.findById(id).session(session ?? null).lean(),
  list: (venueId, pageIndex, pageSize) =>
    Room.find({ venueId }).sort({ name: 1, _id: 1 }).skip(pageIndex * pageSize).limit(pageSize).lean(),
  count: (venueId) => Room.countDocuments({ venueId }),
  existsByName: (venueId, name, exceptId) =>
    Room.exists({ venueId, name, ...(exceptId && { _id: { $ne: exceptId } }) }),
  update: (venueId, id, set) => Room.findOneAndUpdate({ _id: id, venueId }, { $set: set }, { returnDocument: "after" }).lean(),
  delete: (venueId, id) => Room.deleteOne({ _id: id, venueId }),
};

export const scenarioDao = {
  create: (scenario) => Scenario.create(scenario),
  getByRoom: (roomId) => Scenario.findOne({ roomId }).lean(),
  deleteByRoom: (roomId) => Scenario.deleteMany({ roomId }),
};

export const puzzleDao = {
  listByRoom: (roomId) => Puzzle.find({ roomId }).sort({ order: 1, _id: 1 }).lean(),
  deleteByRoom: (roomId) => Puzzle.deleteMany({ roomId }),
};

export const gameDao = {
  get: (id) => (id ? Game.findById(id).lean() : null),
  getInRoom: (roomId, id) => Game.findOne({ _id: id, roomId }).lean(),
  getManyByIds: (ids) => (ids.length ? Game.find({ _id: { $in: ids } }).lean() : []),
  hasGameInProgress: (roomId) => Game.exists({ roomId, state: { $in: ["running", "paused"] } }),
  // Efekt události na hru – jen pokud je hra stále rozehraná (podmíněný zápis, souběh nic nepřepíše).
  // session = transakce, ve které se zároveň ukládá událost (eventDao.create)
  solvePuzzle: (gameId, puzzleId, solvedAt, session) => Game.findOneAndUpdate(
    { _id: gameId, state: { $in: ["running", "paused"] }, puzzleStateList: { $elemMatch: { puzzleId: oid(puzzleId), state: "unsolved" } } },
    { $set: { "puzzleStateList.$.state": "solved", "puzzleStateList.$.solvedAt": solvedAt, "puzzleStateList.$.solvedBy": "gateway" } },
    { returnDocument: "after", session },
  ).lean(),
  complete: (gameId, endedAt, session) =>
    Game.findOneAndUpdate({ _id: gameId, state: { $in: ["running", "paused"] } }, { $set: { state: "completed", endedAt } }, { returnDocument: "after", session }).lean(),
  incrementHintCount: (gameId, session) =>
    Game.updateOne({ _id: gameId, state: { $in: ["running", "paused"] } }, { $inc: { hintCount: 1 } }, { session }),
  deleteByRoom: (roomId) => Game.deleteMany({ roomId }),
  ACTIVE_GAME_STATES,
};

export const deviceDao = {
  get: (venueId, id) => Device.findOne({ _id: id, venueId }).lean(),
  listByRoom: (roomId) => Device.find({ roomId }).sort({ name: 1, _id: 1 }).lean(),
  listByRooms: (roomIds) => Device.find({ roomId: { $in: roomIds } }, { roomId: 1, lastSeenAt: 1 }).lean(),
  countByRoom: (roomId) => Device.countDocuments({ roomId }),
  getManyInRoom: (roomId, ids) => (ids.length ? Device.find({ roomId, _id: { $in: ids } }).lean() : []),
  existsByName: (roomId, name, exceptId) =>
    Device.exists({ roomId, name, ...(exceptId && { _id: { $ne: exceptId } }) }),
  existsByNames: (roomId, names) => Device.find({ roomId, name: { $in: names } }, { name: 1 }).lean(),
  createMany: (devices) => Device.insertMany(devices, { ordered: true }),
  updateName: (venueId, id, name) => Device.findOneAndUpdate({ _id: id, venueId }, { $set: { name } }, { returnDocument: "after" }).lean(),
  updateLastSeen: (roomId, hwIds, at) => Device.updateMany({ roomId, hwId: { $in: hwIds } }, { $set: { lastSeenAt: at } }),
  // lastSeenAt se posune jen dopředu, lastValue jen novější hodnotou
  advanceLastSeen: (id, at) => Device.updateOne({ _id: id, $or: [{ lastSeenAt: { $exists: false } }, { lastSeenAt: null }, { lastSeenAt: { $lt: at } }] }, { $set: { lastSeenAt: at } }),
  setLastValueIfNewer: (id, lastValue) => Device.updateOne(
    { _id: id, $or: [{ lastValue: { $exists: false } }, { lastValue: null }, { "lastValue.occurredAt": { $lt: lastValue.occurredAt } }] },
    { $set: { lastValue } },
  ),
  deleteByRoom: (roomId) => Device.deleteMany({ roomId }),
};

export const gatewayDao = {
  create: (gateway) => Gateway.create(gateway),
  get: (venueId, id) => Gateway.findOne({ _id: id, venueId }).lean(),
  getByRoom: (roomId) => Gateway.findOne({ roomId }).lean(),
  getByRooms: (roomIds) => Gateway.find({ roomId: { $in: roomIds } }).lean(),
  getByTokenHash: (tokenHash) => Gateway.findOne({ tokenHash, state: "active" }).lean(),
  // Atomická spotřeba registračního kódu: ze dvou souběžných registrací uspěje jen jedna
  activateByCodeHash: (codeHash, tokenHash, now) => Gateway.findOneAndUpdate(
    { registrationCodeHash: codeHash, state: "pending", registrationCodeExpiresAt: { $gt: now } },
    { $set: { state: "active", tokenHash, lastSeenAt: now }, $unset: { registrationCodeHash: 1, registrationCodeExpiresAt: 1 } },
    { returnDocument: "after" },
  ).lean(),
  heartbeat: (id, at, syncedScenarioRevision) =>
    Gateway.updateOne({ _id: id, state: "active" }, { $set: { lastSeenAt: at, syncedScenarioRevision } }),
  delete: (venueId, id) => Gateway.deleteOne({ _id: id, venueId }),
};

export const eventDao = {
  listByGatewayEventIds: (roomId, ids) => Event.find({ roomId, gatewayEventId: { $in: ids } }).lean(),
  create: async (event, session) => (await Event.create([event], { session }))[0],
  deleteByRoom: (roomId) => Event.deleteMany({ roomId }),
};

export const measurementDao = {
  listByKeys: (keys) => (keys.length ? Measurement.find({ $or: keys.map((k) => ({ deviceId: k.deviceId, windowStart: k.windowStart })) }).lean() : []),
  insertMany: (list) => Measurement.insertMany(list, { ordered: false }),
  deleteByRoom: (roomId) => Measurement.deleteMany({ roomId }),
};

export const gatewayCommandDao = {
  create: (command) => GatewayCommand.create(command),
  listPending: (gatewayId, limit) =>
    GatewayCommand.find({ gatewayId, state: "pending" }).sort({ createdAt: 1, _id: 1 }).limit(limit).lean(),
  countPending: (gatewayId) => GatewayCommand.countDocuments({ gatewayId, state: "pending" }),
  getManyByIds: (gatewayId, ids) => GatewayCommand.find({ gatewayId, _id: { $in: ids } }).lean(),
  markDelivered: (gatewayId, ids, at) =>
    GatewayCommand.updateMany({ gatewayId, _id: { $in: ids }, state: "pending" }, { $set: { state: "delivered", deliveredAt: at } }),
  deleteByGateway: (gatewayId) => GatewayCommand.deleteMany({ gatewayId }),
};

// Mongoose schémata podle docs/03-application-model/persistence-layer.md.
// Každý dokument má _id (v API "id"), createdAt a updatedAt (timestamps).
import mongoose from "mongoose";

const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;
const opts = { timestamps: true };
const DAY_SEC = 24 * 60 * 60;

export const DEVICE_TYPES = ["button", "accelerometer", "thermometer", "led"];
export const GAME_STATES = ["ready", "running", "paused", "completed", "expired", "terminated"];
export const ACTIVE_GAME_STATES = ["ready", "running", "paused"];
export const EVENT_TYPES = [
  "deviceEvent", "puzzleSolved", "hintRequested", "roomReset", "gameStarted", "gamePaused", "gameResumed",
  "gameCompleted", "gameExpired", "gameTerminated", "puzzleSolvedManually", "puzzleUnsolved",
];
export const COMMAND_TYPES = ["resetRoom", "startGame", "pauseGame", "resumeGame", "stopGame", "solvePuzzle", "unsolvePuzzle"];

// --- venue, user ---
const venueSchema = new Schema({ name: { type: String, required: true, maxlength: 100 } }, opts);

const userSchema = new Schema({
  venueId: { type: ObjectId, required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true, maxlength: 100 },
  role: { type: String, required: true, enum: ["operator", "gameMaster"] },
}, opts);
userSchema.index({ email: 1 }, { unique: true });

// --- gateway ---
const gatewaySchema = new Schema({
  venueId: { type: ObjectId, required: true },
  roomId: { type: ObjectId, required: true },
  name: { type: String, required: true, maxlength: 100 },
  state: { type: String, required: true, enum: ["pending", "active", "revoked"] },
  registrationCodeHash: String,
  registrationCodeExpiresAt: Date,
  tokenHash: String,
  lastSeenAt: Date,
  syncedScenarioRevision: Number,
}, opts);
gatewaySchema.index({ roomId: 1 }, { unique: true });              // místnost má nejvýš jednu gateway
gatewaySchema.index({ tokenHash: 1 }, { unique: true, partialFilterExpression: { tokenHash: { $exists: true } } });
gatewaySchema.index({ registrationCodeHash: 1 }, { partialFilterExpression: { registrationCodeHash: { $exists: true } } });

// --- room, device, scenario, puzzle ---
const roomSchema = new Schema({
  venueId: { type: ObjectId, required: true },
  name: { type: String, required: true, maxlength: 100 },
  description: { type: String, default: "", maxlength: 1000 },
  currentGameId: { type: ObjectId, default: null },
}, opts);
roomSchema.index({ venueId: 1, name: 1 }, { unique: true });

const deviceSchema = new Schema({
  venueId: { type: ObjectId, required: true },
  roomId: { type: ObjectId, required: true },
  hwId: { type: String, required: true, maxlength: 30 },
  type: { type: String, required: true, enum: DEVICE_TYPES },
  name: { type: String, required: true, maxlength: 100 },
  lastSeenAt: Date,
  // lastValue.occurredAt: čas vzniku hodnoty – starší (pozdě doručená) hodnota novější nepřepíše
  lastValue: { type: { event: String, value: Number, occurredAt: Date, _id: false }, default: undefined },
}, opts);
deviceSchema.index({ roomId: 1, hwId: 1 }, { unique: true });
deviceSchema.index({ roomId: 1, name: 1 }, { unique: true });

const scenarioSchema = new Schema({
  venueId: { type: ObjectId, required: true },
  roomId: { type: ObjectId, required: true },
  timeLimitMin: { type: Number, required: true, default: 60 },
  hintDeviceId: { type: ObjectId, default: null },
  revision: { type: Number, required: true, default: 1 },
}, opts);
scenarioSchema.index({ roomId: 1 }, { unique: true });

const ruleSchema = new Schema({
  trigger: { deviceId: ObjectId, eventType: String },
  condition: { operator: String, value: Schema.Types.Mixed },
  actionList: [{ type: { type: String }, deviceId: ObjectId, state: String, _id: false }],
}, { _id: false });

const puzzleSchema = new Schema({
  venueId: { type: ObjectId, required: true },
  roomId: { type: ObjectId, required: true },
  name: { type: String, required: true, maxlength: 100 },
  description: { type: String, default: "", maxlength: 2000 },
  order: { type: Number, required: true },
  ruleList: [ruleSchema],
}, opts);
puzzleSchema.index({ roomId: 1, order: 1 });

// --- game ---
const gameSchema = new Schema({
  venueId: { type: ObjectId, required: true },
  roomId: { type: ObjectId, required: true },
  scenarioRevision: { type: Number, required: true },
  state: { type: String, required: true, enum: GAME_STATES },
  timeLimitMin: { type: Number, required: true },
  startedAt: Date,
  pausedAt: Date,
  endedAt: Date,
  pausedDurationSec: { type: Number, default: 0 },
  hintCount: { type: Number, default: 0 },
  puzzleStateList: [{
    puzzleId: ObjectId,
    name: String,
    state: { type: String, enum: ["unsolved", "solved"] },
    solvedAt: Date,
    solvedBy: { type: String, enum: ["gateway", "user"] },
    _id: false,
  }],
}, opts);
gameSchema.index({ roomId: 1, createdAt: -1 });
gameSchema.index({ state: 1, startedAt: 1 });

// --- event, measurement (90 dní), gatewayCommand (7 dní po doručení) ---
const eventSchema = new Schema({
  venueId: { type: ObjectId, required: true },
  roomId: { type: ObjectId, required: true },
  gameId: ObjectId,
  deviceId: ObjectId,
  puzzleId: ObjectId,
  userId: ObjectId,
  gatewayEventId: String,
  type: { type: String, required: true, enum: EVENT_TYPES },
  value: { type: Schema.Types.Mixed },
  source: { type: String, required: true, enum: ["gateway", "user", "system"] },
  occurredAt: { type: Date, required: true },
}, opts);
eventSchema.index({ roomId: 1, gatewayEventId: 1 }, { unique: true, partialFilterExpression: { gatewayEventId: { $exists: true } } });
eventSchema.index({ gameId: 1, createdAt: 1 });
eventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * DAY_SEC });

const measurementSchema = new Schema({
  venueId: { type: ObjectId, required: true },
  roomId: { type: ObjectId, required: true },
  deviceId: { type: ObjectId, required: true },
  value: { type: Number, required: true },
  sampleCount: { type: Number, required: true },
  windowStart: { type: Date, required: true },
  windowEnd: { type: Date, required: true },
}, opts);
measurementSchema.index({ deviceId: 1, windowStart: 1 }, { unique: true });
measurementSchema.index({ roomId: 1, windowStart: -1 });
measurementSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * DAY_SEC });

const gatewayCommandSchema = new Schema({
  venueId: { type: ObjectId, required: true },
  gatewayId: { type: ObjectId, required: true },
  type: { type: String, required: true, enum: COMMAND_TYPES },
  payload: { type: Schema.Types.Mixed },
  state: { type: String, required: true, enum: ["pending", "delivered"], default: "pending" },
  deliveredAt: Date,
}, opts);
gatewayCommandSchema.index({ gatewayId: 1, state: 1, createdAt: 1 });
gatewayCommandSchema.index({ deliveredAt: 1 }, { expireAfterSeconds: 7 * DAY_SEC });

export const Venue = mongoose.model("Venue", venueSchema, "venue");
export const User = mongoose.model("User", userSchema, "user");
export const Gateway = mongoose.model("Gateway", gatewaySchema, "gateway");
export const Room = mongoose.model("Room", roomSchema, "room");
export const Device = mongoose.model("Device", deviceSchema, "device");
export const Scenario = mongoose.model("Scenario", scenarioSchema, "scenario");
export const Puzzle = mongoose.model("Puzzle", puzzleSchema, "puzzle");
export const Game = mongoose.model("Game", gameSchema, "game");
export const Event = mongoose.model("Event", eventSchema, "event");
export const Measurement = mongoose.model("Measurement", measurementSchema, "measurement");
export const GatewayCommand = mongoose.model("GatewayCommand", gatewayCommandSchema, "gatewayCommand");

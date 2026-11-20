// Testy knihovny gateway (čisté výpočty). Spuštění: cd gateway; npm test
const { test } = require("node:test");
const assert = require("node:assert/strict");
const gw = require("../src/lib/gw.js");

test("parseLine: platné zprávy podle protokolu", () => {
  assert.deepEqual(gw.parseLine('{"t":"ev","id":"node1.btn1","e":"press","seq":42}\r\n').msg.e, "press");
  assert.equal(gw.parseLine('{"t":"m","id":"node1.temp1","v":23,"seq":45}').ok, true);
  assert.equal(gw.parseLine('{"t":"hello","node":"node1","fw":"1.0.0","devices":[{"id":"node1.btn1","type":"button"}]}').ok, true);
  assert.equal(gw.parseLine('{"t":"ack","cid":"17","ok":true,"seq":47}').ok, true);
});

test("parseLine: odmítne neplatné řádky", () => {
  assert.equal(gw.parseLine("").error, "empty");
  assert.equal(gw.parseLine("{nejson").error, "invalidJson");
  assert.equal(gw.parseLine('{"t":"xyz"}').error, "unknownType");
  assert.equal(gw.parseLine('{"t":"ev","id":"node1.acc1","e":"tilt","v":200}').error, "badTilt");
  assert.equal(gw.parseLine('{"t":"hello","node":"n","devices":[{"id":"a","type":"lcd"}]}').error, "badHelloDevice");
  assert.equal(gw.parseLine(`{"t":"m","id":"x","v":1,"pad":"${"a".repeat(600)}"}`).error, "tooLong");
});

test("seqGap: navazující, mezera a přetečení přes 65535", () => {
  assert.equal(gw.seqGap(41, 42), 0);
  assert.equal(gw.seqGap(41, 45), 3);
  assert.equal(gw.seqGap(65535, 0), 0);
  assert.equal(gw.seqGap(65534, 1), 2);
});

test("nodeCommandLine: hlídá limit 128 B", () => {
  assert.equal(gw.nodeCommandLine({ t: "led", cid: "1", id: "node1.led1", s: "on" }), '{"t":"led","cid":"1","id":"node1.led1","s":"on"}');
  assert.equal(gw.nodeCommandLine({ t: "led", cid: "1", id: "x".repeat(130), s: "on" }), null);
});

test("okno a medián teploty", () => {
  const t = Date.parse("2026-11-20T10:07:31Z");
  assert.equal(new Date(gw.windowStartMs(t)).toISOString(), "2026-11-20T10:05:00.000Z");
  assert.equal(gw.median([23, 21, 22]), 22);
  assert.equal(gw.median([20, 22, 21, 23]), 21.5);       // sudý počet: průměr dvou prostředních
  assert.equal(gw.median([22, 22, 22, 40, 22]), 22);      // krátký výkyv medián neovlivní
  assert.equal(gw.median([]), null);
  assert.equal(gw.windowClosed(Date.parse("2026-11-20T10:05:00Z"), Date.parse("2026-11-20T10:10:00Z")), true);
  assert.equal(gw.windowClosed(Date.parse("2026-11-20T10:05:00Z"), Date.parse("2026-11-20T10:09:59Z")), false);
});

test("evaluateRules: náklon nad 45° vyřeší hádanku a rozsvítí LED", () => {
  const puzzles = [{
    id: "p1",
    ruleList: [{
      trigger: { deviceId: "acc", eventType: "tilt" },
      condition: { operator: "gt", value: 45 },
      actionList: [{ type: "solvePuzzle" }, { type: "setLed", deviceId: "led1", state: "on" }],
    }],
  }, {
    id: "p2",
    ruleList: [{ trigger: { deviceId: "btn", eventType: "press" }, actionList: [{ type: "solvePuzzle" }] }],
  }];
  assert.deepEqual(gw.evaluateRules(puzzles, new Set(), "acc", "tilt", 30), { solvedNow: [], ledActions: [] });
  assert.deepEqual(gw.evaluateRules(puzzles, new Set(), "acc", "tilt", 52), {
    solvedNow: ["p1"], ledActions: [{ deviceId: "led1", state: "on" }],
  });
  assert.deepEqual(gw.evaluateRules(puzzles, new Set(["p1"]), "acc", "tilt", 52).solvedNow, []); // už vyřešená
  assert.deepEqual(gw.evaluateRules(puzzles, new Set(), "btn", "press").solvedNow, ["p2"]);
  assert.deepEqual(gw.puzzleLedActions(puzzles[0]), [{ deviceId: "led1", state: "on" }]);
});

test("gameExpired: časový limit včetně pauz", () => {
  const game = { state: "running", startedAt: "2026-11-20T10:00:00Z", timeLimitMin: 60, pausedDurationSec: 600 };
  assert.equal(gw.gameExpired(game, Date.parse("2026-11-20T11:05:00Z")), false);
  assert.equal(gw.gameExpired(game, Date.parse("2026-11-20T11:10:00Z")), true);
  assert.equal(gw.gameExpired({ ...game, state: "paused" }, Date.parse("2026-11-20T12:00:00Z")), false);
});

test("backoffMs: 2, 4, 8 … nejvýš 60 s", () => {
  const noJitter = () => 0;
  assert.deepEqual([1, 2, 3, 4, 6, 10].map((a) => gw.backoffMs(a, noJitter)), [2000, 4000, 8000, 16000, 60000, 60000]);
  assert.ok(gw.backoffMs(1, () => 1) <= 2400);
});

test("classifyResponse: rozhodnutí podle odpovědi cloudu", () => {
  const api = { uuAppErrorMap: {} };
  const apiError = { uuAppErrorMap: { "escape-room-iot/gateway/sendEvents/deviceDoesNotExist": { type: "error" } } };
  assert.equal(gw.classifyResponse(200, api).kind, "ok");
  assert.equal(gw.classifyResponse(0, null).kind, "retry");
  assert.equal(gw.classifyResponse(503, "Service Unavailable").kind, "retry");
  assert.deepEqual(gw.classifyResponse(429, api, { "retry-after": "5" }), { kind: "rateLimited", retryAfterMs: 5000 });
  assert.equal(gw.classifyResponse(401, api).kind, "auth");
  assert.equal(gw.classifyResponse(404, apiError).kind, "dataError");
  assert.equal(gw.classifyResponse(404, "<html>Not Found</html>").kind, "serviceError"); // špatná URL, ne vadná data
});

test("confirmedKeys: potvrzené události i měření", () => {
  const ev = gw.confirmedKeys("event", { acceptedEventIdList: ["a"], duplicateEventIdList: ["b"] });
  assert.deepEqual([...ev], ["a", "b"]);
  const m = gw.confirmedKeys("measurement", { acceptedMeasurementList: [{ deviceId: "d", windowStart: "2026-11-20T10:05:00Z" }] });
  assert.ok(m.has("d|2026-11-20T10:05:00.000Z"));
});

test("lit a transaction: bezpečné SQL literály", () => {
  assert.equal(gw.lit("O'Brien"), "'O''Brien'");
  assert.equal(gw.lit(null), "NULL");
  assert.equal(gw.lit(42), "42");
  assert.equal(gw.lit({ a: "x'y" }), `'{"a":"x''y"}'`);
  assert.throws(() => gw.lit(NaN));
  assert.equal(gw.transaction(["INSERT 1", null, "DELETE 2"]), "BEGIN IMMEDIATE;\nINSERT 1;\nDELETE 2;\nCOMMIT;");
});

test("availableDevices: jen online nody a funkční zařízení", () => {
  const now = 100000;
  const nodes = {
    node1: { lastSeen: now - 3000, devices: [{ id: "node1.btn1", type: "button" }, { id: "node1.temp1", type: "thermometer" }], badDevices: ["node1.temp1"] },
    node2: { lastSeen: now - 20000, devices: [{ id: "node2.btn1", type: "button" }] },
  };
  assert.deepEqual(gw.availableDevices(nodes, now), [{ hwId: "node1.btn1", type: "button" }]);
});

// --- hra a povely ---
const config = {
  scenario: {
    revision: 3, timeLimitMin: 60, hintDeviceId: "btnHint",
    puzzleList: [
      { id: "p1", name: "Truhla", ruleList: [{ trigger: { deviceId: "acc", eventType: "tilt" }, condition: { operator: "gt", value: 45 },
        actionList: [{ type: "solvePuzzle" }, { type: "setLed", deviceId: "led1", state: "on" }] }] },
      { id: "p2", name: "Teplo", ruleList: [{ trigger: { deviceId: "temp", eventType: "temperature" }, condition: { operator: "gte", value: 30 },
        actionList: [{ type: "solvePuzzle" }] }] },
    ],
  },
};
let n = 0;
const uuid = () => `uuid-${++n}`;
const NOW = "2026-11-20T10:00:00.000Z";

test("applyCommand: reset → start → pauza → pokračování", () => {
  const wrongRevision = gw.applyCommand({ config, game: null, command: { type: "resetRoom", payload: { gameId: "g1", scenarioRevision: 2 } }, nowIso: NOW });
  assert.equal(wrongRevision.needConfig, true); // jiná revize: nejdřív stáhnout konfiguraci

  let r = gw.applyCommand({ config, game: null, command: { type: "resetRoom", payload: { gameId: "g1", scenarioRevision: 3 } }, nowIso: NOW });
  assert.equal(r.resetNodes, true);
  assert.equal(r.game.state, "ready");
  assert.equal(r.game.puzzles.length, 2);

  r = gw.applyCommand({ config, game: r.game, command: { type: "startGame", payload: { gameId: "g1", startedAt: NOW, timeLimitMin: 45 } }, nowIso: NOW });
  assert.equal(r.game.state, "running");
  assert.equal(r.game.timeLimitMin, 45);

  r = gw.applyCommand({ config, game: r.game, command: { type: "pauseGame", payload: { gameId: "g1" } }, nowIso: NOW });
  assert.equal(r.game.state, "paused");
  r = gw.applyCommand({ config, game: r.game, command: { type: "resumeGame", payload: { gameId: "g1" } }, nowIso: "2026-11-20T10:02:00.000Z" });
  assert.equal(r.game.state, "running");
  assert.equal(r.game.pausedDurationSec, 120);

  const other = gw.applyCommand({ config, game: r.game, command: { type: "pauseGame", payload: { gameId: "jina" } }, nowIso: NOW });
  assert.equal(other.game.state, "running"); // povel jiné hry stav nemění
});

test("applyCommand: ruční vyřešení s akcemi a vrácení hádanky", () => {
  const game = { ...gw.newGameFromConfig(config, "g1"), state: "running" };
  const solved = gw.applyCommand({ config, game, command: { type: "solvePuzzle", payload: { gameId: "g1", puzzleId: "p1", runActions: true } }, nowIso: NOW });
  assert.equal(solved.game.puzzles[0].state, "solved");
  assert.deepEqual(solved.ledActions, [{ deviceId: "led1", state: "on" }]);
  const undone = gw.applyCommand({ config, game: solved.game, command: { type: "unsolvePuzzle", payload: { gameId: "g1", puzzleId: "p1" } }, nowIso: NOW });
  assert.equal(undone.game.puzzles[0].state, "unsolved");
  assert.equal(game.puzzles[0].state, "unsolved"); // původní objekt se nemění
});

test("applyRules: nápověda, vyřešení a dokončení hry", () => {
  const game = { ...gw.newGameFromConfig(config, "g1"), state: "running" };
  const hint = gw.applyRules({ config, game, deviceId: "btnHint", eventType: "press", nowIso: NOW, uuid });
  assert.equal(hint.items[0].type, "hintRequested");
  assert.equal(hint.gameChanged, false);

  const tilt = gw.applyRules({ config, game, deviceId: "acc", eventType: "tilt", value: 52, nowIso: NOW, uuid });
  assert.equal(tilt.items[0].type, "puzzleSolved");
  assert.equal(tilt.items[0].puzzleId, "p1");
  assert.deepEqual(tilt.ledActions, [{ deviceId: "led1", state: "on" }]);
  assert.equal(tilt.game.state, "running");

  const temp = gw.applyRules({ config, game: tilt.game, deviceId: "temp", eventType: "temperature", value: 31, nowIso: NOW, uuid });
  assert.equal(temp.game.state, "completed"); // poslední hádanka
  const after = gw.applyRules({ config, game: temp.game, deviceId: "acc", eventType: "tilt", value: 90, nowIso: NOW, uuid });
  assert.equal(after.items.length, 0); // hotová hra už pravidla nevyhodnocuje

  const paused = gw.applyRules({ config, game: { ...game, state: "paused" }, deviceId: "acc", eventType: "tilt", value: 90, nowIso: NOW, uuid });
  assert.equal(paused.items.length, 0);
  const oldRevision = gw.applyRules({ config, game: { ...game, scenarioRevision: 2 }, deviceId: "acc", eventType: "tilt", value: 90, nowIso: NOW, uuid });
  assert.equal(oldRevision.items.length, 0); // jiná revize pravidel
});

test("SQL pomocníci: kv a fronta", () => {
  assert.match(gw.kvUpsertSql("config", { a: 1 }, 5), /ON CONFLICT\(key\) DO UPDATE/);
  assert.match(gw.outboxInsertSql("event", "u1", "node1.btn1", { x: "it's" }, "pending", 1), /INSERT OR IGNORE .*'\{"x":"it''s"\}'/);
  assert.equal(gw.classifyResponse("ECONNREFUSED", "Error").kind, "retry");
});

test("commitRuleResult: fronta, stav hry a LED podle hwId", () => {
  const state = { deviceMap: { "node1.acc1": "acc", "node1.led1": "led1" }, leds: {}, game: null };
  const game = { ...gw.newGameFromConfig(config, "g1"), state: "running" };
  const r = gw.applyRules({ config, game, deviceId: "acc", eventType: "tilt", value: 60, nowIso: NOW, uuid });
  const { statements, ledCommands } = gw.commitRuleResult(state, r, 1);
  assert.deepEqual(ledCommands, [{ t: "led", id: "node1.led1", s: "on" }]);
  assert.equal(state.leds["node1.led1"], "on");
  assert.equal(state.game.puzzles[0].state, "solved");
  assert.equal(statements.length, 3); // puzzleSolved do fronty, stav hry, LED
});

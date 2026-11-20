// Knihovna gateway: čisté výpočty bez přístupu k síti a databázi (testy v gateway/test).
// V Node-RED ji uzel „Načtení knihovny“ při startu vloží do globálního kontextu: global.get("gw").
// Návrh: docs/03-application-model/iot-gateway.md a iot-protocol.md.

const gw = (() => {
  // ---------------------------------------------------------------------------
  // Protokol node ↔ gateway (iot-protocol.md)
  // ---------------------------------------------------------------------------
  const MAX_IN_LINE = 512;          // node → gateway
  const MAX_OUT_LINE = 128;         // gateway → node včetně \n
  const NODE_MESSAGE_TYPES = ["hello", "ev", "m", "hb", "ack", "err"];
  const DEVICE_TYPES = ["button", "accelerometer", "thermometer", "led"];
  const NODE_OFFLINE_MS = 15000;    // node bez zprávy 15 s = offline

  // Řádek ze sériové linky → { ok, msg } nebo { ok: false, error }
  function parseLine(raw) {
    if (typeof raw !== "string") raw = String(raw ?? "");
    const line = raw.replace(/\r?\n$/, "").replace(/\r$/, "");
    if (!line.trim()) return { ok: false, error: "empty" };
    if (Buffer.byteLength(line, "utf8") > MAX_IN_LINE) return { ok: false, error: "tooLong" };
    let msg;
    try { msg = JSON.parse(line); } catch { return { ok: false, error: "invalidJson" }; }
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return { ok: false, error: "notObject" };
    if (!NODE_MESSAGE_TYPES.includes(msg.t)) return { ok: false, error: "unknownType" };
    const problem = validateNodeMessage(msg);
    if (problem) return { ok: false, error: problem };
    return { ok: true, msg };
  }

  function validateNodeMessage(m) {
    const isId = (v) => typeof v === "string" && v.length >= 1 && v.length <= 30;
    switch (m.t) {
      case "hello":
        if (typeof m.node !== "string" || !Array.isArray(m.devices)) return "badHello";
        if (!m.devices.every((d) => d && isId(d.id) && DEVICE_TYPES.includes(d.type))) return "badHelloDevice";
        return null;
      case "ev":
        if (!isId(m.id) || !["press", "tilt", "move"].includes(m.e)) return "badEvent";
        if (m.e === "tilt" && !(Number.isFinite(m.v) && m.v >= 0 && m.v <= 180)) return "badTilt";
        return null;
      case "m":
        return isId(m.id) && Number.isFinite(m.v) ? null : "badMeasurement";
      case "hb":
        return typeof m.node === "string" && Number.isFinite(m.up) ? null : "badHeartbeat";
      case "ack":
        return typeof m.cid === "string" && typeof m.ok === "boolean" ? null : "badAck";
      case "err":
        return typeof m.code === "string" ? null : "badError";
      default:
        return "unknownType";
    }
  }

  // Počet ztracených zpráv mezi dvěma seq (modulo 65536); 0 = navazují
  function seqGap(prev, next) {
    if (!Number.isInteger(prev) || !Number.isInteger(next)) return 0;
    return (next - prev - 1 + 65536) % 65536;
  }

  // Povel pro node jako řádek JSON; null, pokud by překročil limit 128 B
  function nodeCommandLine(cmd) {
    const line = JSON.stringify(cmd);
    return Buffer.byteLength(line, "utf8") + 1 <= MAX_OUT_LINE ? line : null;
  }

  const nodeOfHwId = (hwId) => String(hwId).split(".")[0];

  // ---------------------------------------------------------------------------
  // Downsampling teploty: medián za 5min okno UTC (iot-gateway.md kap. 8)
  // ---------------------------------------------------------------------------
  const WINDOW_SEC = 300;

  function windowStartMs(timestampMs, windowSec = WINDOW_SEC) {
    const size = windowSec * 1000;
    return Math.floor(timestampMs / size) * size;
  }

  function median(values) {
    const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // Okno je uzavřené, když už skončilo (konec okna nepatří do okna)
  const windowClosed = (windowStart, nowMs, windowSec = WINDOW_SEC) => windowStart + windowSec * 1000 <= nowMs;

  // ---------------------------------------------------------------------------
  // Pravidla hádanek „když – pak“ (command-list-webapp.md, kap. 5)
  // ---------------------------------------------------------------------------
  function conditionHolds(condition, value) {
    if (!condition) return true; // press, move: bez podmínky
    if (!Number.isFinite(value)) return false;
    switch (condition.operator) {
      case "gt": return value > condition.value;
      case "gte": return value >= condition.value;
      case "lt": return value < condition.value;
      case "lte": return value <= condition.value;
      default: return false;
    }
  }

  // Které nevyřešené hádanky událost řeší a jaké LED akce spouští.
  // puzzles: scenario.puzzleList z konfigurace, solved: Set puzzleId už vyřešených
  function evaluateRules(puzzles, solved, deviceId, eventType, value) {
    const solvedNow = [];
    const ledActions = [];
    for (const puzzle of puzzles ?? []) {
      if (solved.has(puzzle.id)) continue; // vyřešenou hádanku pravidla znovu neřeší
      for (const rule of puzzle.ruleList ?? []) {
        if (rule.trigger?.deviceId !== deviceId || rule.trigger?.eventType !== eventType) continue;
        if (!conditionHolds(rule.condition, value)) continue;
        const actions = rule.actionList ?? [];
        if (actions.some((a) => a.type === "solvePuzzle") && !solvedNow.includes(puzzle.id)) solvedNow.push(puzzle.id);
        for (const a of actions) if (a.type === "setLed" && a.deviceId) ledActions.push({ deviceId: a.deviceId, state: a.state });
        if (solvedNow.includes(puzzle.id)) break;
      }
    }
    return { solvedNow, ledActions };
  }

  // LED akce hádanky (pro solvePuzzle s runActions)
  function puzzleLedActions(puzzle) {
    const out = [];
    for (const rule of puzzle?.ruleList ?? []) {
      if (!(rule.actionList ?? []).some((a) => a.type === "solvePuzzle")) continue;
      for (const a of rule.actionList) if (a.type === "setLed" && a.deviceId) out.push({ deviceId: a.deviceId, state: a.state });
    }
    return out;
  }

  // Vypršel místní časový limit hry?
  function gameExpired(game, nowMs) {
    if (!game || game.state !== "running" || !game.startedAt || !game.timeLimitMin) return false;
    const elapsed = nowMs - Date.parse(game.startedAt) - (game.pausedDurationSec ?? 0) * 1000;
    return elapsed >= game.timeLimitMin * 60000;
  }

  // ---------------------------------------------------------------------------
  // Odesílání do cloudu (iot-gateway.md kap. 7)
  // ---------------------------------------------------------------------------
  const BATCH_SIZE = 100;

  // Odstup dalšího pokusu: 2, 4, 8 … nejvýš 60 s, s náhodným rozptylem do 20 %
  function backoffMs(attempts, random = Math.random) {
    const base = Math.min(60000, 2000 * 2 ** Math.max(0, attempts - 1));
    return Math.round(base * (1 + 0.2 * random()));
  }

  // Vyhodnocení HTTP odpovědi cloudu → co udělat s dávkou
  function classifyResponse(statusCode, body, headers = {}) {
    const isApi = body && typeof body === "object" && body.uuAppErrorMap && typeof body.uuAppErrorMap === "object";
    // http request uzel při síťové chybě dá do statusCode text (např. ECONNREFUSED)
    if (typeof statusCode !== "number" || !statusCode) return { kind: "retry", reason: `network ${statusCode ?? ""}`.trim() };
    if (statusCode >= 200 && statusCode < 300) return isApi ? { kind: "ok" } : { kind: "serviceError", reason: "unexpectedBody" };
    if (statusCode === 429) {
      const seconds = Number(headers["retry-after"]);
      return { kind: "rateLimited", retryAfterMs: Number.isFinite(seconds) ? seconds * 1000 : null };
    }
    if (statusCode >= 500) return { kind: "retry", reason: `http${statusCode}` };
    if (statusCode === 401 || statusCode === 403) return { kind: "auth", reason: `http${statusCode}` };
    if ([400, 404, 409].includes(statusCode) && isApi) {
      return { kind: "dataError", errorCodes: Object.keys(body.uuAppErrorMap).filter((k) => body.uuAppErrorMap[k].type === "error") };
    }
    return { kind: "serviceError", reason: `http${statusCode}` }; // HTML 404, špatná URL…
  }

  // Vlastnosti zprávy pro uzel http request. Token jde jen do hlavičky, nikdy do payloadu ani logu;
  // odpověď uzlu msg.headers přepíše hlavičkami odpovědi, takže token ve zprávě nezůstane.
  function cloudRequest(baseUrl, method, path, body, token) {
    const req = {
      method,
      url: `${String(baseUrl ?? "").replace(/\/+$/, "")}${path}`,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      payload: method === "GET" ? undefined : body ?? {},
      requestTimeout: 15000,
    };
    if (token) req.headers.Authorization = `Bearer ${token}`;
    return req;
  }

  // Které položky dávky cloud potvrdil (accepted i duplicate)
  function confirmedKeys(kind, body) {
    if (kind === "event") return new Set([...(body.acceptedEventIdList ?? []), ...(body.duplicateEventIdList ?? [])]);
    const list = [...(body.acceptedMeasurementList ?? []), ...(body.duplicateMeasurementList ?? [])];
    return new Set(list.map((m) => measurementKey(m.deviceId, m.windowStart)));
  }

  const measurementKey = (deviceId, windowStart) => `${deviceId}|${new Date(windowStart).toISOString()}`;

  // ---------------------------------------------------------------------------
  // SQLite: literály pro dávky v transakci (uzel v režimu batch neumí parametry)
  // ---------------------------------------------------------------------------
  function lit(value) {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error("SQL literal: number must be finite");
      return String(value);
    }
    if (typeof value === "boolean") return value ? "1" : "0";
    if (typeof value === "object") value = JSON.stringify(value);
    return `'${String(value).replace(/'/g, "''")}'`; // SQLite: apostrof se zdvojí, zpětné lomítko nemá význam
  }

  const transaction = (statements) => `BEGIN IMMEDIATE;\n${statements.filter(Boolean).join(";\n")};\nCOMMIT;`;

  const kvUpsertSql = (key, value, nowMs) =>
    `INSERT INTO kv (key, value, updatedAt) VALUES (${lit(key)}, ${lit(JSON.stringify(value))}, ${lit(nowMs)}) ` +
    `ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`;

  // Nová položka fronty; INSERT OR IGNORE – stejný klíč (UUID / okno) se nikdy nevloží dvakrát
  const outboxInsertSql = (kind, itemKey, hwId, payload, state, nowMs) =>
    `INSERT OR IGNORE INTO outbox (kind, itemKey, hwId, payload, state, createdAt) VALUES ` +
    `(${lit(kind)}, ${lit(itemKey)}, ${lit(hwId)}, ${lit(JSON.stringify(payload))}, ${lit(state)}, ${lit(nowMs)})`;

  const sqlList = (values) => values.map(lit).join(", ");

  const SCHEMA = [
    "PRAGMA journal_mode=WAL",
    "PRAGMA synchronous=FULL",
    `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('event','measurement')),
      itemKey TEXT NOT NULL UNIQUE,
      hwId TEXT,
      payload TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('waitingMapping','pending','inFlight','confirmed','quarantined')),
      attempts INTEGER NOT NULL DEFAULT 0,
      nextAttemptAt INTEGER NOT NULL DEFAULT 0,
      lastError TEXT,
      createdAt INTEGER NOT NULL,
      confirmedAt INTEGER)`,
    "CREATE INDEX IF NOT EXISTS outbox_state ON outbox (kind, state, nextAttemptAt, seq)",
    `CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hwId TEXT NOT NULL,
      receivedAt INTEGER NOT NULL,
      value REAL NOT NULL,
      windowStart INTEGER NOT NULL)`,
    "CREATE INDEX IF NOT EXISTS samples_window ON samples (hwId, windowStart)",
    `CREATE TABLE IF NOT EXISTS command_log (
      commandId TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('received','executed','confirmed','failed')),
      receivedAt INTEGER NOT NULL,
      executedAt INTEGER,
      confirmedAt INTEGER,
      lastError TEXT)`,
  ].join(";\n") + ";";

  // ---------------------------------------------------------------------------
  // Registr zařízení → seznam pro gateway/heartbeat
  // ---------------------------------------------------------------------------
  // nodes: { node1: { lastSeen, devices: [{id,type}], badDevices: [hwId] } }
  function availableDevices(nodes, nowMs) {
    const out = [];
    for (const n of Object.values(nodes ?? {})) {
      if (!n.lastSeen || nowMs - n.lastSeen > NODE_OFFLINE_MS) continue;
      const bad = new Set(n.badDevices ?? []);
      for (const d of n.devices ?? []) if (!bad.has(d.id)) out.push({ hwId: d.id, type: d.type });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Stav hry na gateway (iot-gateway.md kap. 5 a 9)
  // game = { gameId, state, scenarioRevision, timeLimitMin, startedAt, pausedAt, pausedDurationSec,
  //          puzzles: [{ puzzleId, name, state, solvedAt }] }
  // ---------------------------------------------------------------------------
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  function newGameFromConfig(config, gameId, revision) {
    const scenario = config?.scenario ?? {};
    return {
      gameId,
      state: "ready",
      scenarioRevision: revision ?? scenario.revision ?? 0,
      timeLimitMin: scenario.timeLimitMin ?? 60,
      startedAt: null,
      pausedAt: null,
      pausedDurationSec: 0,
      puzzles: (scenario.puzzleList ?? []).map((p) => ({ puzzleId: p.id, name: p.name, state: "unsolved", solvedAt: null })),
    };
  }

  // Hra z cloudového snímku (gateway/getConfig → currentGame)
  function gameFromSnapshot(g) {
    if (!g) return null;
    return {
      gameId: g.id, state: g.state, scenarioRevision: g.scenarioRevision, timeLimitMin: g.timeLimitMin,
      startedAt: g.startedAt, pausedAt: g.pausedAt, pausedDurationSec: g.pausedDurationSec ?? 0,
      puzzles: (g.puzzleStateList ?? []).map((p) => ({ puzzleId: p.puzzleId, name: p.name, state: p.state, solvedAt: p.solvedAt })),
    };
  }

  // Vyhodnocení podnětu ze zařízení (událost nebo vzorek teploty) proti pravidlům běžící hry.
  // Vrací položky pro frontu (hintRequested, puzzleSolved), LED akce a případně změněnou hru.
  function applyRules({ config, game, deviceId, eventType, value, nowIso, uuid }) {
    const result = { items: [], ledActions: [], game, gameChanged: false };
    const scenario = config?.scenario;
    // pravidla jen ve stavu running a se správnou revizí konfigurace
    if (!game || game.state !== "running" || !scenario || scenario.revision !== game.scenarioRevision || !deviceId) return result;
    const next = clone(game);

    if (eventType === "press" && scenario.hintDeviceId && scenario.hintDeviceId === deviceId) {
      result.items.push({ type: "hintRequested", gatewayEventId: uuid(), occurredAt: nowIso, gameId: game.gameId, deviceId });
    }
    const solved = new Set(next.puzzles.filter((p) => p.state === "solved").map((p) => p.puzzleId));
    const known = new Set(next.puzzles.map((p) => p.puzzleId));
    const puzzles = (scenario.puzzleList ?? []).filter((p) => known.has(p.id));
    const { solvedNow, ledActions } = evaluateRules(puzzles, solved, deviceId, eventType, value);
    for (const puzzleId of solvedNow) {
      const p = next.puzzles.find((x) => x.puzzleId === puzzleId);
      p.state = "solved";
      p.solvedAt = nowIso;
      result.items.push({ type: "puzzleSolved", gatewayEventId: uuid(), occurredAt: nowIso, gameId: game.gameId, puzzleId, deviceId });
    }
    result.ledActions = ledActions;
    if (solvedNow.length) {
      // poslední vyřešená hádanka zastaví místní vyhodnocování (gameCompleted odvodí cloud)
      if (next.puzzles.length && next.puzzles.every((p) => p.state === "solved")) next.state = "completed";
      result.game = next;
      result.gameChanged = true;
    }
    return result;
  }

  // Provedení cloudového povelu nad místním stavem hry.
  // Vrací { game, ledActions, resetNodes, needConfig }; needConfig = nejdřív stáhnout správnou konfiguraci.
  function applyCommand({ config, game, command, nowIso }) {
    const p = command.payload ?? {};
    const out = { game: clone(game) ?? null, ledActions: [], resetNodes: false, needConfig: false };
    const same = out.game && out.game.gameId === p.gameId;
    switch (command.type) {
      case "resetRoom":
        if (!config || config.scenario?.revision !== p.scenarioRevision) { out.needConfig = true; return out; }
        out.game = newGameFromConfig(config, p.gameId, p.scenarioRevision);
        out.resetNodes = true; // node zhasne všechny LED a vynuluje stav
        return out;
      case "startGame":
        if (!same) out.game = newGameFromConfig(config, p.gameId);
        Object.assign(out.game, { state: "running", startedAt: p.startedAt ?? nowIso, timeLimitMin: p.timeLimitMin ?? out.game.timeLimitMin });
        return out;
      case "pauseGame":
        if (same && out.game.state === "running") Object.assign(out.game, { state: "paused", pausedAt: nowIso });
        return out;
      case "resumeGame":
        if (same && out.game.state === "paused") {
          const paused = out.game.pausedAt ? Math.max(0, Math.round((Date.parse(nowIso) - Date.parse(out.game.pausedAt)) / 1000)) : 0;
          Object.assign(out.game, { state: "running", pausedAt: null, pausedDurationSec: (out.game.pausedDurationSec ?? 0) + paused });
        }
        return out;
      case "stopGame":
        if (same) out.game.state = p.state ?? "terminated";
        return out;
      case "solvePuzzle":
      case "unsolvePuzzle": {
        const puzzle = same && out.game.puzzles.find((x) => x.puzzleId === p.puzzleId);
        if (!puzzle) return out;
        if (command.type === "solvePuzzle") {
          Object.assign(puzzle, { state: "solved", solvedAt: nowIso });
          if (p.runActions) out.ledActions = puzzleLedActions((config?.scenario?.puzzleList ?? []).find((x) => x.id === p.puzzleId));
        } else {
          Object.assign(puzzle, { state: "unsolved", solvedAt: null });
        }
        return out;
      }
      default:
        return out; // neznámý povel se jen potvrdí
    }
  }

  // ---------------------------------------------------------------------------
  // Pomocníci nad sdíleným stavem (global "state")
  // ---------------------------------------------------------------------------
  // Posledních 20 chyb pro dashboard (bez tokenů a registračních kódů)
  function pushError(state, source, message) {
    state.errors.unshift({ at: new Date().toISOString(), source: String(source), message: String(message).slice(0, 200) });
    if (state.errors.length > 20) state.errors.length = 20;
  }

  // LED akce (cloudové deviceId) → povely pro node (hwId); uloží požadovaný stav LED pro obnovu po restartu nodu
  function ledCommandsFor(state, actions, nowMs, statements) {
    const hwIdByDevice = Object.fromEntries(Object.entries(state.deviceMap ?? {}).map(([hwId, id]) => [id, hwId]));
    const commands = [];
    for (const a of actions ?? []) {
      const hwId = hwIdByDevice[a.deviceId];
      if (!hwId) continue;
      state.leds[hwId] = a.state;
      commands.push({ t: "led", id: hwId, s: a.state });
    }
    if (commands.length) statements.push(kvUpsertSql("leds", state.leds, nowMs));
    return commands;
  }

  // Výsledek applyRules → SQL příkazy (fronta, stav hry) a LED povely; mění sdílený stav
  function commitRuleResult(state, result, nowMs) {
    const statements = result.items.map((it) => outboxInsertSql("event", it.gatewayEventId, null, it, "pending", nowMs));
    if (result.gameChanged) {
      state.game = result.game;
      statements.push(kvUpsertSql("game", state.game, nowMs));
    }
    const ledCommands = ledCommandsFor(state, result.ledActions, nowMs, statements);
    return { statements, ledCommands };
  }

  return {
    pushError, ledCommandsFor, commitRuleResult,
    MAX_IN_LINE, MAX_OUT_LINE, NODE_OFFLINE_MS, DEVICE_TYPES, WINDOW_SEC, BATCH_SIZE, SCHEMA,
    parseLine, seqGap, nodeCommandLine, nodeOfHwId,
    windowStartMs, median, windowClosed,
    conditionHolds, evaluateRules, puzzleLedActions, gameExpired,
    backoffMs, classifyResponse, confirmedKeys, measurementKey, cloudRequest,
    lit, transaction, kvUpsertSql, outboxInsertSql, sqlList, availableDevices,
    newGameFromConfig, gameFromSnapshot, applyRules, applyCommand,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = gw;

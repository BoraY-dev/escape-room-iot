// Ovládání hry z příkazové řádky – test celého řetězce před hotovým frontendem.
//
//   $env:API = "https://escape-room-iot-api.onrender.com"; $env:EMAIL = "<e-mail>"; $env:USER_PASSWORD = "<heslo>"
//   node scripts/play.js rooms                                   # místnosti, gateway a zařízení
//   node scripts/play.js demo --room "Testovací místnost"        # ukázkový scénář nad zařízeními místnosti
//   node scripts/play.js reset --room "Testovací místnost"       # také start | pause | resume | stop
//   node scripts/play.js solve --room "…" --puzzle 2            # ruční vyřešení hádanky č. 2
//   node scripts/play.js status --room "Testovací místnost"      # živý přehled (stav, upozornění, události)
import { parseArgs } from "node:util";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { room: { type: "string" }, puzzle: { type: "string" } },
});
const [command] = positionals;
const API = (process.env.API ?? "http://localhost:3000").replace(/\/+$/, "");
let token;

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  const problems = Object.entries(json.uuAppErrorMap ?? {}).map(([k, v]) => `${v.type}: ${k.split("/").pop()} – ${v.message}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}\n  ${problems.join("\n  ")}`);
  for (const p of problems) console.log(`  (${p})`);
  return json;
}

async function findRoom() {
  if (!values.room) throw new Error("chybí --room \"<název místnosti>\"");
  const rooms = (await call("GET", "/room/list?pageInfo[pageSize]=100")).itemList;
  const room = rooms.find((r) => r.name === values.room);
  if (!room) throw new Error(`místnost „${values.room}“ neexistuje (k dispozici: ${rooms.map((r) => r.name).join(", ") || "žádná"})`);
  return room;
}

const time = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

function printGame(g) {
  console.log(`hra ${g.state} · uplynulo ${time(g.elapsedSec)} · zbývá ${time(g.remainingSec)} · nápověd ${g.hintCount}`);
  g.puzzleStateList.forEach((p, i) => console.log(`  ${i + 1}. ${p.name}: ${p.state}${p.solvedBy ? ` (${p.solvedBy})` : ""}`));
}

if (!process.env.EMAIL || !process.env.USER_PASSWORD) {
  console.error("Nastav proměnné prostředí API, EMAIL a USER_PASSWORD (viz komentář v scripts/play.js).");
  process.exit(1);
}
try {
  token = (await call("POST", "/user/login", { email: process.env.EMAIL, password: process.env.USER_PASSWORD })).token;

  if (command === "rooms") {
    for (const r of (await call("GET", "/room/list?pageInfo[pageSize]=100")).itemList) {
      console.log(`${r.name}: gateway ${r.gateway ? `${r.gateway.state}, ${r.gateway.online ? "online" : "offline"}` : "žádná"} · zařízení ${r.deviceSummary.online}/${r.deviceSummary.total} online · hra ${r.currentGameState ?? "–"}`);
      for (const d of (await call("GET", `/device/list?roomId=${r.id}`)).itemList) {
        console.log(`    ${d.hwId.padEnd(12)} ${d.type.padEnd(13)} ${d.online ? "online " : "offline"} ${d.lastValue ? JSON.stringify(d.lastValue) : ""}`);
      }
    }
  } else if (command === "demo") {
    // Ukázkový scénář: zařízení musí v místnosti existovat (vytvoří je heartbeat gateway po registraci)
    const room = await findRoom();
    const devices = (await call("GET", `/device/list?roomId=${room.id}`)).itemList;
    const dev = (hwId) => devices.find((d) => d.hwId === hwId)?.id ?? (() => { throw new Error(`zařízení ${hwId} v místnosti není – je gateway registrovaná a node připojený?`); })();
    const scenario = await call("GET", `/scenario/get?roomId=${room.id}`);
    for (const p of scenario.puzzleList) await call("POST", "/puzzle/delete", { id: p.id });
    await call("POST", "/scenario/update", { roomId: room.id, timeLimitMin: 15, hintDeviceId: dev("node1.btn1") });
    const puzzles = [
      { name: "Otevři truhlu", description: "Nakloň truhlu o víc než 45°. Rozsvítí se zelená LED.",
        ruleList: [{ trigger: { deviceId: dev("node1.acc1"), eventType: "tilt" }, condition: { operator: "gt", value: 45 },
          actionList: [{ type: "solvePuzzle" }, { type: "setLed", deviceId: dev("node1.led1"), state: "on" }] }] },
      { name: "Tajné tlačítko", description: "Stiskni tlačítko 2. Červená LED zabliká.",
        ruleList: [{ trigger: { deviceId: dev("node1.btn2"), eventType: "press" },
          actionList: [{ type: "solvePuzzle" }, { type: "setLed", deviceId: dev("node1.led2"), state: "blink" }] }] },
      { name: "Zahřej teploměr", description: "Zahřej teploměr rukou na 28 °C a víc (DHT11 reaguje pomalu).",
        ruleList: [{ trigger: { deviceId: dev("node1.temp1"), eventType: "temperature" }, condition: { operator: "gte", value: 28 },
          actionList: [{ type: "solvePuzzle" }] }] },
    ];
    for (const p of puzzles) await call("POST", "/puzzle/create", { roomId: room.id, ...p });
    console.log(`scénář „${room.name}“: ${puzzles.length} hádanky, limit 15 min, nápověda = tlačítko 1 (node1.btn1)`);
  } else if (["reset", "start", "pause", "resume", "stop"].includes(command)) {
    const room = await findRoom();
    printGame(await call("POST", `/game/${command}`, { roomId: room.id }));
  } else if (command === "solve") {
    const room = await findRoom();
    const live = await call("GET", `/game/getCurrent?roomId=${room.id}`);
    const puzzle = live.game?.puzzleStateList[Number(values.puzzle) - 1];
    if (!puzzle) throw new Error("zadej --puzzle <číslo hádanky ze status>");
    printGame(await call("POST", "/game/solvePuzzle", { roomId: room.id, puzzleId: puzzle.puzzleId }));
  } else if (command === "status") {
    const room = await findRoom();
    const live = await call("GET", `/game/getCurrent?roomId=${room.id}`);
    if (!live.game) { console.log("místnost zatím nemá hru – spusť reset"); process.exit(0); }
    printGame(live.game);
    for (const a of live.alertList) console.log(`  ! ${a.type} ${a.at ?? a.since ?? ""} ${a.deviceId ?? ""}`);
    for (const e of live.eventList.slice(-10)) {
      console.log(`  ${e.occurredAt.slice(11, 19)} ${e.type}${e.deviceName ? ` ${e.deviceName}` : ""}${e.value ? ` ${JSON.stringify(e.value)}` : ""} (${e.source})`);
    }
  } else {
    console.log("Příkazy: rooms | demo | reset | start | pause | resume | stop | solve | status (viz komentář v scripts/play.js)");
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

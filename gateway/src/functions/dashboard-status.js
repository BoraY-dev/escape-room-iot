// Texty pro dashboard. Výstupy: 1 cloud, 2 identita, 3 hra, 4 nody a teplota, 5 fronta, 6 poslední chyby
const gw = global.get("gw");
const S = global.get("state");
const rows = msg.payload ?? [];
const now = Date.now();
const count = (...states) => rows.filter((r) => states.includes(r.state)).reduce((sum, r) => sum + r.n, 0);
const waiting = rows.filter((r) => ["pending", "waitingMapping", "inFlight"].includes(r.state));
const oldest = waiting.length ? Math.min(...waiting.map((r) => r.oldest)) : null;
const age = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)} s` : ms < 3600000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 3600000)} h`);

const cloud = !S.identity ? "neregistrovaná"
  : `${S.cloud.online ? "online" : "offline"}${S.cloud.lastContactAt ? `, kontakt ${S.cloud.lastContactAt.slice(11, 19)} UTC` : ""}${S.cloud.alarm ? ` – ${S.cloud.alarm}` : ""}`;
const identity = S.identity ? `gateway ${S.identity.gatewayId}, místnost ${S.identity.roomId}` : (S.registration?.message ?? "zadejte registrační kód z webové aplikace");
const solved = S.game ? S.game.puzzles.filter((p) => p.state === "solved").length : 0;
const game = `${S.game ? `${S.game.state}, vyřešeno ${solved}/${S.game.puzzles.length}` : "žádná hra"} · revize konfigurace ${S.config?.scenario?.revision ?? "–"}`;
const nodes = Object.entries(S.nodes).map(([id, n]) => {
  const online = now - n.lastSeen <= gw.NODE_OFFLINE_MS;
  return `${id}: ${online ? "online" : "offline"}, zařízení ${n.devices.length}${n.badDevices.length ? `, vadné: ${n.badDevices.join(", ")}` : ""}`;
}).join(" · ") || "žádný node";
const temperature = S.lastTemperature ? ` · teplota ${S.lastTemperature.value} °C` : "";
const queue = `čeká ${count("pending", "waitingMapping", "inFlight")} (bez mapování ${count("waitingMapping")})` +
  `${oldest ? `, nejstarší ${age(now - oldest)}` : ""} · potvrzeno ${count("confirmed")} · karanténa ${count("quarantined")}`;
const errors = S.errors.slice(0, 5).map((e) => `${e.at.slice(11, 19)} ${e.source}: ${e.message}`).join(" | ") || "žádné";

return [{ payload: cloud }, { payload: identity }, { payload: game }, { payload: nodes + temperature }, { payload: queue }, { payload: errors }];

// Provede přijaté povely v pořadí cloudu nad místním stavem hry. Povel, který čeká na novou konfiguraci,
// zastaví zpracování – novější povel ho nepředběhne. Již provedené povely se neopakují, jen se potvrdí.
// Výstupy: 1 zápis do DB, 2 nic k zápisu → rovnou potvrzení, 3 stáhnout konfiguraci
const gw = global.get("gw");
const S = global.get("state");
const now = Date.now();
const nowIso = new Date(now).toISOString();

const statements = [];
const serial = [];
const ackIds = [];
let needConfig = false;
for (const row of msg.payload ?? []) {
  if (row.state === "executed") { ackIds.push(row.commandId); continue; }
  const command = { type: row.type, payload: JSON.parse(row.payload) };
  const result = gw.applyCommand({ config: S.config, game: S.game, command, nowIso });
  if (result.needConfig) { needConfig = true; break; }
  S.game = result.game;
  if (result.resetNodes) {
    S.leds = {};
    S.displays = {};
    serial.push({ topic: "send", payload: { t: "reset" } }); // node zhasne LED, smaže LCD a vynuluje stav
  }
  for (const c of gw.outputCommandsFor(S, result.outputActions, now, statements)) serial.push({ topic: "send", payload: c });
  statements.push(`UPDATE command_log SET state = 'executed', executedAt = ${gw.lit(now)} WHERE commandId = ${gw.lit(row.commandId)}`);
  ackIds.push(row.commandId);
  node.status({ fill: "blue", shape: "dot", text: `${command.type} → hra ${S.game?.state ?? "–"}` });
}
if (statements.length) {
  statements.push(gw.kvUpsertSql("game", S.game, now), gw.kvUpsertSql("leds", S.leds, now), gw.kvUpsertSql("displays", S.displays ?? {}, now));
}

const out = { ackIds, serial };
return [
  statements.length ? { ...out, topic: gw.transaction(statements) } : null,
  statements.length ? null : out,
  needConfig ? { payload: "resetRoom" } : null,
];

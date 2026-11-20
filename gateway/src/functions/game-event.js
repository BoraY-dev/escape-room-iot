// Událost zařízení (press / tilt / move): uloží ji do fronty a vyhodnotí pravidla běžící hry
// (nápověda, vyřešení hádanky). Vše v jedné transakci; LED povely se pošlou až po zápisu.
const gw = global.get("gw");
const S = global.get("state");
const ev = msg.payload;
const now = msg.receivedAt ?? Date.now();
const nowIso = new Date(now).toISOString();
const deviceId = S.deviceMap[ev.id] ?? null;
const game = S.game;
const gameActive = game && ["running", "paused"].includes(game.state);

// UUID se přidělí hned při vzniku a při opakovaném odeslání se nemění
const item = {
  gatewayEventId: gw.uuid(),
  occurredAt: nowIso,
  type: "deviceEvent",
  ...(gameActive && { gameId: game.gameId }),
  ...(deviceId && { deviceId }),
  value: { event: ev.e, ...(ev.e === "tilt" && { value: ev.v }) },
};
// bez cloudového deviceId čeká událost na mapování (doplní ho heartbeat)
const statements = [gw.outboxInsertSql("event", item.gatewayEventId, ev.id, item, deviceId ? "pending" : "waitingMapping", now)];

const result = gw.applyRules({ config: S.config, game, deviceId, eventType: ev.e, value: ev.v, nowIso, uuid: gw.uuid });
const { statements: ruleStatements, ledCommands } = gw.commitRuleResult(S, result, now);

node.status({ fill: "green", shape: "dot", text: `${ev.id} ${ev.e}${result.items.length ? `, ${result.items.map((i) => i.type).join(", ")}` : ""}` });
msg.topic = gw.transaction([...statements, ...ruleStatements]);
msg.ledCommands = ledCommands;
msg.kind = "event";
return msg;

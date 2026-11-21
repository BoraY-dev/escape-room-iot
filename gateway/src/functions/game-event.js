// Událost zařízení: zařadí ji do fronty pro cloud a vyhodnotí pravidla běžící hry.
// Zápisy proběhnou v jedné transakci, povely pro node se odešlou až po ní.
// Události zařízení mimo CLOUD_DEVICE_TYPES se do fronty nezařazují.
// Výstupy: 1 transakce do DB, 2 bez zápisu rovnou do „Po zápisu“
const gw = global.get("gw");
const S = global.get("state");
const ev = msg.payload;
const now = msg.receivedAt ?? Date.now();
const nowIso = new Date(now).toISOString();
const deviceId = S.deviceMap[ev.id] ?? null;
const game = S.game;
const gameActive = game && ["running", "paused"].includes(game.state);
const toCloud = gw.isCloudDevice(S.nodes, ev.id);

if (["key", "code", "turn"].includes(ev.e)) (S.inputs ??= {})[ev.id] = { e: ev.e, v: ev.v, at: nowIso };

const statements = [];
if (toCloud) {
  // gatewayEventId vzniká jednou a při opakovaném odeslání zůstává stejné (deduplikace v cloudu).
  const item = {
    gatewayEventId: gw.uuid(),
    occurredAt: nowIso,
    type: "deviceEvent",
    ...(gameActive && { gameId: game.gameId }),
    ...(deviceId && { deviceId }),
    value: { event: ev.e, ...(ev.v !== undefined && { value: ev.v }) },
  };
  // Bez cloudového deviceId čeká položka, než ho doplní heartbeat.
  statements.push(gw.outboxInsertSql("event", item.gatewayEventId, ev.id, item, deviceId ? "pending" : "waitingMapping", now));
}

const result = gw.applyRules({ config: S.config, game, deviceId, eventType: ev.e, value: ev.v, nowIso, uuid: gw.uuid });
const { statements: ruleStatements, nodeCommands } = gw.commitRuleResult(S, result, now);
statements.push(...ruleStatements);

const label = `${ev.id} ${ev.e}${ev.v !== undefined ? ` ${ev.v}` : ""}${toCloud ? "" : " (lokálně)"}`;
node.status({ fill: "green", shape: "dot", text: `${label}${result.items.length ? `, ${result.items.map((i) => i.type).join(", ")}` : ""}` });
msg.nodeCommands = nodeCommands;
if (!statements.length) {
  msg.kind = "none";
  return [null, msg];
}
msg.topic = gw.transaction(statements);
msg.kind = "event";
return [msg, null];

// Vzorek teploty (každých 10 s): uloží ho pro medián okna 5 min UTC a hned vyhodnotí teplotní pravidla
// nad okamžitou hodnotou (pravidla na medián nečekají).
const gw = global.get("gw");
const S = global.get("state");
const m = msg.payload;
const now = msg.receivedAt ?? Date.now();
const nowIso = new Date(now).toISOString();
const deviceId = S.deviceMap[m.id] ?? null;

const statements = [
  `INSERT INTO samples (hwId, receivedAt, value, windowStart) VALUES (${gw.lit(m.id)}, ${gw.lit(now)}, ${gw.lit(m.v)}, ${gw.lit(gw.windowStartMs(now))})`,
];
const result = gw.applyRules({ config: S.config, game: S.game, deviceId, eventType: "temperature", value: m.v, nowIso, uuid: gw.uuid });
const { statements: ruleStatements, nodeCommands } = gw.commitRuleResult(S, result, now);

S.lastTemperature = { hwId: m.id, value: m.v, at: nowIso };
node.status({ fill: "green", shape: "dot", text: `${m.id}: ${m.v} °C` });
msg.topic = gw.transaction([...statements, ...ruleStatements]);
msg.nodeCommands = nodeCommands;
msg.kind = "event";
return msg;

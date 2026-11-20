// Nové povely nejdřív trvale uloží do command_log (stejné commandId se nevloží dvakrát).
// Výstupy: 1 zápis nových povelů, 2 žádné nové povely → rovnou dotaz na povely k provedení
const gw = global.get("gw");
const S = global.get("state");
const cls = gw.classifyResponse(msg.statusCode, msg.payload, msg.headers ?? {});
if (cls.kind !== "ok") {
  flow.set("busy_commands", 0);
  node.status({ fill: "red", shape: "ring", text: `getCommands: ${cls.reason ?? cls.kind}` });
  return null;
}
const items = msg.payload.itemList ?? [];
if (!items.length) return [null, { payload: [] }];
const now = Date.now();
const statements = items.map((c) =>
  `INSERT OR IGNORE INTO command_log (commandId, type, payload, createdAt, state, receivedAt) VALUES ` +
  `(${gw.lit(c.id)}, ${gw.lit(c.type)}, ${gw.lit(JSON.stringify(c.payload ?? {}))}, ${gw.lit(c.createdAt)}, 'received', ${gw.lit(now)})`);
node.status({ fill: "blue", shape: "dot", text: `přijato povelů: ${items.length}` });
return [{ topic: gw.transaction(statements) }, null];

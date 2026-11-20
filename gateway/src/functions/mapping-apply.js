// Doplní deviceId do čekajících položek a uvolní je k odeslání. UUID a čas vzniku se zachovají;
// položka ještě nebyla odeslána, takže doplnění payloadu je v pořádku.
const gw = global.get("gw");
const S = global.get("state");
const statements = [];
for (const row of msg.payload ?? []) {
  const deviceId = S.deviceMap[row.hwId];
  if (!deviceId) continue;
  const payload = { ...JSON.parse(row.payload), deviceId };
  statements.push(`UPDATE outbox SET payload = ${gw.lit(JSON.stringify(payload))}, state = 'pending' WHERE seq = ${gw.lit(row.seq)} AND state = 'waitingMapping'`);
}
if (!statements.length) return null;
node.status({ fill: "green", shape: "dot", text: `doplněno mapování: ${statements.length}` });
msg.topic = gw.transaction(statements);
return msg;

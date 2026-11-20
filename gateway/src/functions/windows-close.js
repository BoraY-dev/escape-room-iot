// Uzavření okna: medián vzorků → jedno měření do fronty a smazání surových vzorků, vše v jedné transakci.
// Medián tlumí krátké výkyvy (teploměr v ruce hráče), 5min okno zachová trend a snižuje objem dat 30×.
const gw = global.get("gw");
const S = global.get("state");
const rows = msg.payload ?? [];
if (!rows.length) return null;

const now = Date.now();
const statements = [];
for (const row of rows) {
  const values = String(row.vals).split(",").map(Number).filter(Number.isFinite);
  const value = gw.median(values);
  const windowStart = new Date(row.windowStart).toISOString();
  const windowEnd = new Date(row.windowStart + gw.WINDOW_SEC * 1000).toISOString();
  if (value !== null) {
    const deviceId = S.deviceMap[row.hwId] ?? null;
    const payload = { ...(deviceId && { deviceId }), value: Math.round(value * 10) / 10, sampleCount: values.length, windowStart, windowEnd };
    // klíč okna je stabilní (hwId + windowStart), takže okno nikdy nevznikne dvakrát
    statements.push(gw.outboxInsertSql("measurement", `${row.hwId}|${windowStart}`, row.hwId, payload, deviceId ? "pending" : "waitingMapping", now));
  }
  statements.push(`DELETE FROM samples WHERE hwId = ${gw.lit(row.hwId)} AND windowStart = ${gw.lit(row.windowStart)}`);
}
node.status({ fill: "green", shape: "dot", text: `uzavřeno oken: ${rows.length}` });
msg.topic = gw.transaction(statements);
msg.kind = "measurement";
return msg;

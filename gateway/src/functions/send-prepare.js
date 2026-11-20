// Označí vybrané položky jako odesílané (inFlight) a připraví tělo požadavku. Payload se už nemění.
const gw = global.get("gw");
const rows = msg.payload ?? [];
if (!rows.length) {
  flow.set(`busy_${msg.kind}`, 0);
  return null;
}
const items = rows.map((r) => ({ seq: r.seq, payload: JSON.parse(r.payload), attempts: r.attempts + 1 }));
// klíč, podle kterého cloud potvrzuje: UUID události / deviceId + windowStart měření
const key = (it) => (msg.kind === "event" ? it.payload.gatewayEventId : gw.measurementKey(it.payload.deviceId, it.payload.windowStart));

msg.batch = { kind: msg.kind, full: rows.length === msg.limit, items: items.map((it) => ({ seq: it.seq, key: key(it), attempts: it.attempts })) };
msg.body = msg.kind === "event" ? { eventList: items.map((i) => i.payload) } : { measurementList: items.map((i) => i.payload) };
msg.topic = gw.transaction([`UPDATE outbox SET state = 'inFlight', attempts = attempts + 1 WHERE seq IN (${gw.sqlList(items.map((i) => i.seq))})`]);
return msg;

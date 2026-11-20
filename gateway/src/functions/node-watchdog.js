// Každých 5 s: node bez zprávy 15 s je offline; když žádný node není online, požádá o ohlášení (who) –
// po otevření portu se Arduino restartuje a hello může přijít dřív, než gateway začne poslouchat.
const gw = global.get("gw");
const S = global.get("state");
const now = Date.now();

let online = 0;
for (const [id, n] of Object.entries(S.nodes)) {
  const isOnline = now - n.lastSeen <= gw.NODE_OFFLINE_MS;
  if (isOnline) online++;
  if (!isOnline && n.online === true) gw.pushError(S, id, "node je offline (15 s bez zprávy)");
  n.online = isOnline;
}

node.status({ fill: online ? "green" : "red", shape: "dot", text: `online nodů: ${online}` });
const lastWho = context.get("lastWho") ?? 0;
if (online === 0 && now - lastWho >= 15000) {
  context.set("lastWho", now);
  return { topic: "send", payload: { t: "who" } };
}
return null;

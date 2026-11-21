// Příjem řádku z Arduina: validace podle protokolu, registr nodů (hello, hb, err) a rozdělení zpráv.
// Výstupy: 1 událost (ev), 2 vzorek teploty (m), 3 potvrzení povelu (ack), 4 povely pro node (obnova LED a LCD)
const gw = global.get("gw");
const S = global.get("state");
const now = Date.now();

const parsed = gw.parseLine(msg.payload);
if (!parsed.ok) {
  if (parsed.error !== "empty") {
    S.diag.badLines++;
    gw.pushError(S, "USB", `neplatný řádek: ${parsed.error}`);
  }
  return null;
}
const m = parsed.msg;
const nodeId = m.node ?? (m.id && m.id.includes(".") ? gw.nodeOfHwId(m.id) : S.lastNodeId ?? "node?");
const info = (S.nodes[nodeId] ??= { lastSeen: 0, up: null, devices: [], badDevices: [], lastSeq: null });
const wasOffline = !info.lastSeen || now - info.lastSeen > gw.NODE_OFFLINE_MS;
info.lastSeen = now;
S.lastNodeId = nodeId;

// mezera v seq = ztracený řádek; jen diagnostika, protokol zprávy neopakuje
if (Number.isInteger(m.seq)) {
  const gap = gw.seqGap(info.lastSeq, m.seq);
  if (info.lastSeq !== null && gap > 0 && gap < 1000) S.diag.lostMessages += gap;
  info.lastSeq = m.seq;
}

// Povely nastavují absolutní stav, opakované odeslání je bezpečné.
const reapplyOutputs = () => gw.nodeRestoreCommands(S, nodeId).map((c) => ({ topic: "send", payload: c }));

node.status({ fill: "green", shape: "dot", text: `${nodeId}: ${m.t}` });

switch (m.t) {
  case "hello":
    // hello posílá node po startu, výstupy je proto potřeba obnovit
    Object.assign(info, { devices: m.devices, badDevices: [], fw: m.fw, lastSeq: null });
    return [null, null, null, reapplyOutputs()];
  case "hb": {
    const restarted = info.up !== null && m.up < info.up; // uptime kleslo = restart nodu
    info.up = m.up;
    return [null, null, null, restarted || wasOffline ? reapplyOutputs() : null];
  }
  case "err":
    // vadný senzor se vyřadí z heartbeat, dokud nepřijdou platná data nebo nové hello
    if (m.id && m.id.includes(".") && !info.badDevices.includes(m.id)) info.badDevices.push(m.id);
    gw.pushError(S, nodeId, `${m.id ?? nodeId}: ${m.code}`);
    return null;
  case "ev":
  case "m":
    info.badDevices = info.badDevices.filter((d) => d !== m.id); // platná data = senzor funguje
    msg.payload = m;
    msg.receivedAt = now; // čas vzniku přiděluje gateway při přijetí
    return m.t === "ev" ? [msg, null, null, null] : [null, msg, null, null];
  case "ack":
    msg.topic = "ack";
    msg.payload = m;
    return [null, null, msg, null];
  default:
    return null;
}

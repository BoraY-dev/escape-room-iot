// Sériová fronta povelů pro node: přidělí cid, posílá po jednom, čeká na ack 500 ms a nejvýš 3× zopakuje.
// Vstup: topic "send" (payload = povel bez cid: led / reset / who) nebo "ack" (payload = ack z nodu).
// Výstup: řádek JSON pro uzel serial out (konec řádku přidá konfigurace portu).
const gw = global.get("gw");
const S = global.get("state");
const ACK_TIMEOUT_MS = 500;
const MAX_RETRIES = 3;
const MAX_QUEUE = 50;

const st = context.get("st") ?? { queue: [], active: null, counter: Math.floor(Math.random() * 100000) };
context.set("st", st);

function transmit() {
  const job = st.active;
  node.send({ payload: job.line });
  job.timer = setTimeout(onTimeout, ACK_TIMEOUT_MS);
}

function onTimeout() {
  const job = st.active;
  if (!job) return;
  if (job.attempts >= MAX_RETRIES) {
    // "who" bez odpovědi je běžné (node není připojený) – nehlásit jako chybu
    if (job.cmd.t !== "who") gw.pushError(S, "USB", `povel ${job.cmd.t} ${job.cmd.id ?? ""} bez potvrzení`);
    node.status({ fill: "red", shape: "ring", text: `bez ack: ${job.cmd.t}` });
    st.active = null;
    startNext();
    return;
  }
  job.attempts++;
  transmit();
}

function startNext() {
  if (st.active || !st.queue.length) return;
  st.active = st.queue.shift();
  transmit();
}

if (msg.topic === "ack") {
  const job = st.active;
  if (job && job.cid === msg.payload.cid) {
    clearTimeout(job.timer);
    if (msg.payload.ok === false) gw.pushError(S, "USB", `node odmítl ${job.cmd.t}: ${msg.payload.err ?? "?"}`);
    st.active = null;
    startNext();
  }
  return null;
}

// nový povel
st.counter = (st.counter + 1) % 100000000; // cid nejvýš 8 znaků
const cid = String(st.counter);
const line = gw.nodeCommandLine({ ...msg.payload, cid });
if (!line) {
  gw.pushError(S, "USB", "povel je delší než 128 B");
  return null;
}
if (st.queue.length >= MAX_QUEUE) st.queue.shift(); // nejstarší čekající povel zahodit (LED jsou absolutní stavy)
st.queue.push({ cid, cmd: msg.payload, line, attempts: 0, timer: null });
node.status({ fill: "green", shape: "dot", text: `${msg.payload.t} (cid ${cid}), ve frontě ${st.queue.length}` });
startNext();
return null;

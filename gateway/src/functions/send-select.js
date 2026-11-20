// Výběr dávky k odeslání (msg.payload = "event" | "measurement"). Pro každý druh dat běží nejvýš
// jedno odeslání najednou; nedostupný cloud nezastaví příjem z USB ani lokální logiku.
const gw = global.get("gw");
const S = global.get("state");
const kind = msg.payload === "measurement" ? "measurement" : "event";
if (!S.ready || !S.identity?.token || !env.get("CLOUD_URL")) return null;

const busy = flow.get(`busy_${kind}`);
if (busy && Date.now() - busy < 60000) return null; // předchozí odeslání ještě běží (pojistka 60 s)
flow.set(`busy_${kind}`, Date.now());

const limit = flow.get(`limit_${kind}`) ?? gw.BATCH_SIZE; // při izolaci vadné položky se dávka zmenšuje
msg.kind = kind;
msg.limit = limit;
// uzel SQLite bere parametry jen jako pole, jejichž délka odpovídá počtu "$" v dotazu
msg.topic = "SELECT seq, itemKey, payload, attempts FROM outbox WHERE kind = $1 AND state = 'pending' AND nextAttemptAt <= $2 ORDER BY seq LIMIT $3";
msg.payload = [kind, Date.now(), limit];
return msg;

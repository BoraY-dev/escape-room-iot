// Vyhodnocení odpovědi cloudu (iot-gateway.md kap. 7):
// potvrzené položky → confirmed; výpadek / 5xx / 429 → nový pokus s rostoucím odstupem;
// 401/403 a chybná URL → alarm, data zůstávají; trvale odmítnutá data → dělení dávky a karanténa jedné položky.
const gw = global.get("gw");
const S = global.get("state");
const now = Date.now();
const { kind, items, full } = msg.batch;
const cls = gw.classifyResponse(msg.statusCode, msg.payload, msg.headers ?? {});
const seqs = (list) => gw.sqlList(list.map((i) => i.seq));
const retry = (item, delayMs, reason) =>
  `UPDATE outbox SET state = 'pending', nextAttemptAt = ${gw.lit(now + delayMs)}, lastError = ${gw.lit(reason)} WHERE seq = ${gw.lit(item.seq)}`;
const cloudState = (online, alarm) => {
  S.cloud.online = online;
  if (online) S.cloud.lastContactAt = new Date(now).toISOString();
  S.cloud.alarm = alarm;
};

const statements = [];
let more = false;
switch (cls.kind) {
  case "ok": {
    // potvrzené jsou jen položky, jejichž klíč je v accepted nebo duplicate seznamu
    const confirmed = gw.confirmedKeys(kind, msg.payload);
    const ok = items.filter((i) => confirmed.has(i.key));
    const rest = items.filter((i) => !confirmed.has(i.key));
    if (ok.length) statements.push(`UPDATE outbox SET state = 'confirmed', confirmedAt = ${gw.lit(now)}, lastError = NULL WHERE seq IN (${seqs(ok)})`);
    for (const i of rest) statements.push(retry(i, gw.backoffMs(i.attempts), "notConfirmed"));
    flow.set(`limit_${kind}`, gw.BATCH_SIZE);
    cloudState(true, null);
    more = full; // plná dávka → ve frontě je nejspíš další
    break;
  }
  case "retry":
    for (const i of items) statements.push(retry(i, gw.backoffMs(i.attempts), cls.reason));
    cloudState(false, null);
    break;
  case "rateLimited":
    for (const i of items) statements.push(retry(i, cls.retryAfterMs ?? gw.backoffMs(i.attempts), "429"));
    break;
  case "auth":
    for (const i of items) statements.push(retry(i, 60000, cls.reason));
    cloudState(true, `cloud odmítl token (${cls.reason}) – gateway smazaná nebo zablokovaná?`);
    break;
  case "serviceError":
    for (const i of items) statements.push(retry(i, 60000, cls.reason));
    cloudState(false, `neočekávaná odpověď (${cls.reason}) – zkontrolovat CLOUD_URL`);
    break;
  case "dataError":
    if (items.length > 1) {
      // dávka obsahuje vadnou položku: poslat znovu v pořadí po polovinách, dokud se neizoluje
      flow.set(`limit_${kind}`, Math.ceil(items.length / 2));
      statements.push(`UPDATE outbox SET state = 'pending', nextAttemptAt = 0 WHERE seq IN (${seqs(items)})`);
    } else {
      const error = JSON.stringify({ status: msg.statusCode, codes: cls.errorCodes });
      statements.push(`UPDATE outbox SET state = 'quarantined', lastError = ${gw.lit(error)} WHERE seq = ${gw.lit(items[0].seq)}`);
      gw.pushError(S, "cloud", `záznam v karanténě: ${cls.errorCodes.join(", ")}`);
      flow.set(`limit_${kind}`, gw.BATCH_SIZE);
    }
    more = true;
    cloudState(true, null);
    break;
}

node.status(cls.kind === "ok"
  ? { fill: "green", shape: "dot", text: `${kind}: potvrzeno ${items.length}` }
  : { fill: "yellow", shape: "ring", text: `${kind}: ${cls.kind} ${cls.reason ?? ""}` });
msg.topic = gw.transaction(statements);
msg.payload = null;
msg.more = more;
return msg;

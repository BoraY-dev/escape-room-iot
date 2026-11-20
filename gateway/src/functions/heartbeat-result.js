// Odpověď heartbeat: mapování hwId → deviceId, příznak změny konfigurace a počet čekajících povelů.
// Výstupy: 1 uložení mapování, 2 stáhnout konfiguraci, 3 doplnit mapování do fronty
const gw = global.get("gw");
const S = global.get("state");
const now = Date.now();
const cls = gw.classifyResponse(msg.statusCode, msg.payload, msg.headers ?? {});

if (cls.kind !== "ok") {
  S.cloud.online = cls.kind === "auth" || cls.kind === "dataError";
  S.cloud.alarm = cls.kind === "auth" ? "cloud odmítl token – gateway smazaná nebo zablokovaná?"
    : cls.kind === "dataError" ? `heartbeat odmítnut: ${cls.errorCodes.join(", ")}`
      : cls.kind === "serviceError" ? `neočekávaná odpověď (${cls.reason}) – zkontrolovat CLOUD_URL` : null;
  if (cls.kind === "dataError") gw.pushError(S, "heartbeat", cls.errorCodes.join(", "));
  node.status({ fill: "red", shape: "ring", text: `heartbeat: ${cls.reason ?? cls.kind}` });
  return null;
}

Object.assign(S.cloud, { online: true, lastContactAt: new Date(now).toISOString(), alarm: null, pendingCommands: msg.payload.pendingCommandCount });
let mappingChanged = false;
for (const d of msg.payload.deviceList ?? []) {
  if (S.deviceMap[d.hwId] !== d.id) {
    S.deviceMap[d.hwId] = d.id;
    mappingChanged = true;
  }
}
node.status({ fill: "green", shape: "dot", text: `OK, zařízení ${msg.payload.deviceList?.length ?? 0}${msg.payload.configChanged ? ", nová konfigurace" : ""}` });
return [
  mappingChanged ? { topic: gw.transaction([gw.kvUpsertSql("deviceMap", S.deviceMap, now)]) } : null,
  msg.payload.configChanged ? { payload: "configChanged" } : null,
  mappingChanged ? { payload: "mapping" } : null,
];

// Uloží konfiguraci z cloudu jedním zápisem (při výpadku se použije poslední uložená kopie)
// a doplní mapování hwId → deviceId. Výstupy: 1 zápis do DB, 2 doplnit mapování ve frontě
const gw = global.get("gw");
const S = global.get("state");
const cls = gw.classifyResponse(msg.statusCode, msg.payload, msg.headers ?? {});
if (cls.kind !== "ok") {
  node.status({ fill: "red", shape: "ring", text: `getConfig: ${cls.reason ?? cls.kind}` });
  if (cls.kind === "auth") S.cloud.alarm = "cloud odmítl token – gateway smazaná nebo zablokovaná?";
  return null;
}
const now = Date.now();
const { uuAppErrorMap, ...config } = msg.payload;
S.config = config;
for (const d of config.deviceList ?? []) S.deviceMap[d.hwId] = d.id;
const statements = [gw.kvUpsertSql("config", config, now), gw.kvUpsertSql("deviceMap", S.deviceMap, now)];

// stav hry z cloudu převezme jen tehdy, když žádný místní nemá – novější místní stav nepřepisuje
if (!S.game && config.currentGame) {
  S.game = gw.gameFromSnapshot(config.currentGame);
  statements.push(gw.kvUpsertSql("game", S.game, now));
}
node.status({ fill: "green", shape: "dot", text: `revize ${config.scenario?.revision}, zařízení ${config.deviceList?.length ?? 0}` });
return [{ topic: gw.transaction(statements) }, { payload: "mapping" }];

// Výsledek registrace: token gateway trvale uloží do lokální databáze dřív, než začne běžná komunikace.
// Token se nedostane do dashboardu, logů ani fronty dat.
const gw = global.get("gw");
const S = global.get("state");
const cls = gw.classifyResponse(msg.statusCode, msg.payload, msg.headers ?? {});
if (cls.kind !== "ok") {
  S.registration = {
    ok: false,
    message: cls.kind === "auth" ? "neplatný, prošlý nebo už použitý kód – v aplikaci vytvořte novou registraci" : `chyba: ${cls.reason ?? cls.kind}`,
  };
  node.status({ fill: "red", shape: "ring", text: "registrace selhala" });
  return null;
}
const p = msg.payload;
S.identity = { gatewayId: p.gatewayId, roomId: p.roomId, token: p.accessToken };
S.registration = { ok: true, message: `registrováno: gateway ${p.gatewayId}` };
node.status({ fill: "green", shape: "dot", text: `gateway ${p.gatewayId}` });
return { topic: gw.transaction([gw.kvUpsertSql("identity", S.identity, Date.now())]) };

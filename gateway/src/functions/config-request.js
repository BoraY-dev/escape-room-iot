// Stažení konfigurace místnosti: při startu, při configChanged z heartbeat a tlačítkem na dashboardu.
const gw = global.get("gw");
const S = global.get("state");
if (!S.ready || !S.identity?.token || !env.get("CLOUD_URL")) return null;
return gw.cloudRequest(env.get("CLOUD_URL"), "GET", "/gateway/getConfig", null, S.identity.token);

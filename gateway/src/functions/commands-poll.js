// Každé 2 s vyzvedne čekající povely z cloudu (gateway/getCommands). Další dotaz až po dokončení předchozího.
const gw = global.get("gw");
const S = global.get("state");
if (!S.ready || !S.identity?.token || !env.get("CLOUD_URL")) return null;
const busy = flow.get("busy_commands");
if (busy && Date.now() - busy < 30000) return null;
flow.set("busy_commands", Date.now());
return gw.cloudRequest(env.get("CLOUD_URL"), "GET", "/gateway/getCommands?limit=100", null, S.identity.token);

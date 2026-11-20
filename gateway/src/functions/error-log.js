// Chyba z libovolného uzlu (catch) → seznam posledních chyb na dashboardu.
const gw = global.get("gw");
const S = global.get("state");
const source = msg.error?.source?.name || msg.error?.source?.type || "flow";
gw.pushError(S, source, msg.error?.message ?? "neznámá chyba");
return null;

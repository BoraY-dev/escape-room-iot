// Obnoví stav z tabulky kv do paměti. RAM je jen cache – zdrojem pravdy je lokální SQLite.
// Výstupy: 1 registrovaná gateway → stáhnout konfiguraci, 2 neregistrovaná + REGISTRATION_CODE → registrace
const S = global.get("state");
for (const row of msg.payload ?? []) {
  try {
    const value = JSON.parse(row.value);
    if (row.key === "identity") S.identity = value;
    else if (row.key === "config") S.config = value;
    else if (row.key === "deviceMap") S.deviceMap = value;
    else if (row.key === "game") S.game = value;
    else if (row.key === "leds") S.leds = value;
  } catch (e) {
    node.warn(`kv ${row.key}: ${e.message}`);
  }
}
S.ready = true;

if (S.identity?.token) {
  node.status({ fill: "green", shape: "dot", text: `gateway ${S.identity.gatewayId}` });
  return [{ payload: "start" }, null];
}
node.status({ fill: "yellow", shape: "ring", text: "čeká na registraci" });
// bez dashboardu (např. první nastavení přes SSH) lze kód předat proměnnou prostředí
const code = env.get("REGISTRATION_CODE");
return [null, code ? { payload: { code } } : null];

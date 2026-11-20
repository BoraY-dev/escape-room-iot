// [On Start] Načte knihovnu gw (vloží ji build) a připraví sdílený stav gateway v paměti.
/*__GW_LIB__*/

// UUID pro události: modul crypto (záložka Setup → Modules), záložně Math.random
gw.uuid = (typeof crypto !== "undefined" && crypto.randomUUID)
  ? () => crypto.randomUUID()
  : () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });

global.set("gw", gw);
global.set("state", {
  ready: false,          // stav obnovený z databáze
  identity: null,        // { gatewayId, roomId, token } – token jen v paměti a v lokální DB
  config: null,          // poslední konfigurace z gateway/getConfig
  deviceMap: {},         // hwId → cloudové deviceId
  game: null,            // místní stav hry
  leds: {},              // požadované stavy LED { hwId: "on" | "off" | "blink" }
  nodes: {},             // registr nodů { node1: { lastSeen, up, devices, badDevices, fw } }
  cloud: { online: false, lastContactAt: null, alarm: null },
  registration: null,    // výsledek posledního pokusu o registraci (bez kódu)
  lastTemperature: null,
  errors: [],            // posledních 20 chyb pro dashboard
  diag: { badLines: 0, lostMessages: 0 },
});

// Sestaví gateway/flows.json z kódu function uzlů (src/functions) a knihovny (src/lib/gw.js).
// Spuštění: cd gateway; npm run build (složka scripts/, ne build/ – ta je v .gitignore)
// flows.json je výsledek buildu – upravuje se zdroj v src/ a build se spustí znovu.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const fnCode = (file) => read(`src/functions/${file}`);
const GW_LIB = read("src/lib/gw.js").replace(/\nif \(typeof module !== "undefined"[^\n]*\n?/, "\n");

const nodes = [];
const add = (n) => { nodes.push(n); return n.id; };
const pos = (col, row) => ({ x: 140 + col * 230, y: 60 + row * 70 });

// --- pomocné konstruktory uzlů ---
const tab = (id, label, info) => add({ id, type: "tab", label, disabled: false, info });

function fn(z, id, name, file, { col, row, outputs = 1, wires = [], start, stop, libs } = {}) {
  return add({
    id, type: "function", z, name, func: fnCode(file), outputs, timeout: 0, noerr: 0,
    initialize: start ? fnCode(start).replace("/*__GW_LIB__*/", GW_LIB) : "",
    finalize: stop ? fnCode(stop) : "",
    libs: libs ?? [], ...pos(col, row), wires,
  });
}
function inject(z, id, name, { col, row, payload = "", repeat = "", once = false, onceDelay = 0.1, wires = [], disabled = false }) {
  return add({
    id, type: "inject", z, name, props: [{ p: "payload" }], repeat: String(repeat), crontab: "", once, onceDelay, topic: "",
    payload, payloadType: "str", ...(disabled && { d: true }), ...pos(col, row), wires,
  });
}
const linkIn = (z, id, name, { col, row, wires }) => add({ id, type: "link in", z, name, links: [], ...pos(col, row), wires });
const linkOut = (z, id, name, targets, { col, row }) => add({ id, type: "link out", z, name, mode: "link", links: targets, ...pos(col, row), wires: [] });
const linkReturn = (z, id, { col, row }) => add({ id, type: "link out", z, name: "odpověď", mode: "return", links: [], ...pos(col, row), wires: [] });
const linkCall = (z, id, name, target, { col, row, wires = [] }) =>
  add({ id, type: "link call", z, name, links: [target], linkType: "static", timeout: "30", ...pos(col, row), wires });
const dbQuery = (z, id, { col, row, wires = [] }) => linkCall(z, id, "DB dotaz", "li_db_query", { col, row, wires });
const dbBatch = (z, id, { col, row, wires = [] }) => linkCall(z, id, "DB transakce", "li_db_batch", { col, row, wires });
const http = (z, id, name, { col, row, wires }) => add({
  id, type: "http request", z, name, method: "use", ret: "obj", paytoqs: "ignore", url: "", tls: "", persist: false,
  proxy: "", insecureHTTPParser: false, authType: "", senderr: false, headers: [], ...pos(col, row), wires,
});
const sqlite = (z, id, name, mode, { col, row, wires = [] }) =>
  add({ id, type: "sqlite", z, mydb: "cfg_db", sqlquery: mode, sql: "", name, ...pos(col, row), wires });
function errorLog(z, suffix, { col, row }) {
  fn(z, `fn_errlog_${suffix}`, "Zaznamenat chybu", "error-log.js", { col: col + 1, row, outputs: 0 });
  add({ id: `catch_${suffix}`, type: "catch", z, name: "chyby záložky", scope: null, uncaught: false, ...pos(col, row), wires: [[`fn_errlog_${suffix}`]] });
}

// --- konfigurační uzly ---
add({ id: "cfg_db", type: "sqlitedb", db: "${GATEWAY_DB}", mode: "RWC" });
add({
  id: "cfg_serial", type: "serial-port", name: "Arduino", serialport: "${SERIAL_PORT}", serialbaud: "115200",
  databits: "8", parity: "none", stopbits: "1", waitfor: "", dtr: "none", rts: "none", cts: "none", dsr: "none",
  newline: "\\n", bin: "false", out: "char", addchar: "\\n", responsetimeout: "10000",
});
add({ id: "cfg_ui_base", type: "ui_base", theme: { name: "theme-light" }, site: { name: "Escape Room Gateway", hideToolbar: "false", allowSwipe: "false", lockMenu: "false", allowTempTheme: "true", dateFormat: "DD.MM.YYYY", sizes: { sx: 48, sy: 48, gx: 6, gy: 6, cx: 6, cy: 6, px: 0, py: 0 } } });
add({ id: "ui_tab_gw", type: "ui_tab", name: "Gateway", icon: "dashboard", order: 1, disabled: false, hidden: false });
const group = (id, name, order) => add({ id, type: "ui_group", name, tab: "ui_tab_gw", order, disp: true, width: "12", collapse: false, className: "" });
group("ui_grp_state", "Stav gateway", 1);
group("ui_grp_reg", "Registrace", 2);
group("ui_grp_ctl", "Ovládání", 3);

// ---------------------------------------------------------------------------
// 1 Start a databáze
// ---------------------------------------------------------------------------
const T1 = "tab_start";
tab(T1, "1 Start a databáze", "Načtení knihovny gw, založení tabulek, obnova stavu z SQLite. Jediný přístup k databázi (DB dotaz, DB transakce).");
inject(T1, "inj_start", "start", { col: 0, row: 0, once: true, onceDelay: 1, wires: [["fn_libinit"]] });
fn(T1, "fn_libinit", "Načtení knihovny", "lib-init.js", { col: 1, row: 0, start: "lib-init.start.js", libs: [{ var: "crypto", module: "crypto" }], wires: [["fn_schema"]] });
fn(T1, "fn_schema", "Schéma DB", "db-schema.js", { col: 2, row: 0, wires: [["lc_schema"]] });
dbBatch(T1, "lc_schema", { col: 3, row: 0, wires: [["fn_dbload"]] });
fn(T1, "fn_dbload", "Načíst stav", "db-load.js", { col: 4, row: 0, wires: [["lc_load"]] });
dbQuery(T1, "lc_load", { col: 5, row: 0, wires: [["fn_restore"]] });
fn(T1, "fn_restore", "Obnovit stav", "state-restore.js", { col: 6, row: 0, outputs: 2, wires: [["lo_start_config"], ["lo_start_register"]] });
linkOut(T1, "lo_start_config", "→ konfigurace", ["li_config"], { col: 7, row: 0 });
linkOut(T1, "lo_start_register", "→ registrace", ["li_register"], { col: 7, row: 1 });

linkIn(T1, "li_db_query", "DB dotaz", { col: 0, row: 3, wires: [["sql_query"]] });
sqlite(T1, "sql_query", "SQLite dotaz (msg.topic, parametry v payload)", "msg.topic", { col: 1, row: 3, wires: [["lr_query"]] });
linkReturn(T1, "lr_query", { col: 2, row: 3 });
linkIn(T1, "li_db_batch", "DB transakce", { col: 0, row: 4, wires: [["sql_batch"]] });
sqlite(T1, "sql_batch", "SQLite transakce (batch)", "batch", { col: 1, row: 4, wires: [["lr_batch"]] });
linkReturn(T1, "lr_batch", { col: 2, row: 4 });
add({ id: "catch_batch", type: "catch", z: T1, name: "chyba transakce", scope: ["sql_batch"], uncaught: false, ...pos(0, 5), wires: [["fn_rollback"]] });
fn(T1, "fn_rollback", "ROLLBACK", "db-rollback.js", { col: 1, row: 5, wires: [["sql_rollback"]] });
sqlite(T1, "sql_rollback", "SQLite ROLLBACK", "batch", { col: 2, row: 5 });
errorLog(T1, "start", { col: 0, row: 7 });

// ---------------------------------------------------------------------------
// 2 Node (USB)
// ---------------------------------------------------------------------------
const T2 = "tab_usb";
tab(T2, "2 Node (USB)", "Sériová linka s Arduinem: 115 200 Bd, JSON na řádek (iot-protocol.md). Registr nodů, povely s ack.");
add({ id: "serial_in", type: "serial in", z: T2, name: "Arduino (USB)", serial: "cfg_serial", ...pos(0, 0), wires: [["fn_receive"]] });
linkIn(T2, "li_sim", "Simulátor", { col: 0, row: 1, wires: [["fn_receive"]] });
fn(T2, "fn_receive", "Příjem řádku", "serial-receive.js", {
  col: 1, row: 0, outputs: 4, wires: [["lo_event"], ["lo_sample"], ["fn_queue"], ["fn_queue"]],
});
linkOut(T2, "lo_event", "→ událost", ["li_event"], { col: 2, row: 0 });
linkOut(T2, "lo_sample", "→ teplota", ["li_sample"], { col: 2, row: 1 });
linkIn(T2, "li_cmd", "Povel pro node", { col: 1, row: 3, wires: [["fn_queue"]] });
inject(T2, "inj_watch", "každých 5 s", { col: 1, row: 4, repeat: 5, wires: [["fn_watchdog"]] });
fn(T2, "fn_watchdog", "Kontrola nodů", "node-watchdog.js", { col: 2, row: 4, wires: [["fn_queue"]] });
fn(T2, "fn_queue", "Sériová fronta (cid, ack)", "serial-queue.js", { col: 3, row: 2, stop: "serial-queue.stop.js", wires: [["serial_out"]] });
add({ id: "serial_out", type: "serial out", z: T2, name: "Arduino (USB)", serial: "cfg_serial", ...pos(4, 2), wires: [] });
errorLog(T2, "usb", { col: 0, row: 6 });

// ---------------------------------------------------------------------------
// 3 Hra a data
// ---------------------------------------------------------------------------
const T3 = "tab_game";
tab(T3, "3 Hra a data", "Události do fronty, lokální pravidla hádanek, vzorky teploty a medián za 5min okno UTC.");
linkIn(T3, "li_event", "Událost", { col: 0, row: 0, wires: [["fn_event"]] });
fn(T3, "fn_event", "Zpracovat událost", "game-event.js", { col: 1, row: 0, wires: [["lc_event"]] });
dbBatch(T3, "lc_event", { col: 2, row: 0, wires: [["fn_after"]] });
linkIn(T3, "li_sample", "Teplota", { col: 0, row: 1, wires: [["fn_sample"]] });
fn(T3, "fn_sample", "Uložit vzorek", "temperature-sample.js", { col: 1, row: 1, wires: [["lc_sample"]] });
dbBatch(T3, "lc_sample", { col: 2, row: 1, wires: [["fn_after"]] });
inject(T3, "inj_windows", "každých 10 s", { col: 0, row: 2, repeat: 10, wires: [["fn_winq"]] });
fn(T3, "fn_winq", "Uzavřená okna", "windows-query.js", { col: 1, row: 2, wires: [["lc_winq"]] });
dbQuery(T3, "lc_winq", { col: 2, row: 2, wires: [["fn_winclose"]] });
fn(T3, "fn_winclose", "Medián a měření", "windows-close.js", { col: 3, row: 2, wires: [["lc_winclose"]] });
dbBatch(T3, "lc_winclose", { col: 4, row: 2, wires: [["fn_after"]] });
fn(T3, "fn_after", "Po zápisu", "game-after-write.js", { col: 5, row: 0, outputs: 2, wires: [["lo_game_cmd"], ["lo_game_send"]] });
linkOut(T3, "lo_game_cmd", "→ povel pro node", ["li_cmd"], { col: 6, row: 0 });
linkOut(T3, "lo_game_send", "→ odeslat", ["li_send"], { col: 6, row: 1 });
inject(T3, "inj_gametimer", "každých 5 s", { col: 0, row: 4, repeat: 5, wires: [["fn_gametimer"]] });
fn(T3, "fn_gametimer", "Hlídat čas hry", "game-timer.js", { col: 1, row: 4, wires: [["lc_gametimer"]] });
dbBatch(T3, "lc_gametimer", { col: 2, row: 4 });
errorLog(T3, "game", { col: 0, row: 6 });

// ---------------------------------------------------------------------------
// 4 Cloud
// ---------------------------------------------------------------------------
const T4 = "tab_cloud";
tab(T4, "4 Cloud", "HTTPS komunikace s cloudem (command-list-gateway.md): odesílání dávek, heartbeat, konfigurace, povely, registrace, retence.");
// odesílač dávek (události i měření, každý druh zvlášť)
linkIn(T4, "li_send", "Odeslat", { col: 0, row: 0, wires: [["fn_sendsel"]] });
inject(T4, "inj_send_ev", "události à 3 s", { col: 0, row: 1, repeat: 3, payload: "event", wires: [["fn_sendsel"]] });
inject(T4, "inj_send_m", "měření à 10 s", { col: 0, row: 2, repeat: 10, payload: "measurement", wires: [["fn_sendsel"]] });
fn(T4, "fn_sendsel", "Vybrat dávku", "send-select.js", { col: 1, row: 0, wires: [["lc_sendsel"]] });
dbQuery(T4, "lc_sendsel", { col: 2, row: 0, wires: [["fn_sendprep"]] });
fn(T4, "fn_sendprep", "Připravit odeslání", "send-prepare.js", { col: 3, row: 0, wires: [["lc_sendprep"]] });
dbBatch(T4, "lc_sendprep", { col: 4, row: 0, wires: [["fn_sendhttp"]] });
fn(T4, "fn_sendhttp", "HTTP požadavek", "send-http.js", { col: 5, row: 0, wires: [["http_send"]] });
http(T4, "http_send", "sendEvents / sendMeasurements", { col: 6, row: 0, wires: [["fn_sendres"]] });
fn(T4, "fn_sendres", "Vyhodnotit odpověď", "send-result.js", { col: 7, row: 0, wires: [["lc_sendres"]] });
dbBatch(T4, "lc_sendres", { col: 8, row: 0, wires: [["fn_senddone"]] });
fn(T4, "fn_senddone", "Konec odeslání", "send-done.js", { col: 9, row: 0, wires: [["fn_sendsel"]] });
// heartbeat a konfigurace
inject(T4, "inj_hb", "heartbeat à 30 s", { col: 0, row: 4, repeat: 30, once: true, onceDelay: 5, wires: [["fn_hb"]] });
linkIn(T4, "li_hb", "Heartbeat", { col: 0, row: 5, wires: [["fn_hb"]] });
fn(T4, "fn_hb", "Heartbeat", "heartbeat.js", { col: 1, row: 4, wires: [["http_hb"]] });
http(T4, "http_hb", "gateway/heartbeat", { col: 2, row: 4, wires: [["fn_hbres"]] });
fn(T4, "fn_hbres", "Výsledek heartbeat", "heartbeat-result.js", { col: 3, row: 4, outputs: 3, wires: [["lc_hbmap"], ["fn_cfgreq"], ["fn_mapq"]] });
dbBatch(T4, "lc_hbmap", { col: 4, row: 4 });
linkIn(T4, "li_config", "Konfigurace", { col: 3, row: 6, wires: [["fn_cfgreq"]] });
fn(T4, "fn_cfgreq", "Požadavek getConfig", "config-request.js", { col: 4, row: 6, wires: [["http_cfg"]] });
http(T4, "http_cfg", "gateway/getConfig", { col: 5, row: 6, wires: [["fn_cfgsave"]] });
fn(T4, "fn_cfgsave", "Uložit konfiguraci", "config-save.js", { col: 6, row: 6, outputs: 2, wires: [["lc_cfgsave"], ["fn_mapq"]] });
dbBatch(T4, "lc_cfgsave", { col: 7, row: 6 });
fn(T4, "fn_mapq", "Čekající na mapování", "mapping-query.js", { col: 5, row: 5, wires: [["lc_mapq"]] });
dbQuery(T4, "lc_mapq", { col: 6, row: 5, wires: [["fn_mapapply"]] });
fn(T4, "fn_mapapply", "Doplnit mapování", "mapping-apply.js", { col: 7, row: 5, wires: [["lc_mapapply"]] });
dbBatch(T4, "lc_mapapply", { col: 8, row: 5, wires: [["fn_nudge"]] });
fn(T4, "fn_nudge", "Spustit odesílání", "nudge-senders.js", { col: 9, row: 5, wires: [["fn_sendsel"]] });
// povely z cloudu
inject(T4, "inj_cmd", "povely à 2 s", { col: 0, row: 8, repeat: 2, once: true, onceDelay: 6, wires: [["fn_cmdpoll"]] });
fn(T4, "fn_cmdpoll", "Vyzvednout povely", "commands-poll.js", { col: 1, row: 8, wires: [["http_cmd"]] });
http(T4, "http_cmd", "gateway/getCommands", { col: 2, row: 8, wires: [["fn_cmdstore"]] });
fn(T4, "fn_cmdstore", "Uložit nové povely", "commands-store.js", { col: 3, row: 8, outputs: 2, wires: [["lc_cmdstore"], ["fn_cmdq"]] });
dbBatch(T4, "lc_cmdstore", { col: 4, row: 8, wires: [["fn_cmdq"]] });
fn(T4, "fn_cmdq", "Povely k provedení", "commands-query.js", { col: 5, row: 8, wires: [["lc_cmdq"]] });
dbQuery(T4, "lc_cmdq", { col: 6, row: 8, wires: [["fn_cmdexec"]] });
fn(T4, "fn_cmdexec", "Provést povely", "commands-execute.js", { col: 7, row: 8, outputs: 3, wires: [["lc_cmdexec"], ["fn_cmdafter"], ["fn_cfgreq"]] });
dbBatch(T4, "lc_cmdexec", { col: 8, row: 8, wires: [["fn_cmdafter"]] });
fn(T4, "fn_cmdafter", "Po provedení", "commands-after.js", { col: 9, row: 8, outputs: 2, wires: [["lo_cloud_cmd"], ["http_ack"]] });
linkOut(T4, "lo_cloud_cmd", "→ povel pro node", ["li_cmd"], { col: 10, row: 8 });
http(T4, "http_ack", "gateway/ackCommands", { col: 10, row: 9, wires: [["fn_ackres"]] });
fn(T4, "fn_ackres", "Výsledek potvrzení", "commands-ack-result.js", { col: 11, row: 9, wires: [["lc_ackres"]] });
dbBatch(T4, "lc_ackres", { col: 12, row: 9, wires: [["fn_cmddone"]] });
fn(T4, "fn_cmddone", "Konec povelů", "commands-done.js", { col: 13, row: 9, outputs: 0 });
// registrace
linkIn(T4, "li_register", "Registrace", { col: 0, row: 11, wires: [["fn_regreq"]] });
fn(T4, "fn_regreq", "Registrace", "register-request.js", { col: 1, row: 11, wires: [["http_reg"]] });
http(T4, "http_reg", "gateway/register", { col: 2, row: 11, wires: [["fn_regres"]] });
fn(T4, "fn_regres", "Uložit identitu", "register-result.js", { col: 3, row: 11, wires: [["lc_regres"]] });
dbBatch(T4, "lc_regres", { col: 4, row: 11, wires: [["fn_afterreg"]] });
fn(T4, "fn_afterreg", "Po registraci", "after-register.js", { col: 5, row: 11, outputs: 3, wires: [["fn_cfgreq"], ["fn_hb"], ["fn_sendsel"]] });
// retence
inject(T4, "inj_cleanup", "úklid à 1 h", { col: 0, row: 13, repeat: 3600, once: true, onceDelay: 30, wires: [["fn_cleanup"]] });
fn(T4, "fn_cleanup", "Retence 24 h / 7 dní", "cleanup.js", { col: 1, row: 13, wires: [["lc_cleanup"]] });
dbBatch(T4, "lc_cleanup", { col: 2, row: 13 });
errorLog(T4, "cloud", { col: 0, row: 15 });

// ---------------------------------------------------------------------------
// 5 Dashboard (node-red-dashboard, http://<rpi>:1880/ui)
// ---------------------------------------------------------------------------
const T5 = "tab_ui";
tab(T5, "5 Dashboard", "Provozní dashboard gateway: stav cloudu, nodů a fronty, registrace, ovládání.");
inject(T5, "inj_stats", "každých 5 s", { col: 0, row: 0, repeat: 5, once: true, onceDelay: 3, wires: [["fn_statsq"]] });
fn(T5, "fn_statsq", "Statistika fronty", "stats-query.js", { col: 1, row: 0, wires: [["lc_stats"]] });
dbQuery(T5, "lc_stats", { col: 2, row: 0, wires: [["fn_dash"]] });
const texts = [["ui_cloud", "Cloud"], ["ui_identity", "Identita"], ["ui_game", "Hra"], ["ui_nodes", "Nody"], ["ui_queue", "Fronta dat"], ["ui_errors", "Poslední chyby"]];
fn(T5, "fn_dash", "Stav pro dashboard", "dashboard-status.js", { col: 3, row: 0, outputs: texts.length, wires: texts.map(([id]) => [id]) });
texts.forEach(([id, label], i) => add({
  id, type: "ui_text", z: T5, group: "ui_grp_state", order: i + 1, width: 0, height: 0, name: label, label,
  format: "{{msg.payload}}", layout: "row-left", className: "", style: false, ...pos(4, i), wires: [],
}));
add({
  id: "ui_regform", type: "ui_form", z: T5, name: "Registrační kód", label: "", group: "ui_grp_reg", order: 1, width: 0, height: 0,
  options: [{ label: "Registrační kód z webové aplikace", value: "code", type: "text", required: true, rows: null }],
  formValue: { code: "" }, payload: "", submit: "Registrovat", cancel: "Zrušit", topic: "topic", topicType: "msg",
  splitLayout: "", className: "", ...pos(0, 7), wires: [["lo_ui_register"]],
});
linkOut(T5, "lo_ui_register", "→ registrace", ["li_register"], { col: 1, row: 7 });
const button = (id, label, order, row, wires) => add({
  id, type: "ui_button", z: T5, name: label, group: "ui_grp_ctl", order, width: 0, height: 0, passthru: false, label,
  tooltip: "", color: "", bgcolor: "", className: "", icon: "", payload: "", payloadType: "str", topic: "topic", topicType: "msg",
  ...pos(0, row), wires,
});
button("ui_btn_config", "Obnovit konfiguraci", 1, 9, [["lo_ui_config"]]);
linkOut(T5, "lo_ui_config", "→ konfigurace", ["li_config"], { col: 1, row: 9 });
button("ui_btn_quarantine", "Vrátit karanténu k odeslání", 2, 10, [["fn_quarantine"]]);
fn(T5, "fn_quarantine", "Karanténa zpět", "quarantine-retry.js", { col: 1, row: 10, wires: [["lc_quarantine"]] });
dbBatch(T5, "lc_quarantine", { col: 2, row: 10 });
errorLog(T5, "ui", { col: 0, row: 12 });

// ---------------------------------------------------------------------------
// 6 Simulátor (vývoj): zprávy „jako z Arduina“ pro test bez hardwaru
// ---------------------------------------------------------------------------
const T6 = "tab_sim";
tab(T6, "6 Simulátor (vývoj)", "Ruční vložení řádků ve formátu protokolu, jako by přišly z Arduina. Na skutečném HW se nepoužívá.");
const sim = [
  ["sim_hello", "hello", { t: "hello", node: "node1", fw: "1.0.0", devices: [
    { id: "node1.btn1", type: "button" }, { id: "node1.btn2", type: "button" }, { id: "node1.btn3", type: "button" },
    { id: "node1.acc1", type: "accelerometer" }, { id: "node1.temp1", type: "thermometer" },
    { id: "node1.led1", type: "led" }, { id: "node1.led2", type: "led" }] }],
  ["sim_hb", "hb", { t: "hb", node: "node1", up: 60, seq: 1 }],
  ["sim_press", "stisk btn1", { t: "ev", id: "node1.btn1", e: "press", seq: 2 }],
  ["sim_tilt", "náklon 52°", { t: "ev", id: "node1.acc1", e: "tilt", v: 52, seq: 3 }],
  ["sim_move", "pohyb", { t: "ev", id: "node1.acc1", e: "move", seq: 4 }],
  ["sim_temp", "teplota 23 °C", { t: "m", id: "node1.temp1", v: 23, seq: 5 }],
  ["sim_err", "chyba DHT11", { t: "err", id: "node1.temp1", code: "sensorNotResponding", seq: 6 }],
];
sim.forEach(([id, name, message], i) => inject(T6, id, name, { col: 0, row: i, payload: JSON.stringify(message), wires: [["lo_sim"]] }));
inject(T6, "sim_hb_auto", "hb každých 5 s (zapnout pro delší test)", { col: 0, row: sim.length, repeat: 5, payload: JSON.stringify({ t: "hb", node: "node1", up: 120 }), wires: [["lo_sim"]], disabled: true });
linkOut(T6, "lo_sim", "→ příjem řádku", ["li_sim"], { col: 1, row: 3 });

// ---------------------------------------------------------------------------
// Propojení link uzlů v obou směrech a kontrola
// ---------------------------------------------------------------------------
const byId = new Map(nodes.map((n) => [n.id, n]));
for (const n of nodes) {
  if (n.type === "link out" && n.mode === "link") {
    for (const target of n.links) {
      const li = byId.get(target);
      if (!li || li.type !== "link in") throw new Error(`${n.id}: neznámý link in ${target}`);
      li.links.push(n.id);
    }
  }
  if (n.type === "link call" && byId.get(n.links[0])?.type !== "link in") throw new Error(`${n.id}: neznámý cíl ${n.links[0]}`);
  for (const out of n.wires ?? []) for (const target of out) if (!byId.has(target)) throw new Error(`${n.id}: neznámý uzel ${target}`);
  if (n.type === "function" && n.wires.length !== n.outputs) throw new Error(`${n.id}: počet výstupů ${n.outputs} ≠ wires ${n.wires.length}`);
}
const ids = nodes.map((n) => n.id);
const dup = ids.find((id, i) => ids.indexOf(id) !== i);
if (dup) throw new Error(`duplicitní id ${dup}`);

const out = path.join(ROOT, "flows.json");
fs.writeFileSync(out, JSON.stringify(nodes, null, 2) + "\n", "utf8");
const count = (type) => nodes.filter((n) => n.type === type).length;
console.log(`flows.json: ${nodes.length} uzlů (${count("tab")} záložek, ${count("function")} function, ${count("http request")} http request, ${count("sqlite")} sqlite)`);

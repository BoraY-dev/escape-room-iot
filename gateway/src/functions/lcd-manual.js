// Ruční text na LCD z dashboardu. Povel jde na první online displej a text se uloží pro obnovu
// po restartu nodu. Ukládá se jen v paměti, restart gateway ho neobnoví.
// Vstup: formulář { l1, l2 }. Výstup: povel pro sériovou frontu.
const gw = global.get("gw");
const S = global.get("state");
const now = Date.now();

const display = Object.values(S.nodes)
  .filter((n) => now - n.lastSeen <= gw.NODE_OFFLINE_MS)
  .flatMap((n) => n.devices ?? [])
  .find((d) => d.type === "display");
if (!display) {
  gw.pushError(S, "LCD", "žádný online node s displejem (firmware s ENABLE_EXTENSIONS = 1?)");
  node.status({ fill: "red", shape: "ring", text: "bez displeje" });
  return null;
}

const cmd = gw.lcdCommand(display.id, [msg.payload?.l1, msg.payload?.l2]);
(S.displays ??= {})[display.id] = [cmd.l1, cmd.l2];
node.status({ fill: "green", shape: "dot", text: `${display.id}: ${cmd.l1} / ${cmd.l2}` });
return { topic: "send", payload: cmd };

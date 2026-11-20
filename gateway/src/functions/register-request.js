// Registrace gateway jednorázovým kódem (dashboard nebo REGISTRATION_CODE). Kód se neukládá ani neloguje.
const gw = global.get("gw");
const S = global.get("state");
const code = String(msg.payload?.code ?? "").trim();
if (!code) return null;
if (!env.get("CLOUD_URL")) {
  S.registration = { ok: false, message: "chybí CLOUD_URL" };
  return null;
}
if (S.identity?.token) {
  S.registration = { ok: false, message: "gateway už je registrovaná" };
  return null;
}
node.status({ fill: "blue", shape: "dot", text: "registruji…" });
// nová zpráva: z formuláře se dál nepřenáší nic jiného
return gw.cloudRequest(env.get("CLOUD_URL"), "POST", "/gateway/register", { registrationCode: code }, null);

// Cloudový heartbeat každých 30 s: úplný seznam právě dostupných zařízení a lokálně uložená revize
// konfigurace. Heartbeat se neukládá do fronty – po výpadku se posílá jen aktuální stav.
const gw = global.get("gw");
const S = global.get("state");
if (!S.ready || !S.identity?.token || !env.get("CLOUD_URL")) return null;
const body = {
  scenarioRevision: S.config?.scenario?.revision ?? 0, // 0 = gateway zatím nemá konfiguraci
  deviceList: gw.availableDevices(S.nodes, Date.now()),
};
return gw.cloudRequest(env.get("CLOUD_URL"), "POST", "/gateway/heartbeat", body, S.identity.token);

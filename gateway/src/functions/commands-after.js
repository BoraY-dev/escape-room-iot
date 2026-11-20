// Po zápisu: pošle povely nodu (LED, reset) a potvrdí provedené povely v cloudu (gateway/ackCommands).
// Výstupy: 1 povely pro node, 2 HTTP požadavek ackCommands
const gw = global.get("gw");
const S = global.get("state");
const ackIds = (msg.ackIds ?? []).slice(0, 100);
if (!ackIds.length || !S.identity?.token) {
  flow.set("busy_commands", 0);
  return [msg.serial ?? [], null];
}
const request = gw.cloudRequest(env.get("CLOUD_URL"), "POST", "/gateway/ackCommands", { commandIdList: ackIds }, S.identity.token);
return [msg.serial ?? [], { ...request, ackIds }];

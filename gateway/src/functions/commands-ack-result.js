// Výsledek potvrzení povelů. Při ztracené odpovědi se opakuje jen potvrzení, akce se neprovádí znovu.
// Povel, který cloud už nezná (retence 7 dní), se vyřadí z opakování a zapíše se do diagnostiky.
const gw = global.get("gw");
const S = global.get("state");
const cls = gw.classifyResponse(msg.statusCode, msg.payload, msg.headers ?? {});
const now = Date.now();
let ids = [];
let note = null;
if (cls.kind === "ok") {
  ids = msg.payload.acknowledgedCommandIdList ?? [];
} else if (cls.kind === "dataError" && cls.errorCodes.some((c) => c.endsWith("/gatewayCommandDoesNotExist"))) {
  const entry = Object.values(msg.payload.uuAppErrorMap).find((e) => e.type === "error");
  ids = entry?.paramMap?.commandIdList ?? [];
  note = "unknownInCloud";
  gw.pushError(S, "povely", `cloud nezná povely: ${ids.join(", ")}`);
}
if (!ids.length) {
  flow.set("busy_commands", 0);
  return null;
}
msg.topic = gw.transaction([
  `UPDATE command_log SET state = 'confirmed', confirmedAt = ${gw.lit(now)}, lastError = ${gw.lit(note)} WHERE commandId IN (${gw.sqlList(ids)})`,
]);
return msg;

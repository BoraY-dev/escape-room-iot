// Každou hodinu: retence. Cloudem potvrzená data po 24 h (diagnostika ze stejného herního dne),
// potvrzené povely po 7 dnech (aby se povel neprovedl dvakrát). Neodeslaná data a karanténa zůstávají.
const gw = global.get("gw");
const now = Date.now();
msg.topic = gw.transaction([
  `DELETE FROM outbox WHERE state = 'confirmed' AND confirmedAt < ${gw.lit(now - 24 * 3600 * 1000)}`,
  `DELETE FROM command_log WHERE state = 'confirmed' AND confirmedAt < ${gw.lit(now - 7 * 24 * 3600 * 1000)}`,
]);
return msg;

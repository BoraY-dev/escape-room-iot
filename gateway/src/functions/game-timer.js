// Každých 5 s: po vypršení časového limitu zastaví místní vyhodnocování pravidel.
// Událost gameExpired gateway neposílá – vypršení hry odvodí cloud ze svého časovače.
const gw = global.get("gw");
const S = global.get("state");
const now = Date.now();
if (!gw.gameExpired(S.game, now)) return null;
S.game = { ...S.game, state: "expired" };
node.status({ fill: "grey", shape: "dot", text: `hra ${S.game.gameId} vypršela` });
msg.topic = gw.transaction([gw.kvUpsertSql("game", S.game, now)]);
return msg;

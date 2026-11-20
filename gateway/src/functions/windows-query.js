// Každých 10 s: najde uzavřená okna teploty (okno [start, start + 5 min) už skončilo).
// Po restartu tak uzavře i okna, která zůstala otevřená před výpadkem.
const gw = global.get("gw");
// parametry jako pole (uzel SQLite: délka pole = počet "$" v dotazu)
msg.topic = "SELECT hwId, windowStart, group_concat(value) AS vals FROM samples WHERE windowStart <= $1 GROUP BY hwId, windowStart";
msg.payload = [Date.now() - gw.WINDOW_SEC * 1000];
return msg;

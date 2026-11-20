// Každých 5 s: počty položek fronty podle stavu pro dashboard.
msg.topic = "SELECT kind, state, count(*) AS n, min(createdAt) AS oldest FROM outbox GROUP BY kind, state";
msg.payload = [];
return msg;

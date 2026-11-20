// HTTPS požadavek na cloud (gateway/sendEvents nebo gateway/sendMeasurements) s tokenem gateway.
const gw = global.get("gw");
const S = global.get("state");
const path = msg.batch.kind === "event" ? "/gateway/sendEvents" : "/gateway/sendMeasurements";
Object.assign(msg, gw.cloudRequest(env.get("CLOUD_URL"), "POST", path, msg.body, S.identity?.token));
delete msg.topic;
delete msg.body;
return msg;

// Povely k provedení (received) a provedené, ale v cloudu zatím nepotvrzené (executed), v pořadí cloudu.
msg.topic = "SELECT commandId, type, payload, state FROM command_log WHERE state IN ('received', 'executed') ORDER BY createdAt, commandId";
msg.payload = [];
return msg;

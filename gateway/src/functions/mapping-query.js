// Položky fronty, které čekají na cloudové deviceId (vznikly dřív, než heartbeat zařízení zaregistroval).
msg.topic = "SELECT seq, hwId, payload FROM outbox WHERE state = 'waitingMapping' ORDER BY seq LIMIT 500";
msg.payload = [];
return msg;

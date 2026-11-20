// Tlačítko na dashboardu: po odstranění příčiny vrátí záznamy z karantény k odeslání (obsah se nemění).
const gw = global.get("gw");
msg.topic = gw.transaction(["UPDATE outbox SET state = 'pending', nextAttemptAt = 0, attempts = 0 WHERE state = 'quarantined'"]);
return msg;

// Založí tabulky (pokud chybí) a vrátí nedokončená odeslání zpět do fronty:
// cloud mohl dávku přijmout a odpověď se ztratila – pošle se znovu se stejnými klíči.
const gw = global.get("gw");
msg.topic = `${gw.SCHEMA}\nUPDATE outbox SET state = 'pending' WHERE state = 'inFlight';`;
return msg;

// Dotaz na uložený stav (identita, konfigurace, mapování zařízení, hra, LED).
msg.topic = "SELECT key, value FROM kv";
msg.payload = [];
return msg;

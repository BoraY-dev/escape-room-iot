// Dávka v transakci selhala uprostřed: zrušit rozpracovanou transakci, aby nezůstala otevřená.
msg.topic = "ROLLBACK";
return msg;

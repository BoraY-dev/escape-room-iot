// [On Stop] Zastaví časovač čekání na ack.
const st = context.get("st");
if (st?.active?.timer) clearTimeout(st.active.timer);
context.set("st", undefined);

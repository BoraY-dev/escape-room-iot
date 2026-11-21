// Po zápisu do databáze odešle povely nodu a spustí odesílání do cloudu.
// Výstupy: 1 povely pro node, 2 podnět pro odesílač podle msg.kind ("none" = nic k odeslání)
const commands = (msg.nodeCommands ?? []).map((c) => ({ topic: "send", payload: c }));
const kind = msg.kind ?? "event";
return [commands, kind === "none" ? null : { payload: kind }];

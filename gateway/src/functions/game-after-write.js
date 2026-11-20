// Po zápisu do databáze: pošle LED povely nodu a spustí odeslání do cloudu.
// Výstupy: 1 povely pro node, 2 podnět pro odesílač (event / measurement)
const commands = (msg.ledCommands ?? []).map((c) => ({ topic: "send", payload: c }));
return [commands, { payload: msg.kind ?? "event" }];

// Po uložení identity: stáhnout konfiguraci, poslat heartbeat a spustit odesílání nashromážděných dat.
// Výstupy: 1 konfigurace, 2 heartbeat, 3 odesílače
return [{ payload: "registered" }, { payload: "registered" }, [{ payload: "event" }, { payload: "measurement" }]];

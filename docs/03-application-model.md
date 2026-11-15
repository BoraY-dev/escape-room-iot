# Application Model

> Bude doplněno v dalších milnících.

- **Návrh backendu** (týden 6): endpointy, datový model, autentizace gateway.
- **Technické řešení IoT části** (týden 7): formát zpráv přes UART, Node-RED flow, downsampling, retence dat.
- **Návrh frontendu** (týden 9): routy, komponenty, wireframy.

## Podstránky (návrh backendu)

- [Persistence Layer](03-application-model/persistence-layer.md) – kolekce MongoDB, indexy, retence, limity, DAO metody
- [Application Profiles](03-application-model/application-profiles.md) – role Operators, GameMasters, Gateways
- [Command List – webová aplikace](03-application-model/command-list-webapp.md) – místnosti, zařízení, scénář, hádanky, řízení hry
- [Command List – gateway](03-application-model/command-list-gateway.md) – registrace, konfigurace, heartbeat, odesílání dat, povely

## Podstránky (technické řešení IoT)

- [Hardware IoT Node a gateway](03-application-model/iot-hardware.md) – součástky, piny, zapojení (podle datasheetů, k ověření)
- [Firmware IoT Node](03-application-model/iot-node.md) – struktura programu, senzory, povely, chyby a zotavení
- [Komunikace IoT Node ↔ Gateway](03-application-model/iot-protocol.md) – formát zpráv, downsampling, retence, sekvenční diagramy

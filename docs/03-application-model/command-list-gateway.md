# Command List – gateway

> Zdroj pro stránku **BIOT DL Application Model – Tým 1 → Command List** (část gateway).
> Navazuje na [Command List webové aplikace, kapitolu 8](command-list-webapp.md#8-rozhraní-ke-gateway),
> [Application Profiles](application-profiles.md) a [Persistence Layer](persistence-layer.md).

## Přehled commandů

| Command | Metoda | Profily | Účel |
|---|---|---|---|
| `gateway/create` | POST | Operators | založení gateway a jednorázového kódu |
| `gateway/register` | POST | bez tokenu, registrační kód | aktivace gateway |
| `gateway/getConfig` | GET | Gateways | konfigurace a pravidla |
| `gateway/sendEvents` | POST | Gateways | dávka nejvýše 100 událostí |
| `gateway/sendMeasurements` | POST | Gateways | dávka nejvýše 100 měření |
| `gateway/heartbeat` | POST | Gateways | přítomnost gateway a zařízení |
| `gateway/getCommands` | GET | Gateways | vyzvednutí nepotvrzených povelů |
| `gateway/ackCommands` | POST | Gateways | potvrzení zpracovaných povelů |
| `gateway/delete` | POST | Operators | odpojení a smazání gateway |

Celkem **9 commandů**. Přehled gateway ve webu poskytují `room/get` a `room/list`;
`gateway/list` zmíněný v závěru webového seznamu není pro tento rozsah potřeba.

## 1. Konvence

Endpoint má tvar `/<entita>/<akce>`. POST přijímá dtoIn jako JSON, GET jako query string.
Platí typový zápis a společné chyby z webového Command Listu: `invalidDtoIn` (400),
`unsupportedKeys` (varování), `userNotAuthenticated` (401), `userNotAuthorized` (403)
a `<entita>DoesNotExist` (404). Plný kód je `escape-room-iot/<command>/<chyba>`.
Každý dtoOut, včetně chybové odpovědi, obsahuje `uuAppErrorMap`.
`id()` označuje ObjectId, `datetime()` ISO 8601 v UTC, `uuid()` UUID.
Neznámé klíče se ignorují s varováním, nenahrazují povinné atributy.

Pouze HTTPS. Kromě registrace je nutné `Authorization: Bearer <token>`.
Web používá uživatelský token, gateway vlastní token vázaný na `gatewayId`.
Server z tokenu odvodí `venueId` a `roomId`; gateway je v dtoIn neposílá.
Všechny odkazy se ověřují v její místnosti, povely také podle `gatewayId`.
Cizí objekt vrací stejnou 404 jako neexistující. Token smazané či zablokované gateway vrací 401.
Registrační kód ani token se nelogují a ukládají se pouze jako hash.

**Rozhodnutí návrhu:** heartbeat každých 30 s, online do 60 s od posledního kontaktu;
vyzvedávání povelů každé 2 s bez souběžných požadavků. Konfigurace vrací tyto intervaly.
Chyby spojení a 5xx gateway opakuje s rostoucím odstupem, při 429 respektuje `Retry-After`.
Neodeslaná data drží trvale na disku bez časového omezení; úspěšně potvrzená ponechá 24 h
pro diagnostiku. Registrační kód platí 24 h dle Limit Listu.

## 2. Registrace a správa gateway

### gateway/create

**Metoda:** `POST /gateway/create` · **Profily:** Operators · **Use case:** BUC01

```js
const gatewayCreateDtoInType = shape({
  roomId: id().isRequired(),
  name: string(1, 100).isRequired()
});
```

**dtoOut**

```json
{
  "id": "<gatewayId>", "roomId": "<roomId>", "name": "RPi Pirát", "state": "pending",
  "registrationCode": "<jednorázový náhodný kód>",
  "registrationCodeExpiresAt": "2026-11-09T12:00:00Z", "uuAppErrorMap": {}
}
```

**Kroky**

1. Zvaliduje vstup a načte místnost vlastní provozovny.
2. Ověří, že místnost nemá gateway a hra není `running` ani `paused`.
3. Vygeneruje kryptograficky náhodný kód (alespoň 128 bitů entropie), uloží jeho hash,
   expiraci za 24 h a gateway ve stavu `pending`. Unikátní index `roomId` chrání i souběžné založení.
4. Vrátí kód pouze v této odpovědi. Nový kód se v MVP získá smazáním pending gateway a novým vytvořením.

| Chyba | Typ | HTTP | Popis |
|---|---|---|---|
| `roomDoesNotExist` | chyba | 404 | Místnost není dostupná volajícímu. |
| `roomHasGateway` | chyba | 409 | Místnost už má gateway včetně pending registrace. |
| `gameInProgress` | chyba | 409 | Probíhá nebo je pozastavená hra. |

### gateway/register

**Metoda:** `POST /gateway/register` · **Profily:** výjimka před autentizací, jednorázový kód · **Use case:** BUC01

```js
const gatewayRegisterDtoInType = shape({
  registrationCode: string(1, 256).isRequired()
});
```

**dtoOut**

```json
{
  "gatewayId": "<id>", "roomId": "<id>", "state": "active",
  "accessToken": "<tajný token gateway>", "heartbeatIntervalSec": 30,
  "uuAppErrorMap": {}
}
```

**Kroky:** ověří kód, expiraci a stav `pending`. Atomicky spotřebuje kód,
aktivuje gateway, uloží hash nového náhodného tokenu a nastaví `lastSeenAt` na čas serveru.
Odstraní hash kódu i expiraci. Ze dvou souběžných registrací uspěje jen jedna.
Token vrátí pouze při registraci; gateway ho bezpečně uloží na disk před dalším provozem.
Endpoint omezuje četnost pokusů (429).

| Chyba | Typ | HTTP | Popis |
|---|---|---|---|
| `invalidRegistrationCode` | chyba | 401 | Kód neexistuje, vypršel nebo byl spotřebován; jednotná odpověď. |

Při ztrátě úspěšné odpovědi se kód znovu nepoužije. Provozovatel gateway smaže a vytvoří novou registraci.

### gateway/delete

**Metoda:** `POST /gateway/delete` · **Profily:** Operators · **Use case:** BUC01, BUC02

```js
const gatewayDeleteDtoInType = shape({ id: id().isRequired() });
```

**dtoOut:** `{ "uuAppErrorMap": {} }`

**Kroky:** načte gateway vlastní provozovny, odmítne běžící či pozastavenou hru,
zneplatní token i registrační kód a smaže gateway včetně jejích povelů.
Autorizace a zápisy gateway musí být se smazáním koordinované, aby souběžný požadavek po odpojení nezapsal další data.
Zařízení, scénář, pravidla, měření a historie her zůstanou v místnosti.
Nová gateway dostane nový token a převezme existující zařízení podle `hwId`.
Protože `lastSeenAt` zařízení zůstává, web počítá `device.online` pouze při současně online gateway;
bez gateway jsou všechna zařízení offline. Pending nová gateway zařízení oživí až čerstvým heartbeat.

| Chyba | Typ | HTTP | Popis |
|---|---|---|---|
| `gatewayDoesNotExist` | chyba | 404 | Gateway není dostupná volajícímu. |
| `gameInProgress` | chyba | 409 | Probíhá nebo je pozastavená hra. |

## 3. Konfigurace a přítomnost zařízení

### gateway/getConfig

**Metoda:** `GET /gateway/getConfig` · **Profily:** Gateways · **Use case:** BUC01, BUC03

```js
const gatewayGetConfigDtoInType = shape({});
```

**dtoOut**

```json
{
  "gatewayId": "<id>", "roomId": "<id>", "serverTime": "2026-11-08T12:00:00Z",
  "heartbeatIntervalSec": 30, "commandPollIntervalSec": 2, "batchSize": 100,
  "downsampling": { "sampleIntervalSec": 10, "windowSec": 300, "aggregation": "mean" },
  "deviceList": [{ "id": "<id>", "hwId": "node1.btn1", "type": "button", "name": "Tlačítko" }],
  "scenario": { "id": "<id>", "revision": 7, "timeLimitMin": 60, "hintDeviceId": null, "puzzleList": [] },
  "currentGame": null,
  "uuAppErrorMap": {}
}
```

`scenario` má stejný tvar jako dtoOut `scenario/get` bez vnořeného `uuAppErrorMap`,
včetně úplných `ruleList` u hádanek. `currentGame` je null nebo hra jako ve webovém seznamu
včetně `scenarioRevision` (bez vnořeného `uuAppErrorMap`). Konfigurace neobsahuje tokeny ani kódy.

**Kroky:** načte konzistentní snímek místnosti, zařízení, scénáře, hádanek a aktuální hry.
Vrátí úplnou konfiguraci a zaznamená `syncedScenarioRevision` jako odeslanou revizi.
Tato hodnota nedokazuje, že odpověď gateway přijala. Heartbeat hlásí revizi skutečně uloženou na gateway.
Gateway konfiguraci uloží atomicky na disk a při výpadku používá poslední úspěšnou kopii.
Stahuje ji při startu a při rozdílu revize z heartbeat. Nesmí vyhodnocovat hru s jinou revizí;
`resetRoom` nejprve zajistí správnou konfiguraci. Teplota se pro pravidla vyhodnocuje z okamžitých vzorků,
pro monitoring se odesílá průměr za pětiminutové UTC okno (nižší objem dat, zachování trendu).

**Chyby:** `roomDoesNotExist`, `scenarioDoesNotExist` (404).

### gateway/heartbeat

**Metoda:** `POST /gateway/heartbeat` · **Profily:** Gateways · **Use case:** BUC02, monitoring US03

```js
const gatewayHeartbeatDtoInType = shape({
  scenarioRevision: integer(0, null).isRequired(), // 0 = zatím nemá konfiguraci
  deviceList: array(shape({
    hwId: string(1, 30).isRequired(),
    type: oneOf(["button", "accelerometer", "thermometer", "led"]).isRequired()
  }), 0, 32).isRequired()
});
```

**dtoOut**

```json
{
  "serverTime": "2026-11-08T12:00:30Z", "scenarioRevision": 7, "configChanged": false,
  "pendingCommandCount": 0,
  "deviceList": [{ "hwId": "node1.btn1", "id": "<deviceId>" }],
  "uuAppErrorMap": {}
}
```

**Kroky**

1. Validuje celý seznam, duplicity `hwId`, typy existujících zařízení a limit celkem 32 zařízení místnosti.
2. Pro neznámé `hwId` založí zařízení (`name = hwId`); při kolizi se stávajícím uživatelským názvem
   vrátí `deviceNameAlreadyExists` místo přepsání zařízení. Vrátí mapování na cloudová `deviceId`.
3. Nastaví `gateway.lastSeenAt` a `lastSeenAt` přítomných zařízení na čas přijetí serverem.
   Existující názvy, typy a `lastValue` nepřepisuje. Chybějící zařízení nemaže ani jim neobnovuje čas.
4. Porovná skutečnou revizi gateway s revizí scénáře a vrátí `configChanged`.

Seznam je úplný snímek **právě dostupných** zařízení, včetně neaktivního tlačítka a LED.
Gateway ověřuje živost nodu pravidelnou komunikací po USB, nikoliv podle poslední herní události.
Odpojený node nesmí zůstávat v seznamu z cache. Heartbeat se neukládá do offline fronty ani nepřehrává po výpadku.
Zařízení bez čerstvého kontaktu je nejpozději za 60 s offline.

`hwId` je unikátní v **celé místnosti**: firmware/nastavení musí použít např. `node1.btn1` a `node2.btn1`.
Stejné `hwId` z více nodů gateway odmítne lokálně a oznámí závadu; nesloučí je do jednoho záznamu.
Server chrání unikátní index `(roomId, hwId)`, ale sám fyzickou duplicitu mezi nody rozpoznat nemůže.

| Chyba | Typ | HTTP | Popis |
|---|---|---|---|
| `duplicateHwId` | chyba | 400 | Seznam obsahuje stejné hwId vícekrát. |
| `deviceTypeMismatch` | chyba | 400 | Existující hwId má jiný typ. |
| `deviceLimitExceeded` | chyba | 409 | Nová zařízení by překročila limit 32. |
| `deviceNameAlreadyExists` | chyba | 409 | Výchozí název nového zařízení už používá jiné zařízení. |

Validace a založení zařízení tvoří jeden celek; při chybě se snímek neaplikuje částečně.

## 4. Dávkové odesílání dat

Oba commandy přijímají 1–100 záznamů, větší fronta se rozdělí. Nejdřív se validuje celá dávka včetně
vazeb; při 400/404/409 se nezapíše nic. Při neočekávané chybě nebo ztrátě odpovědi může být výsledek
nejistý: gateway opakuje stejné identifikátory a obsah. Z fronty odebere jen potvrzené položky.
`acceptedCount` označuje nové záznamy, `duplicateCount` již uložené shodné záznamy.
Při úspěchu je jejich součet roven velikosti dávky. Identifikátor s odlišným obsahem je konflikt,
nikoliv úspěšná duplicita. Žádná příchozí data nesmějí přepsat dříve uložený záznam.

### gateway/sendEvents

**Metoda:** `POST /gateway/sendEvents` · **Profily:** Gateways · **Use case:** BUC06, přenos událostí

```js
const gatewaySendEventsDtoInType = shape({
  eventList: array(shape({
    gatewayEventId: uuid().isRequired(),
    occurredAt: datetime().isRequired(),
    gameId: id(),
    deviceId: id(),
    puzzleId: id(),
    type: oneOf(["deviceEvent", "puzzleSolved", "hintRequested"]).isRequired(),
    value: shape({ event: oneOf(["press", "tilt", "move"]), value: number() })
  }), 1, 100).isRequired()
});
```

**dtoOut**

```json
{
  "acceptedCount": 1, "duplicateCount": 1,
  "acceptedEventIdList": ["<UUID nové události>"],
  "duplicateEventIdList": ["<UUID již uložené události>"], "uuAppErrorMap": {}
}
```

**Kroky**

1. Ověří UUID, časy a všechny odkazy v místnosti. `gameId` může odkazovat i na starou hru.
   `deviceEvent` vyžaduje `deviceId` a `value.event`: button/press, accelerometer/tilt (value 0–180) nebo move.
   `puzzleSolved` vyžaduje `gameId` a `puzzleId` obsažené v `game.puzzleStateList`.
   `hintRequested` vyžaduje `gameId` a tlačítko `deviceId`. Nepříslušná pole se odmítnou jako `invalidEvent`.
   Teplota ani řídicí události webu nejsou povolené.
2. Nastaví `source: gateway`, místnost a provozovnu z autentizace. Uloží události
   s unikátností `(roomId, gatewayEventId)`; UUID gateway přidělí při vzniku a uloží před odesláním.
3. **Atomicky s vložením nové události** aplikuje efekt na hru (transakce MongoDB).
   Pouhý insert následovaný samostatným zvýšením počitadla nestačí: pád mezi nimi by efekt ztratil.
   Duplicitní událost efekt nikdy neopakuje. V jedné dávce se události zpracují v pořadí pole.
4. Pozdní událost se uloží vždy, ale hru mění pouze při shodě s `room.currentGameId`
   a stavu `running` nebo `paused`. `puzzleSolved` mění dosud nevyřešenou hádanku na solved;
   poslední vyřešená hádanka ukončí hru jako `completed`. `hintRequested` zvýší `hintCount`.
   Událost bez gameId se dodatečně nepřiřazuje aktuální hře.
5. U zařízení aktualizuje `lastValue` pouze novější událostí; `lastSeenAt` posune nejvýše na `occurredAt`,
   nikdy zpět ani do budoucnosti. Historická dávka nesmí oživit odpojené zařízení.

Identifikátory, čas vzniku a obsah jsou při opakování neměnné. Nová UUID pro retry jsou zakázaná.
Události z budoucnosti za tolerancí 60 s se odmítnou; gateway synchronizuje hodiny.
Unikátnost platí po dobu uchování v cloudu (90 dní); gateway již potvrzené události po TTL znovu neposílá.

| Chyba | Typ | HTTP | Popis |
|---|---|---|---|
| `deviceDoesNotExist`, `gameDoesNotExist`, `puzzleDoesNotExist` | chyba | 404 | Nedostupný odkaz. |
| `invalidEvent` | chyba | 400 | Nepovolená kombinace typu, atributů nebo času. |
| `eventTypeNotSupported` | chyba | 400 | Zařízení nepodporuje událost. |
| `eventIdConflict` | chyba | 409 | Stejné UUID má jiný obsah (i uvnitř dávky). |
| `lateEvent` | varování | – | Uloženo bez změny hry; paramMap obsahuje gatewayEventIdList. |

### gateway/sendMeasurements

**Metoda:** `POST /gateway/sendMeasurements` · **Profily:** Gateways · **Use case:** monitoring US03

```js
const gatewaySendMeasurementsDtoInType = shape({
  measurementList: array(shape({
    deviceId: id().isRequired(),
    value: number().isRequired(),
    sampleCount: integer(1, null).isRequired(),
    windowStart: datetime().isRequired(),
    windowEnd: datetime().isRequired()
  }), 1, 100).isRequired()
});
```

**dtoOut**

```json
{
  "acceptedCount": 1, "duplicateCount": 0,
  "acceptedMeasurementList": [{ "deviceId": "<id>", "windowStart": "2026-11-08T12:00:00Z" }],
  "duplicateMeasurementList": [], "uuAppErrorMap": {}
}
```

**Kroky:** ověří teploměr ve vlastní místnosti, konečné číselné hodnoty a dokončené okno
`windowStart < windowEnd <= serverTime + 60 s`. Standard je UTC okno 300 s zarovnané na násobky pěti minut,
interval `[windowStart, windowEnd)`. Při chybějících vzorcích se průměrují jen dostupné; bez vzorků záznam nevzniká.
Uloží s unikátním klíčem **`deviceId` + `windowStart`**, duplicity potvrdí bez dalšího vložení.
Po odeslání se agregát nemění. Historické měření není důkaz aktuální online přítomnosti.
`lastValue` teploměru lze aktualizovat novějším oknem jako `{ event: temperature, value }`;
`lastSeenAt` se nikdy neposune zpět ani na čas přijetí historické dávky.

| Chyba | Typ | HTTP | Popis |
|---|---|---|---|
| `deviceDoesNotExist` | chyba | 404 | Zařízení není ve vlastní místnosti. |
| `deviceTypeMismatch` | chyba | 400 | Zařízení není teploměr. |
| `invalidMeasurementWindow` | chyba | 400 | Neplatné, nezarovnané nebo dosud neukončené okno. |
| `measurementConflict` | chyba | 409 | Stejný klíč okna má jiný obsah. |

## 5. Vyzvednutí a potvrzení povelů

### gateway/getCommands

**Metoda:** `GET /gateway/getCommands` · **Profily:** Gateways · **Use case:** BUC05, BUC06

```js
const gatewayGetCommandsDtoInType = shape({
  limit: integer(1, 100) // výchozí 100
});
```

**dtoOut**

```json
{
  "itemList": [{ "id": "<commandId>", "type": "pauseGame", "payload": { "gameId": "<id>" },
    "createdAt": "2026-11-08T12:00:00Z" }],
  "hasMore": false, "uuAppErrorMap": {}
}
```

**Kroky:** vrátí nejstarší `pending` povely vlastní gateway, řazené podle `createdAt`, při shodě podle `id`.
Odpověď má `Cache-Control: no-store`. Pouhé vyzvednutí **nemění** stav a nemaže povel.
Dokud gateway nepotvrdí zpracování, dostává stejný povel znovu. Prázdná fronta vrací prázdné `itemList`.

| type | payload | Zpracování gateway |
|---|---|---|
| `resetRoom` | `gameId`, `scenarioRevision` | zajistí pravidla správné revize, nastaví novou hru, zruší vyřešení hádanek a zhasne LED |
| `startGame` | `gameId`, `startedAt`, `timeLimitMin` | začne vyhodnocovat pravidla |
| `pauseGame` / `resumeGame` | `gameId` | pozastaví / obnoví vyhodnocování |
| `stopGame` | `gameId`, `state` | ukončí vyhodnocování |
| `solvePuzzle` | `gameId`, `puzzleId`, `runActions` | označí vyřešení, případně provede akce |
| `unsolvePuzzle` | `gameId`, `puzzleId` | vrátí hádanku do nevyřešeného stavu |

Gateway zpracovává povely sériově v pořadí fronty a trvale eviduje zpracovaná `commandId`.
Opakované doručení již zpracovaného povelu pouze znovu potvrdí, neopakuje např. `runActions`.
Neúspěšný povel nepotvrdí, neopouští jej ve prospěch novějších; opakuje ho a hlásí závadu lokálně.
Potvrzená ID uchovává alespoň 7 dní od úspěšného potvrzení serverem, nepotvrzená bez časového omezení.
Při obnově spojení nejprve synchronizuje frontu; samotný snímek `currentGame` nesmí spouštět akce
ani být následně vrácen staršími povely bez vyřešení jejich pořadí.

Doručení je **alespoň jednou**. Pád mezi fyzickou akcí a zápisem na disk nelze samotným cloudovým ACK vyřešit:
node musí přijímat identifikátor povelu a potlačovat opakování, nebo akce musí být opakovatelné bez dalšího efektu
(např. nastavit LED na on). Tento požadavek patří i do sériového protokolu; API neslibuje přesně jedno fyzické provedení.

### gateway/ackCommands

**Metoda:** `POST /gateway/ackCommands` · **Profily:** Gateways · **Use case:** BUC05, BUC06

```js
const gatewayAckCommandsDtoInType = shape({
  commandIdList: array(id(), 1, 100).isRequired()
});
```

**dtoOut:** `{ "acknowledgedCommandIdList": ["<id>"], "uuAppErrorMap": {} }`

**Kroky**

1. Ověří všechna ID a příslušnost vlastní gateway. Při neplatném odkazu nepotvrdí nic.
2. U `pending` nastaví `state: delivered`, `deliveredAt` na čas serveru.
3. Již `delivered` vrátí jako úspěšně potvrzené, původní `deliveredAt` nemění.

Gateway potvrzuje až po úspěšném provedení a trvalém zaznamenání výsledku.
Ztracená odpověď na ACK vede k opakování ACK, nikoliv akce. `delivered` tedy znamená
potvrzené zpracování, nikoliv pouhé odeslání HTTP odpovědi. Potvrzení nevytváří znovu herní události webu.

| Chyba | Typ | HTTP | Popis |
|---|---|---|---|
| `gatewayCommandDoesNotExist` | chyba | 404 | Povel neexistuje nebo patří jiné gateway. |

Po cloudové retenci 7 dní může opakovaný ACK vrátit 404. Gateway podle své trvalé evidence
nesmí již provedenou akci zopakovat; neznámé ID vyřadí z opakování ACK a zaznamená diagnostiku.

## 6. Ověření návrhu při implementaci

| Situace | Očekávaný výsledek |
|---|---|
| Tlačítko hodinu nikdo nestiskne, node je připojený | Heartbeat obnovuje jeho lastSeenAt, zůstává online. |
| Node se odpojí | Gateway jej přestane hlásit, zařízení do 60 s přejde offline. |
| Dva nody mají btn1 | Musí dostat rozdílná hwId; fyzická kolize se nesmí sloučit. |
| Dvakrát stejný hintRequested včetně UUID | Jeden event a jediné zvýšení hintCount. |
| Pád serveru během vložení eventu a efektu | Transakce uloží obojí, nebo nic; retry neztratí ani neopakuje efekt. |
| Dvakrát stejné měření | Jeden záznam podle deviceId + windowStart. |
| Dávka 101 položek | invalidDtoIn (400), žádný zápis. |
| Historická událost po skončení hry | Uložena s varováním, hra ani aktuální online stav se neoživí. |
| Ztracená odpověď getCommands | Povel zůstane pending a přijde znovu. |
| Ztracená odpověď ackCommands | Retry ACK uspěje, fyzická akce se neopakuje. |
| Současná registrace stejným kódem | Právě jedna aktivace a jeden vydaný token. |
| Smazaná gateway použije starý token | 401, žádné další zápisy. |
| Cizí deviceId nebo commandId | 404, žádný únik dat jiné místnosti. |



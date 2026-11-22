# Komunikace IoT Node ↔ Gateway

> Zdroj pro stránky **BIOT DL Application Model – Tým 1 → IoT Node** a **IoT Gateway** (společná část).
> Firmware nodu popisuje `iot-node.md`, Node-RED flow `iot-gateway.md`, komunikaci gateway s cloudem
> Command List pro gateway (`command-list-gateway.md`).

## Přehled

IoT Node (Arduino Mega 2560) je s gateway (Raspberry Pi 5 s Node-RED) propojený **USB kabelem**,
který slouží zároveň jako napájení i jako sériová linka. Node o hře nic neví: hlásí, co se děje se senzory,
a vykonává povely. Pravidla hádanek, časy událostí a komunikaci s cloudem řeší gateway.

| Směr | Co se posílá |
|---|---|
| node → gateway | ohlášení zařízení (`hello`), události (`ev`), vzorky teploty (`m`), heartbeat nodu (`hb`), potvrzení povelu (`ack`), chyby (`err`) |
| gateway → node | nastavení LED (`led`), reset do výchozího stavu (`reset`), žádost o ohlášení (`who`) |

## 1. Fyzická vrstva

| Parametr | Hodnota |
|---|---|
| Rozhraní | USB (na Arduinu převodník USB ↔ UART), na RPi zařízení `/dev/ttyACM0` |
| Rychlost | **115 200 Bd**, 8 datových bitů, bez parity, 1 stop bit (8N1) |
| Kódování | ASCII / UTF-8 |
| Rámec | **jedna zpráva = jeden řádek** ukončený `\n` (gateway toleruje i `\r\n`) |
| Formát zprávy | JSON objekt na jednom řádku („JSON Lines“) |
| Max. délka | node → gateway **512 B** (`hello` se 7 zařízeními má asi 310 B, rezerva na další zařízení), gateway → node **128 B** (vejde se povel s nejdelším `hwId`, 30 znaků) |

**Proč JSON na řádek:** Node-RED zprávu rozparsuje jedním uzlem (`json`), formát je čitelný při ladění
v sériovém monitoru a nové typy zpráv nebo atributy se dají přidat, aniž by se rozbily stávající.
Arduino používá knihovnu ArduinoJson. Krátké klíče (`t`, `id`, `e`, `v`) šetří délku zpráv.

**Pozor na reset při otevření portu.** Arduino Mega se restartuje pokaždé, když gateway otevře sériový port
(signál DTR). Gateway proto po otevření portu čeká na zprávu `hello`. Když do 3 s nepřijde, pošle `who`.

## 2. Identifikace zařízení

Každý node má v firmwaru konstantu `NODE_ID` (např. `node1`). Zařízení na nodu mají `hwId` ve tvaru
**`<NODE_ID>.<zařízení>`**, takže jsou unikátní v celé místnosti i při více nodech (požadavek `gateway/heartbeat`).

| `hwId` | Typ | Události / povely |
|---|---|---|
| `node1.btn1`, `node1.btn2`, `node1.btn3` | `button` | událost `press` |
| `node1.acc1` | `accelerometer` | události `tilt`, `move` |
| `node1.temp1` | `thermometer` | vzorky teploty (`m`), DHT11 |
| `node1.led1` (zelená), `node1.led2` (červená) | `led` | povel `led` |

Klávesnice, enkodér a LCD zapojené pro 2. fázi (`iot-hardware.md` kap. 6) jsou nové typy zařízení s vlastními
událostmi a povely, popsané v **kapitole 9**. Stávající zprávy se jimi nemění; firmware je ohlašuje jen
s přepínačem `ENABLE_EXTENSIONS = 1`.

## 3. Zprávy node → gateway

Každá zpráva nese `t` (typ). Zprávy kromě `hello` nesou `seq`: pořadové číslo od startu nodu (0–65535, pak znovu od 0).
Gateway podle mezery v `seq` pozná ztracený řádek a zaznamená to do diagnostiky. Zprávy se kvůli tomu neopakují:
sériová linka po USB je spolehlivá a ztráta je výjimečná.

**Čas vzniku** přiděluje gateway při přijetí řádku. Node nemá hodiny reálného času a zpoždění USB je v řádu milisekund.

### hello – ohlášení zařízení

Po startu nodu, jako odpověď na `who` a znovu, když se změní dostupnost zařízení (senzor selže nebo se obnoví).
Obsahuje **jen funkční zařízení**.

```json
{"t":"hello","node":"node1","fw":"1.0.0","devices":[{"id":"node1.btn1","type":"button"},{"id":"node1.btn2","type":"button"},{"id":"node1.btn3","type":"button"},{"id":"node1.acc1","type":"accelerometer"},{"id":"node1.temp1","type":"thermometer"},{"id":"node1.led1","type":"led"},{"id":"node1.led2","type":"led"}]}
```

Gateway podle `hello` sestaví seznam dostupných zařízení pro `gateway/heartbeat`.

### ev – událost

| Událost | Příklad | Kdy ji node pošle |
|---|---|---|
| `press` | `{"t":"ev","id":"node1.btn1","e":"press","seq":42}` | stisk tlačítka po ošetření zákmitů (30 ms); uvolnění se nehlásí |
| `tilt` | `{"t":"ev","id":"node1.acc1","e":"tilt","v":52,"seq":43}` | náklon (0–180° od svislé osy) se od poslední odeslané hodnoty změnil aspoň o **5°**; nejvýš 5× za sekundu |
| `move` | `{"t":"ev","id":"node1.acc1","e":"move","seq":44}` | zrychlení se odchýlí od klidové hodnoty (1 g) o víc než 0,3 g; poté 1 s pauza |

Prahy jako „náklon > 45°“ vyhodnocuje **gateway** podle pravidel hádanky. Node proto posílá změny náklonu průběžně.
Pásmo 5° zabrání tomu, aby šum akcelerometru kolem jedné hodnoty zaplavil linku zprávami.

### m – vzorek teploty

```json
{"t":"m","id":"node1.temp1","v":23,"seq":45}
```

Každých **10 s**, teplota ve °C. DHT11 měří v celých stupních; `v` je číslo, takže přesnější teploměr
v budoucnu může posílat desetinná místa beze změny protokolu. Gateway vzorek použije okamžitě pro pravidla
a zároveň ho započítá do downsamplingu (kapitola 6).

### hb – heartbeat nodu

```json
{"t":"hb","node":"node1","up":3600,"seq":46}
```

Každých **5 s**, `up` = sekundy od startu. Když gateway od nodu 15 s nic nepřijme, považuje ho za odpojený
a jeho zařízení přestane hlásit v `gateway/heartbeat`. Tlačítko, které nikdo nemačká, tak zůstává online.

### ack – potvrzení povelu

```json
{"t":"ack","cid":"17","ok":true,"seq":47}
{"t":"ack","cid":"18","ok":false,"err":"unknownDevice","seq":48}
```

### err – chyba nodu

```json
{"t":"err","id":"node1.acc1","code":"sensorNotResponding","seq":49}
```

| `code` | Význam |
|---|---|
| `sensorNotResponding` | senzor neodpovídá (GY-521 na sběrnici I2C, DHT11 nevrátil hodnotu) |
| `sensorOutOfRange` | hodnota mimo rozsah senzoru (DHT11: 0–50 °C) |
| `badMessage` | povel od gateway nešel přečíst (neplatný JSON nebo moc dlouhý řádek) |

Gateway chyby zobrazuje na dashboardu.

## 4. Zprávy gateway → node

Každý povel nese `cid`: identifikátor povelu, který gateway přiděluje (počítadlo, nejvýš 8 znaků).
Node odpoví `ack` se stejným `cid` do 100 ms.

| Povel | Příklad | Co node udělá |
|---|---|---|
| `led` | `{"t":"led","cid":"17","id":"node1.led1","s":"on"}` | nastaví zadanou LED (`led1` zelená, `led2` červená) na `on`, `off` nebo `blink` (1 Hz) |
| `reset` | `{"t":"reset","cid":"18"}` | zhasne všechny LED a vynuluje vnitřní stav (referenci náklonu); senzory dál měří |
| `who` | `{"t":"who","cid":"19"}` | pošle `hello` |

**Všechny povely nastavují absolutní stav** („LED zapnout“, ne „LED přepnout“). Když stejný povel přijde dvakrát,
výsledek je stejný. Díky tomu node nemusí hlídat duplicity, i když gateway povel zopakuje
(požadavek doručení „alespoň jednou“ z Command Listu pro gateway).

**Opakování:** když `ack` nepřijde do 500 ms, gateway povel zopakuje, nejvýš 3×. Opakování pokryje i povel
poškozený během čtení DHT11, kdy má node na několik milisekund vypnutá přerušení (`iot-node.md` kap. 5). Pak závadu zobrazí na dashboardu
a nahlásí ji v heartbeat jako nedostupné zařízení.

Povely z cloudu (`gatewayCommand`) gateway nepřeposílá nodu přímo. Překládá je na povely nodu:
`resetRoom` → `reset`, `solvePuzzle` s akcemi hádanky → odpovídající `led`.
Akce pravidel vyhodnocených na gateway vedou také na `led`.

## 5. Chybové stavy

| Situace | Chování |
|---|---|
| Node pošle neplatný JSON nebo neznámé `t` | gateway řádek zahodí a započítá do diagnostiky |
| Gateway pošle neplatný povel | node pošle `err` s `badMessage` |
| Povel na neznámé zařízení | node pošle `ack` s `ok:false` a `err:"unknownDevice"` |
| Neznámý typ povelu (`t`) | node pošle `ack` s `ok:false` a `err:"unknownCommand"` |
| Řádek delší než limit | příjemce zahazuje znaky až do nejbližšího `\n` |
| Odpojený USB kabel | gateway přestane dostávat `hb`, po 15 s označí node za odpojený, port otevírá znovu každých 5 s |
| Restart nodu | node pošle `hello`; gateway mu podle stavu hry znovu nastaví LED |

Neznámé atributy v jinak platné zprávě obě strany ignorují. Firmware a flow tak lze aktualizovat nezávisle.

## 6. Downsampling teploty

| Parametr | Hodnota |
|---|---|
| Vzorkování na nodu | každých 10 s |
| Okno | 5 minut, zarovnané na celé pětiminutové úseky UTC, interval `[windowStart, windowEnd)` |
| Agregace | **medián** vzorků v okně (při plném okně 30 vzorků) |
| Odesílá se | `value`, `sampleCount`, `windowStart`, `windowEnd` (`gateway/sendMeasurements`) |
| Okno bez vzorků | záznam nevzniká |

**Proč medián.** Teplotu v místnosti zkreslují krátké výkyvy: hráč vezme předmět s teploměrem do ruky,
nebo jedno měření teploměru ujede (DHT11 má přesnost jen ±2 °C). Průměr se jedním takovým výkyvem posune, medián ho ignoruje,
dokud tvoří menšinu okna. Pro přehled teploty místnosti je důležitá typická hodnota, ne jednotlivé špičky.

**Proč 5 minut.** Teplota místnosti se mění pomalu, takže z jedné hodnoty za 5 minut je trend dobře vidět.
Do cloudu jde 288 záznamů denně místo 8 640, tedy 30× méně dat a zápisů do databáze s omezenou kapacitou.

**Pravidla hádanek downsampling nepoužívají.** Podmínka typu „teplota > 30 °C“ se vyhodnocuje
z každého vzorku hned, aby hráč dostal okamžitou odezvu.

## 7. Retence dat na gateway

| Data | Retence | Zdůvodnění |
|---|---|---|
| neodeslané události a měření | **neomezeně** | požadavek zadání: při výpadku se data nesmí ztratit |
| odeslané (cloudem potvrzené) události a měření | **24 h** | stačí k dohledání problému ze stejného herního dne (porovnání s cloudem při reklamaci hry); pak už jsou data jen v cloudu |
| ID zpracovaných povelů z cloudu | 7 dní | stejně dlouho, jako je cloud drží (`gatewayCommand`), aby se povel neprovedl dvakrát |

Odhad velikosti za 24 h: asi 2 000 událostí po 200 B a 288 měření, celkem pod 1 MB. Úložiště RPi to unese
bez problémů a odeslaná data se mažou průběžně (jednou za hodinu), takže fronta nenarůstá.

## 8. Sekvenční diagramy

### Registrace gateway

```mermaid
sequenceDiagram
  actor P as Provozovatel
  participant W as Webová aplikace
  participant C as Cloud
  participant G as Gateway
  participant N as IoT Node
  P->>W: vytvoří gateway k místnosti
  W->>C: gateway/create
  C-->>W: registrační kód (platí 24 h)
  P->>G: zadá kód na dashboardu gateway
  G->>C: gateway/register
  C-->>G: přístupový token
  G->>G: uloží token do credentials Node-RED
  G->>C: gateway/getConfig
  C-->>G: zařízení, pravidla, revize
  N->>G: hello (seznam zařízení)
  G->>C: gateway/heartbeat (dostupná zařízení)
  C-->>G: deviceId nových zařízení
```

### Vyřešení hádanky náklonem

```mermaid
sequenceDiagram
  actor H as Hráč
  participant N as IoT Node
  participant G as Gateway
  participant C as Cloud
  participant W as Webová aplikace
  H->>N: nakloní truhlu
  N->>G: ev tilt v=52
  G->>G: pravidlo „náklon > 45°“ splněno, hádanka vyřešena
  G->>N: led on
  N-->>G: ack
  G->>G: uloží puzzleSolved do fronty (gatewayEventId)
  G->>C: gateway/sendEvents
  C-->>G: přijato
  G->>G: označí jako odeslané, smaže po 24 h
  W->>C: game/getCurrent (každé 2 s)
  C-->>W: hádanka vyřešena
```

### Výpadek internetu

```mermaid
sequenceDiagram
  actor H as Hráč
  participant N as IoT Node
  participant G as Gateway
  participant C as Cloud
  H->>N: stiskne tlačítko nápovědy
  N->>G: ev press
  G->>G: hintRequested do fronty
  G-xC: gateway/sendEvents (bez spojení)
  Note over G: hra běží dál, pravidla se vyhodnocují lokálně, data čekají ve frontě
  G->>C: po obnovení: gateway/sendEvents (stejná gatewayEventId, dávky po 100)
  C-->>G: přijato / duplicitní
  G->>C: gateway/heartbeat
  G->>C: gateway/getCommands
  C-->>G: povely zadané během výpadku (v pořadí)
```

## 9. Rozšíření (2. fáze): klávesnice, enkodér, LCD

Firmware 1.1.0 je obsluhuje, pokud je přeložený s `ENABLE_EXTENSIONS = 1` (`iot-node/escape-node/config.h`).
Ve výchozím nastavení (`0`) je vypnutý, protože současná gateway celé `hello` s neznámým typem zařízení odmítne
(`badHelloDevice`) a cloud typy `keypad`, `encoder`, `display` zatím nezná. Ověřeno na prototypu 21. 11. 2026.

### Zařízení

| `hwId` | Typ | Události / povely |
|---|---|---|
| `node1.kp1` | `keypad` | události `key`, `code` |
| `node1.enc1` | `encoder` | události `turn`, `press` |
| `node1.lcd1` | `display` | povel `lcd` |

Tato zařízení nejdou elektricky ověřit (LCD je zapojené jen pro zápis), proto jsou v `hello` vždy.
`hello` s 10 zařízeními má **421 B** (limit 512 B).

### Události

| Událost | Příklad | Kdy ji node pošle |
|---|---|---|
| `key` | `{"t":"ev","id":"node1.kp1","e":"key","v":"7","seq":50}` | každý stisk klávesy (`0`–`9`, `A`–`D`, `*`, `#`) po ošetření zákmitů; gateway jím může např. ukazovat průběh zadávání |
| `code` | `{"t":"ev","id":"node1.kp1","e":"code","v":"1234","seq":51}` | klávesa `#` odešle rozepsaný kód (1–8 znaků z `0`–`9`, `A`–`D`); `*` rozepsaný kód smaže; prázdný kód se neposílá |
| `turn` | `{"t":"ev","id":"node1.enc1","e":"turn","v":7,"seq":52}` | poloha enkodéru se změnila; `v` = **absolutní poloha 0–19** (20 zarážek na otáčku, dokola jako ciferník), doprava roste; nejvýš 10× za sekundu |
| `press` | `{"t":"ev","id":"node1.enc1","e":"press","seq":53}` | stisk osy enkodéru (stejně jako u tlačítka) |

**Proč `code` a ne jen jednotlivé klávesy:** pravidlo hádanky pak porovná jedinou hodnotu („kód = 1234“)
a nemusí skládat stisky. Node kód jen sestaví, správnost posuzuje gateway.

**Proč absolutní poloha enkodéru:** když se zpráva ztratí, další nese aktuální hodnotu a gateway se nerozejde
se skutečností (stejný princip jako absolutní povely). Po startu nodu a po `reset` je poloha 0.

### Povel `lcd`

```json
{"t":"lcd","cid":"20","id":"node1.lcd1","l1":"Vitejte!","l2":"Zadej kod"}
```

| Atribut | Význam |
|---|---|
| `l1`, `l2` | text 1. a 2. řádku, nejvýš 16 znaků (delší se ořízne), chybějící řádek = prázdný |

Povel nastavuje **celý obsah displeje** (absolutní stav jako u LED). Displej umí jen ASCII: gateway má posílat text
bez diakritiky, node znak mimo ASCII nahradí `?`. Bez diakritiky se povel vždy vejde do 128 B.
Povel `reset` displej smaže. Po startu node ukáže `node1 fw 1.1.0` (pro technika), pak text řídí gateway.
Node bez rozšíření odpoví na `lcd` `ack ok:false`, `err:"unknownDevice"`.

### Stav podpory

| Část | Stav |
|---|---|
| Firmware | ✅ 1.1.0, za přepínačem `ENABLE_EXTENSIONS` |
| Gateway | ✅ přijímá nové typy a události, posílá `lcd`, vyhodnocuje pravidla níže; zařízení drží **jen lokálně** (`iot-gateway.md` kap. 10a) |
| Cloud | ⬜ chybí typy zařízení a události v `device` a `event` a rozšíření `ruleType` níže |

Návrh rozšíření pravidla pro cloud (`command-list-webapp.md`, `ruleType`); gateway ho už umí vyhodnotit:

| Spouštěč `eventType` | Zařízení | Podmínka |
|---|---|---|
| `code` | `keypad` | `{ "operator": "eq", "value": "1234" }` (text) |
| `turn` | `encoder` | `eq` / `gt` / `gte` / `lt` / `lte` s číslem 0–19 |
| `press` | `encoder` | bez podmínky (jako tlačítko) |

Nová akce: `{ "type": "showText", "deviceId": "<LCD>", "line1": "Trezor otevren", "line2": "" }`.

## Shrnutí rozhodnutí

| Téma | Rozhodnutí |
|---|---|
| Formát | JSON na řádek, 115 200 Bd (ověřeno na prototypu 21. 11.) |
| Identifikace | `hwId` = `<NODE_ID>.<zařízení>` |
| Čas události | přiděluje gateway při přijetí |
| Živost nodu | `hb` každých 5 s, odpojený po 15 s ticha |
| Povely | absolutní stav, `cid` + `ack`, až 3 opakování |
| Downsampling | medián za 5 min (UTC okna), z 10s vzorků |
| Retence na gateway | neodeslané neomezeně, odeslané 24 h |
| Rozšíření (2. fáze) | klávesnice → `code`, enkodér → absolutní poloha, LCD → absolutní text; ve firmwaru za přepínačem `ENABLE_EXTENSIONS` |

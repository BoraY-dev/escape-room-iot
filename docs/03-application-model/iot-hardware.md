# Hardware IoT Node a gateway

> Zdroj pro stránku **BIOT DL Application Model – Tým 1 → IoT Node** (část hardware).
> Komunikaci s gateway popisuje `iot-protocol.md`, firmware `iot-node.md`.
>
> **Stav:** zapojení odpovídá **skutečnému prototypu** (David Král, 19. 11. 2026), vyzkoušenému na Arduinu Mega 2560.
> Oproti prvnímu návrhu podle datasheetů: teploměr **DHT11** místo termistoru, **3 tlačítka** místo jednoho,
> **2 LED** na D22 a D23 místo jedné na D8. Navíc jsou zapojené klávesnice, enkodér a LCD pro 2. fázi (kapitola 6).

## 1. Součástky

### IoT Node – MVP

| Součástka | Typ / parametry | Ks | Účel |
|---|---|:-:|---|
| Mikrokontrolér | **Arduino Mega 2560** (ATmega2560, logika 5 V, 16 MHz) | 1 | řízení senzorů, komunikace s gateway |
| Akcelerometr | **GY-521** (čip MPU-6050, 3osý akcelerometr a gyroskop, I2C, adresa `0x68`) | 1 | náklon a pohyb předmětu |
| Teploměr | **DHT11** (modul se 3 vývody, digitální, 0–50 °C, rozlišení 1 °C, přesnost ±2 °C, měří i vlhkost) | 1 | teplota |
| Tlačítko | spínací mikrotlačítko (v klidu rozpojené) | 3 | nápověda, vstupy hádanek (např. kombinace) |
| LED | 5 mm, **zelená** a **červená** | 2 | signalizace (vyřešeno / chyba, zamčeno) |
| Rezistor | **220 Ω** | 2 | omezení proudu LED |
| Ostatní | nepájivé pole, propojovací vodiče | – | prototyp |

### IoT Node – rozšíření (zapojené, mimo MVP)

| Součástka | Typ | Účel ve 2. fázi |
|---|---|---|
| Klávesnice | maticová **4x4** (0–9, A–D, `*`, `#`) | zadání kódu |
| Rotační enkodér | **KY-040** (s tlačítkem) | „nastavení ručičky“ na správnou hodnotu |
| Displej | **LCD 1602** paralelně (4bitový režim, bez I2C), potenciometr 10 kΩ na kontrast, rezistor 220 Ω na podsvícení | hlášky pro hráče |

### Gateway

| Součástka | Typ / parametry | Účel |
|---|---|---|
| Počítač | **Raspberry Pi 5** (4 GB RAM stačí) | Node-RED gateway (Node-RED je nainstalovaný) |
| Napájení | oficiální zdroj Raspberry Pi **27 W USB-C (5 V / 5 A)** | se slabším zdrojem omezí RPi 5 proud do USB portů na 600 mA |
| Úložiště | microSD karta **min. 16 GB**, třída A1 | Raspberry Pi OS (64 bit), Node-RED, lokální fronta dat |
| Kabel | USB-A ↔ USB-B, **nejvýš 5 m** (limit USB 2.0) | napájení Arduina a sériová linka |

Arduino je napájené **z USB portu Raspberry Pi**, samostatný zdroj nepotřebuje. Odhad odběru nodu:
Arduino asi 50 mA, GY-521 asi 4 mA, DHT11 asi 1 mA, LED 2 × 14 mA, podsvícení LCD asi 15 mA, celkem pod 150 mA.

## 2. Přiřazení pinů Arduina

### MVP

| Pin Arduina | Připojeno k | `hwId` | Režim |
|---|---|---|---|
| **5V** | VCC všech modulů | – | napájení |
| **GND** | GND všech modulů, tlačítka, katody LED | – | společná zem |
| **D2** | tlačítko 1 (druhý vývod na GND) | `node1.btn1` | `INPUT_PULLUP` |
| **D3** | tlačítko 2 | `node1.btn2` | `INPUT_PULLUP` |
| **D4** | tlačítko 3 | `node1.btn3` | `INPUT_PULLUP` |
| **D5** | DHT11 DATA | `node1.temp1` | digitální, jednovodičový protokol DHT |
| **20 (SDA)** | GY-521 SDA | `node1.acc1` | I2C data |
| **21 (SCL)** | GY-521 SCL | `node1.acc1` | I2C hodiny |
| **D22** | zelená LED přes 220 Ω | `node1.led1` | `OUTPUT` |
| **D23** | červená LED přes 220 Ω | `node1.led2` | `OUTPUT` |

### Rozšíření (2. fáze)

| Pin Arduina | Připojeno k |
|---|---|
| **D6** | enkodér SW (tlačítko) |
| **D7** | enkodér DT |
| **D8** | enkodér CLK |
| **D30–D33** | klávesnice řádky 1–4 |
| **D34–D37** | klávesnice sloupce 1–4 |
| **D40, D41** | LCD RS, E |
| **D42–D45** | LCD D4–D7 |

Proč tyto piny:
- **20 a 21** jsou na Arduinu Mega pevně vyhrazené pro I2C.
- **D22 a výš** jsou na Mega vyvedené na zadní liště, takže výstupy a rozšíření nezabírají piny s přerušením a PWM.
- LED nejsou na **D13**: tam je LED přímo na desce, která bliká při startu bootloaderu.

## 3. Zapojení jednotlivých částí

### Akcelerometr GY-521

| GY-521 | Arduino Mega |
|---|---|
| VCC | 5V (modul má vlastní stabilizátor na 3,3 V) |
| GND | GND |
| SCL | 21 (SCL) |
| SDA | 20 (SDA) |
| AD0, INT, XDA, XCL | nezapojeno (adresa `0x68`, firmware čte hodnoty pravidelně) |

**Montáž:** modul se do předmětu upevní tak, aby osa **Z mířila svisle nahoru**, když předmět stojí ve výchozí poloze.
Firmware pak počítá náklon jako úhel mezi osou Z a svislicí (0° = výchozí poloha, 180° = vzhůru nohama).

### Teploměr DHT11

```
5V ── VCC [ DHT11 modul ] DATA ── D5
          [           ] GND  ── GND
```

Modul má pull-up rezistor na datovém vodiči už na sobě, nic dalšího není potřeba. DHT11 posílá teplotu
a vlhkost po jednom vodiči. Platí pro něj:
- měřit se smí **nejvýš jednou za 2 s** (častější čtení vrací starou hodnotu); firmware čte každých 10 s,
- teplota je v **celých °C** s přesností **±2 °C**, rozsah 0–50 °C,
- na změnu teploty reaguje pomalu (desítky sekund). Podmínka hádanky „zahřej předmět rukou“ proto musí mít
  dostatečný rozdíl a čas,
- jedno čtení trvá asi **25 ms** a knihovna během přenosu na několik milisekund vypne přerušení (dopad na příjem povelů viz `iot-node.md`).

Vlhkost firmware v MVP neposílá; je to možné rozšíření (další typ zařízení).

### Tlačítka

```
D2 ──[ tlačítko 1 ]── GND
D3 ──[ tlačítko 2 ]── GND        (piny v režimu INPUT_PULLUP)
D4 ──[ tlačítko 3 ]── GND
```

V klidu je na pinu logická 1 (interní pull-up), stisk ji stáhne na 0. Externí rezistor není potřeba.
Zákmity kontaktů ošetřuje firmware (30 ms). Tři tlačítka umožňují hádanky typu „stiskni ve správném pořadí“;
pořadí vyhodnocuje gateway z jednotlivých událostí `press`.

### LED

```
D22 ──[ rezistor 220 Ω ]──▶|── GND      zelená
D23 ──[ rezistor 220 Ω ]──▶|── GND      červená
```

Proud LED: (5 V − 2 V) / 220 Ω ≈ 14 mA. Doporučený proud jednoho pinu Arduina je 20 mA, takže je v bezpečné rezervě.

## 4. Celkové schéma

```
                    ┌────────────────────────────┐
  tlačítko 1 ── D2  │                            │ D22 ──[220 Ω]──▶|── GND   LED zelená
  tlačítko 2 ── D3  │                            │ D23 ──[220 Ω]──▶|── GND   LED červená
  tlačítko 3 ── D4  │      Arduino Mega 2560     │
  (druhé vývody     │                            │ D30–D37 ── klávesnice 4x4   (rozšíření)
   na GND)          │                            │
  DHT11 DATA ── D5  │                            │ D40–D45 ── LCD 1602         (rozšíření)
  enkodér  D6–D8    │                            │
  (rozšíření)       │                            │
  GY-521 SDA ── 20  │                            │
  GY-521 SCL ── 21  │                            │
                    │ 5V, GND ── všechny moduly  │
                    └─────────────┬──────────────┘
                                  │ USB (data + napájení)
                           Raspberry Pi 5
```

Všechny zemnicí vodiče vedou na společnou **GND** Arduina.

## 5. Gateway

```
[Arduino Mega] ══ USB-A↔B ══ [Raspberry Pi 5] ══ Wi-Fi / Ethernet ══ internet ══ [cloud]
                                    ║
                              zdroj 27 W USB-C
```

- Arduino se na RPi objeví jako sériové zařízení `/dev/ttyACM0` (klony s čipem CH340 jako `/dev/ttyUSB0`).
  Gateway ho otevírá podle stabilního názvu `/dev/serial/by-id/usb-…`, který se nezmění, když se připojí další USB zařízení.
- Rychlost linky je **115 200 Bd** (nastavuje firmware, viz `iot-protocol.md`).
- Další nody se připojují do dalších USB portů nebo přes USB hub s vlastním napájením.
- Raspberry Pi 5 má hodiny reálného času; bez záložní baterie se ale čas po výpadku napájení nastaví až přes internet
  (NTP). Doporučujeme proto připojit záložní baterii RTC. Při nesynchronizovaných hodinách gateway vyhlásí závadu
  (detail v `iot-gateway.md`).

## 6. Rozšíření (2. fáze, mimo MVP)

Klávesnice, enkodér a LCD jsou na prototypu zapojené a 21. 11. 2026 ověřené s firmwarem 1.1.0
(`ENABLE_EXTENSIONS = 1`, `iot-node.md` kap. 11). Cloud pro ně zatím nemá typy zařízení, proto je přepínač
ve výchozím stavu vypnutý. Typy `keypad` (událost „zadaný kód“), `encoder` (poloha) a `display` (povel s textem,
2 × 16 znaků se vejde do limitu povelu 128 B) popisuje `iot-protocol.md` kap. 9; v cloudu k nim přibudou
podmínky a akce pravidel.

Samostatný testovací program `iot-node/hw-test` ověří zapojení klávesnice (hlásí i řádek a sloupec), enkodéru
a LCD bez gateway.

**Omezení enkodéru:** D6–D8 nemají na Mega přerušení, firmware je tedy čte v hlavní smyčce.
Čtení DHT11 (asi 25 ms) by kroky při rychlém otáčení ztrácelo, proto firmware teplotu během otáčení nečte.
Kdyby to nestačilo, lze přepojit CLK a DT na **D18 a D19** (piny s přerušením, volné).

Další volné piny (A0–A15, D9–D13, D24–D29, D38, D39, D46–D53) umožňují přidat podle US18 a US19 bzučák nebo relé
pro magnetický zámek a další senzory. Každé nové zařízení dostane vlastní `hwId` a ohlásí se ve zprávě `hello`.

## 7. Ověřit při oživení s firmwarem

Prototyp je zapojený a součástky fungují s testovacím programem. S firmwarem podle `iot-node.md` zbývá ověřit:

| # | Co | Proč | Stav (21. 11. 2026) |
|---|---|---|---|
| 1 | že se Arduino na RPi objeví jako `/dev/ttyACM0`, nebo `/dev/ttyUSB0` | klony s čipem CH340 se hlásí jinak; gateway používá `/dev/serial/by-id/…` | ve Windows originální Mega (USB VID 2341, čip 16U2) → na RPi se čeká `ttyACM0`; ověřit na RPi |
| 2 | restart watchdogem | starší bootloadery Mega 2560 se po restartu watchdogem zacyklí (`iot-node.md` kap. 8) | ⬜ |
| 3 | orientace GY-521 v herním předmětu | výchozí poloha musí odpovídat ose Z nahoru | ⚠️ v klidu hlásí náklon 94–99°, modul leží na boku – otočit čipem nahoru |
| 4 | zapojení krajních vývodů potenciometru LCD (předpoklad 5V a GND) | ve schématu nejsou zakreslené; týká se jen rozšíření | ✅ kontrast funguje |
| 5 | rychlost linky 115 200 Bd | v prvním testu ukazoval Serial Monitor nesmysly | ✅ funguje; nesmysly byly způsobené jinou rychlostí nastavenou v Serial Monitoru |
| 6 | klávesnice, enkodér, LCD | rozšíření | ✅ všechny klávesy včetně 4. sloupce, enkodér oběma směry, LCD |

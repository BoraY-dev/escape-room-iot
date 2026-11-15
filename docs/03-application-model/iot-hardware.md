# Hardware IoT Node a gateway

> Zdroj pro stránku **BIOT DL Application Model – Tým 1 → IoT Node** (část hardware).
> Komunikaci s gateway popisuje `iot-protocol.md`, firmware `iot-node.md`.
>
> **Stav návrhu:** zapojení je navržené **podle datasheetů** součástek. Hodnoty označené ⚠️ je potřeba
> ověřit na skutečném hardwaru (kapitola 7).

## 1. Součástky

### IoT Node

| Součástka | Typ / parametry | Ks | Účel |
|---|---|:-:|---|
| Mikrokontrolér | **Arduino Mega 2560 R3** (ATmega2560, logika 5 V, 16 MHz, 10bitový A/D převodník) | 1 | řízení senzorů, komunikace s gateway |
| Akcelerometr | **GY-521** (čip MPU-6050, 3osý akcelerometr a gyroskop, I2C, adresa `0x68`) | 1 | náklon a pohyb předmětu |
| Termistor | NTC **10 kΩ** při 25 °C, **B = 3950** ⚠️ | 1 | teplota |
| Rezistor | **10 kΩ**, 1 % | 1 | dělič napětí s termistorem |
| Tlačítko | spínací mikrotlačítko (v klidu rozpojené) | 1 | žádost o nápovědu / vstup hádanky |
| LED | 5 mm, červená nebo zelená (úbytek napětí asi 2 V) | 1 | signalizace vyřešené hádanky |
| Rezistor | **220 Ω** | 1 | omezení proudu LED |
| Ostatní | nepájivé pole, propojovací vodiče | – | prototyp |

### Gateway

| Součástka | Typ / parametry | Účel |
|---|---|---|
| Počítač | **Raspberry Pi 5** (4 GB RAM stačí) | Node-RED gateway |
| Napájení | oficiální zdroj Raspberry Pi **27 W USB-C (5 V / 5 A)** | se slabším zdrojem omezí RPi 5 proud do USB portů na 600 mA |
| Úložiště | microSD karta **min. 16 GB**, třída A1 | Raspberry Pi OS Lite (64 bit), Node-RED, lokální fronta dat |
| Kabel | USB-A ↔ USB-B, **nejvýš 5 m** (limit USB 2.0) | napájení Arduina a sériová linka |

Arduino je napájené **z USB portu Raspberry Pi**, samostatný zdroj nepotřebuje. Odhad odběru nodu:
Arduino asi 50 mA, GY-521 asi 4 mA, LED asi 14 mA, celkem pod 100 mA.

## 2. Přiřazení pinů Arduina

| Pin Arduina | Připojeno k | `hwId` | Režim |
|---|---|---|---|
| **5V** | GY-521 VCC, horní konec děliče termistoru | – | napájení |
| **GND** | GY-521 GND, termistor, tlačítko, katoda LED | – | společná zem |
| **20 (SDA)** | GY-521 SDA | `node1.acc1` | I2C data |
| **21 (SCL)** | GY-521 SCL | `node1.acc1` | I2C hodiny |
| **A0** | střed děliče (rezistor 10 kΩ / termistor) | `node1.temp1` | analogový vstup |
| **D2** | tlačítko (druhý vývod na GND) | `node1.btn1` | `INPUT_PULLUP` |
| **D8** | LED přes rezistor 220 Ω | `node1.led1` | `OUTPUT` |

Proč tyto piny:
- **20 a 21** jsou na Arduinu Mega pevně vyhrazené pro I2C (jinde než na Uno, kde je to A4 a A5).
- **D2** podporuje přerušení, kdyby bylo potřeba reagovat na stisk mimo hlavní smyčku.
- **D8** místo D13: na D13 je LED přímo na desce, která bliká při startu bootloaderu. Signalizace hádanky by se tak rozsvítila při každém restartu.

## 3. Zapojení jednotlivých částí

### Akcelerometr GY-521

| GY-521 | Arduino Mega |
|---|---|
| VCC | 5V (modul má vlastní stabilizátor na 3,3 V) |
| GND | GND |
| SCL | 21 (SCL) |
| SDA | 20 (SDA) |
| AD0 | GND (adresa `0x68`) nebo nezapojeno |
| INT, XDA, XCL | nezapojeno (firmware čte hodnoty pravidelně) |

**Montáž:** modul se do předmětu upevní tak, aby osa **Z mířila svisle nahoru**, když předmět stojí ve výchozí poloze.
Firmware pak počítá náklon jako úhel mezi osou Z a svislicí (0° = výchozí poloha, 180° = vzhůru nohama).

### Termistor (dělič napětí)

```
5V ──[ rezistor 10 kΩ ]──┬──[ termistor NTC 10 kΩ ]── GND
                         │
                        A0
```

S rostoucí teplotou klesá odpor termistoru, a tím i napětí na A0. Firmware z naměřené hodnoty převodníku
(0–1023) spočítá odpor termistoru a z něj teplotu podle rovnice s parametrem B:

```
R_ntc = 10 000 · ADC / (1023 − ADC)
T [°C] = 1 / ( 1/298,15 + ln(R_ntc / 10 000) / 3950 ) − 273,15
```

Přesnost: kolem 25 °C odpovídá jeden krok převodníku asi 0,2 °C. Firmware proto pro každý vzorek
průměruje 10 rychle po sobě jdoucích čtení. Tím potlačí šum převodníku a vzorek posílá s přesností na 0,1 °C.

### Tlačítko

```
D2 ──[ tlačítko ]── GND        (pin v režimu INPUT_PULLUP)
```

V klidu je na D2 logická 1 (interní pull-up), stisk ji stáhne na 0. Externí rezistor není potřeba.
Zákmity kontaktů ošetřuje firmware (30 ms).

### LED

```
D8 ──[ rezistor 220 Ω ]──▶|── GND
                       anoda  katoda (kratší vývod)
```

Proud LED: (5 V − 2 V) / 220 Ω ≈ 14 mA. Doporučený proud jednoho pinu Arduina je 20 mA, takže je v bezpečné rezervě.

## 4. Celkové schéma

```
                 ┌──────────────────────────────┐
   USB-B ◀═══════╡        Arduino Mega 2560      │
  (k RPi 5)      │                              │
                 │ 5V ─────┬───────────┐        │
                 │         │           │        │
                 │      GY-521 VCC   [10 kΩ]    │
                 │ 20 SDA ─ GY-521 SDA  │        │
                 │ 21 SCL ─ GY-521 SCL  ├─ A0    │
                 │         │          [NTC]     │
                 │ D2 ─[tlačítko]─┐     │        │
                 │ D8 ─[220 Ω]─▶|─┤     │        │
                 │                │     │        │
                 │ GND ─── GY-521 GND ──┴────────┤
                 └──────────────────────────────┘
```

Všechny zemnicí vodiče (GY-521, termistor, tlačítko, LED) vedou na společnou **GND** Arduina.

## 5. Gateway

```
[Arduino Mega] ══ USB-A↔B ══ [Raspberry Pi 5] ══ Wi-Fi / Ethernet ══ internet ══ [cloud]
                                    ║
                              zdroj 27 W USB-C
```

- Arduino se na RPi objeví jako sériové zařízení `/dev/ttyACM0`. Gateway ho otevírá podle stabilního názvu
  `/dev/serial/by-id/usb-Arduino…`, který se nezmění, když se připojí další USB zařízení.
- Další nody se připojují do dalších USB portů nebo přes USB hub s vlastním napájením.
- Raspberry Pi 5 má hodiny reálného času; bez záložní baterie se ale čas po výpadku napájení nastaví až přes internet
  (NTP). Doporučujeme proto připojit záložní baterii RTC. Při nesynchronizovaných hodinách gateway vyhlásí závadu
  (detail v `iot-gateway.md`).

## 6. Rozšíření (mimo MVP)

Volné piny Arduina Mega (54 digitálních, 16 analogových) umožňují přidat další vstupy a výstupy podle US18 a US19:
bzučák nebo relé pro magnetický zámek (digitální výstup), další tlačítka a kontakty (digitální vstup),
další analogové senzory (A1–A15). Každé nové zařízení dostane vlastní `hwId` a ohlásí se ve zprávě `hello`.

## 7. Ověřit při zapojení

Návrh vychází z datasheetů. Před implementací (týden 8) je potřeba na skutečném hardwaru ověřit:

| # | Co | Proč |
|---|---|---|
| 1 | typ termistoru: odpor při 25 °C a parametr B | jiné hodnoty = chybná teplota; konstanty se upraví ve firmwaru |
| 2 | že GY-521 odpovídá na adrese `0x68` (I2C scanner) | při AD0 na 3,3 V je adresa `0x69` |
| 3 | že I2C komunikace s 5V Arduinem je stabilní | modul je 3,3V; většina modulů GY-521 s 5V Arduinem funguje, jinak převodník úrovní |
| 4 | úbytek napětí použité LED | jiná barva (modrá, bílá ~3 V) = jiný rezistor |
| 5 | orientace GY-521 v herním předmětu | výchozí poloha musí odpovídat ose Z nahoru |
| 6 | že se Arduino na RPi objeví jako `/dev/ttyACM0` | klony Arduina s čipem CH340 se hlásí jako `/dev/ttyUSB0` |

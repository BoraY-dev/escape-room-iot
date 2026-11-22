# IoT Node (Arduino Mega 2560)

Firmware pro Arduino Mega 2560 (Arduino C++).

## Hardware
- **3 tlačítka** (D2–D4) – nápověda, vstupy hádanek, kombinace,
- **akcelerometr GY-521** (I2C 20/21) – náklon a pohyb předmětu,
- **teploměr DHT11** (D5) – teplota,
- **2 LED** zelená (D22) a červená (D23) – signalizace.

Rozšíření (2. fáze, jen s `ENABLE_EXTENSIONS = 1`):
- **klávesnice 4x4** (řádky D30–D33, sloupce D34–D37) – zadání kódu,
- **enkodér KY-040** (SW D6, DT D7, CLK D8) – „ciferník“ 0–19,
- **LCD 1602** (RS D40, E D41, D4–D7 na D42–D45) – text pro hráče.

Zapojení a návrh: `docs/03-application-model/iot-hardware.md`, `iot-node.md`, `iot-protocol.md`.

## Soubory
- `escape-node/escape-node.ino` – firmware (hlavní smyčka, senzory, povely),
- `escape-node/config.h` – piny, `NODE_ID`, přepínač `ENABLE_EXTENSIONS`, časování a prahy,
- `hw-test/hw-test.ino` – samostatný test klávesnice, enkodéru a LCD (prostý text, 9600 Bd, bez gateway).

## Přepínač rozšíření

`ENABLE_EXTENSIONS` v `config.h`:
- `0` (výchozí) – MVP: rozšíření se neohlašují. Funguje s každou verzí gateway.
- `1` – node ohlásí `node1.kp1`, `node1.enc1`, `node1.lcd1` a obsluhuje je (`iot-protocol.md` kap. 9).
  Vyžaduje `gateway/flows.json` z 21. 11. 2026 nebo novější – starší gateway celé `hello` odmítne.
  Cloud nové typy zatím nezná, gateway je drží jen lokálně (dashboard, LCD).

## Knihovny
ArduinoJson 7.x, DHT sensor library (Adafruit) 1.4.x, Adafruit Unified Sensor. V Arduino IDE: *Nástroje → Spravovat knihovny*.
`LiquidCrystal` (LCD) je součástí Arduino IDE.

## Překlad a nahrání

Arduino IDE: otevřít `escape-node/escape-node.ino`, deska **Arduino Mega or Mega 2560**, port Arduina, *Nahrát*.

Nebo z příkazové řádky (`arduino-cli`, je přibalené i v Arduino IDE 2 v
`C:\Program Files\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe`):

```powershell
arduino-cli lib install "ArduinoJson" "DHT sensor library" "Adafruit Unified Sensor"
arduino-cli compile --upload -p COM10 --fqbn arduino:avr:mega iot-node/escape-node     # port podle Správce zařízení

# s rozšířením bez úpravy config.h:
arduino-cli compile --upload -p COM10 --fqbn arduino:avr:mega `
  --build-property "compiler.cpp.extra_flags=-DENABLE_EXTENSIONS=1" iot-node/escape-node
```

Přibalené `arduino-cli` nenajde vestavěné knihovny IDE (`LiquidCrystal`) samo – přidej
`--libraries "$env:LOCALAPPDATA\Arduino15\libraries"`.

## Test bez gateway

Serial Monitor **115 200 Bd** (stejně jako firmware – při jiné rychlosti ukazuje nesmysly), konec řádku **Newline**:

1. Po otevření přijde `hello` se 7 zařízeními (`btn1–3`, `acc1`, `temp1`, `led1–2`), pak každých 5 s `hb`.
2. Tlačítka → `{"t":"ev","id":"node1.btn1","e":"press",…}`; náklon → `tilt`; zatřesení → `move`; každých 10 s → `m`.
3. Povely (vložit a odeslat):
   - `{"t":"led","cid":"1","id":"node1.led1","s":"on"}` – zelená svítí, odpověď `ack ok:true`,
   - `{"t":"led","cid":"2","id":"node1.led2","s":"blink"}` – červená bliká,
   - `{"t":"reset","cid":"3"}` – obě zhasnou,
   - `{"t":"who","cid":"4"}` – `ack` a znovu `hello`,
   - `{"t":"led","cid":"5","id":"node1.led9","s":"on"}` – `ack ok:false, err:"unknownDevice"`.
4. Odpojený DATA vodič DHT11 → `err sensorNotResponding`, po 3 pokusech nové `hello` bez `temp1`.

S `ENABLE_EXTENSIONS = 1` navíc:

5. `hello` má 10 zařízení (+ `kp1`, `enc1`, `lcd1`), LCD po startu ukáže `node1 fw 1.1.0`.
6. Klávesnice `1 2 3 4 #` → čtyřikrát `key` a `{"t":"ev","id":"node1.kp1","e":"code","v":"1234",…}`; `*` rozepsaný kód smaže.
7. Enkodér → `{"t":"ev","id":"node1.enc1","e":"turn","v":1,…}` (doprava roste, 0–19 dokola); stisk osy → `press`.
8. `{"t":"lcd","cid":"6","id":"node1.lcd1","l1":"Ahoj","l2":"Zadej kod"}` – text na displeji, `ack ok:true`.

Pozor: otevření sériového portu Arduino restartuje (LED zhasnou, LCD se vrátí na úvodní text).

Formát zpráv: `docs/03-application-model/iot-protocol.md`.

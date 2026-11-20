# IoT Node (Arduino Mega 2560)

Firmware pro Arduino Mega 2560 (Arduino C++).

## Hardware
- **3 tlačítka** (D2–D4) – nápověda, vstupy hádanek, kombinace,
- **akcelerometr GY-521** (I2C 20/21) – náklon a pohyb předmětu,
- **teploměr DHT11** (D5) – teplota,
- **2 LED** zelená (D22) a červená (D23) – signalizace.

Zapojení a návrh: `docs/03-application-model/iot-hardware.md`, `iot-node.md`, `iot-protocol.md`.

## Soubory
- `escape-node/escape-node.ino` – firmware (hlavní smyčka, senzory, povely),
- `escape-node/config.h` – piny, `NODE_ID`, časování a prahy.

## Knihovny
ArduinoJson 7.x, DHT sensor library (Adafruit) 1.4.x, Adafruit Unified Sensor. V Arduino IDE: *Nástroje → Spravovat knihovny*.

## Překlad a nahrání

Arduino IDE: otevřít `escape-node/escape-node.ino`, deska **Arduino Mega or Mega 2560**, port Arduina, *Nahrát*.

Nebo z příkazové řádky (`arduino-cli`):

```powershell
arduino-cli lib install "ArduinoJson" "DHT sensor library" "Adafruit Unified Sensor"
arduino-cli compile --fqbn arduino:avr:mega iot-node/escape-node
arduino-cli upload  --fqbn arduino:avr:mega -p COM3 iot-node/escape-node   # port podle Správce zařízení
```

## Test bez gateway

Serial Monitor **115 200 Bd**, konec řádku **Newline**:

1. Po otevření přijde `hello` se 7 zařízeními (`btn1–3`, `acc1`, `temp1`, `led1–2`), pak každých 5 s `hb`.
2. Tlačítka → `{"t":"ev","id":"node1.btn1","e":"press",…}`; náklon → `tilt`; zatřesení → `move`; každých 10 s → `m`.
3. Povely (vložit a odeslat):
   - `{"t":"led","cid":"1","id":"node1.led1","s":"on"}` – zelená svítí, odpověď `ack ok:true`,
   - `{"t":"led","cid":"2","id":"node1.led2","s":"blink"}` – červená bliká,
   - `{"t":"reset","cid":"3"}` – obě zhasnou,
   - `{"t":"who","cid":"4"}` – `ack` a znovu `hello`,
   - `{"t":"led","cid":"5","id":"node1.led9","s":"on"}` – `ack ok:false, err:"unknownDevice"`.
4. Odpojený DATA vodič DHT11 → `err sensorNotResponding`, po 3 pokusech nové `hello` bez `temp1`.

Formát zpráv: `docs/03-application-model/iot-protocol.md`.

# IoT Node (Arduino Mega 2560)

Firmware pro Arduino Mega 2560 (Arduino C++).

## Hardware
- **3 tlačítka** (D2–D4) – nápověda, vstupy hádanek, kombinace,
- **akcelerometr GY-521** (I2C 20/21) – náklon a pohyb předmětu,
- **teploměr DHT11** (D5) – teplota,
- **2 LED** zelená (D22) a červená (D23) – signalizace.

Zapojení a návrh: `docs/03-application-model/iot-hardware.md`, `iot-node.md`, `iot-protocol.md`.

## Vývoj
- Arduino IDE, nebo PlatformIO (rozšíření VS Code).
- Firmware se nahrává přes USB; stejný kabel slouží ke komunikaci s gateway (sériová linka).

## Co bude node posílat a přijímat (návrh)
- `button` – stisk tlačítka (okamžitě),
- `motion` – naklonění / pohyb podle akcelerometru (okamžitě, při překročení prahu),
- `temperature` – měření teploty (každých ~10 s; downsampling řeší gateway),
- povely z gateway – např. rozsvícení / zhasnutí LED.

Formát zpráv bude upřesněn v milníku „Navrženo technické řešení IoT části“ (týden 7).

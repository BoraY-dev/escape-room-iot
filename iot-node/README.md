# IoT Node (Arduino Mega 2560)

Firmware pro Arduino Mega 2560 (Arduino C++).

## Hardware
- **tlačítko** – žádost o nápovědu / vstup hádanky,
- **akcelerometr GY-521** – náklon a pohyb předmětu,
- **termistor** – teplota,
- **LED** – výstup (např. signalizace vyřešené hádanky).

## Vývoj
- Arduino IDE, nebo PlatformIO (rozšíření VS Code).
- Firmware se nahrává přes USB; stejný kabel slouží ke komunikaci s gateway (sériová linka).

## Co bude node posílat a přijímat (návrh)
- `button` – stisk tlačítka (okamžitě),
- `motion` – naklonění / pohyb podle akcelerometru (okamžitě, při překročení prahu),
- `temperature` – měření teploty (každých ~10 s; downsampling řeší gateway),
- povely z gateway – např. rozsvícení / zhasnutí LED.

Formát zpráv bude upřesněn v milníku „Navrženo technické řešení IoT části“ (týden 7).

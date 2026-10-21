# IoT Node (HARDWARIO Core Module)

Firmware pro HARDWARIO Core Module (tlačítko, 3osý akcelerometr, teploměr).

## Vytvoření projektu
1. Ve VS Code nainstaluj rozšíření **HARDWARIO Code** (TOWER Extension).
2. Vytvoř nový firmware projekt ze skeletonu přímo do této složky.
3. Sestav a nahraj firmware přes USB.

## Co bude node posílat přes UART (návrh)
- `button` – stisk tlačítka (okamžitě),
- `motion` – naklonění / pohyb podle akcelerometru (okamžitě, při překročení prahu),
- `temperature` – měření teploty (každých 10 s; downsampling řeší gateway).

Formát zpráv bude upřesněn v milníku „Navrženo technické řešení IoT části“ (týden 7).

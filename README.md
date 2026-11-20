# Escape Room IoT Platform

Semestrální projekt z předmětu **Internet of Things**.

IoT platforma pro únikové hry. Provozovatelé mohou stavět a měnit hádanky bez programování:
zařízení v místnosti (Arduino Mega 2560) se připojí ke gateway, logika hádanek se složí
z pravidel ve webové aplikaci a game master má pod kontrolou celý průběh hry – může ji sledovat
živě a kdykoliv zasáhnout.

## Architektura

```
[IoT Node]  <--USB serial-->  [Gateway: Node-RED]  --HTTPS-->  [Cloud: Express.js API]  <--  [Frontend: React]
 (Arduino Mega 2560)           (Raspberry Pi 5)                  (MongoDB Atlas)              (provozovatel, game master)
 3 tlačítka                    - vyhodnocení pravidel
 akcelerometr GY-521           - downsampling teploty
 teploměr DHT11                - perzistentní fronta dat
 2 LED (výstup)                - povely pro node
```

- **IoT Node** – Arduino Mega 2560 (3 tlačítka, akcelerometr GY-521, teploměr DHT11, 2 LED; pro 2. fázi klávesnice, enkodér a LCD). Posílá události a měření
  po sériové lince přes USB a přijímá povely z gateway (např. rozsvícení LED).
- **Gateway** – Node-RED na Raspberry Pi 5. Vyhodnocuje pravidla hádanek lokálně (okamžitá odezva, funguje i bez internetu),
  provádí downsampling teploty, ukládá data a odesílá je do cloudu. Startuje automaticky po zapnutí zařízení.
- **Cloud backend** – Express.js REST API. Registrace a autentizace gateway, ukládání událostí a měření, správa místností, hádanek a her.
- **Frontend** – React. Editor hádanek, živý přehled hry pro game mastera, přehled zařízení a statistiky.

## Struktura repozitáře

| Složka | Obsah |
|---|---|
| `docs/` | Dokumentace (Business Request, Business Model, Application Model, řízení projektu) |
| `iot-node/` | Firmware pro Arduino Mega 2560 |
| `gateway/` | Node-RED flow a konfigurace automatického startu |
| `server/` | Backend (Express.js) |
| `client/` | Frontend (React + Vite) |

## Spuštění (vývoj)

```bash
# backend
cd server && npm install && npm run dev     # http://localhost:3000/health

# frontend
cd client && npm install && npm run dev     # http://localhost:5173
```

## Milníky

| Týden | Milník | Stav |
|---|---|---|
| 3 | Vytvořen tým | ✅ |
| 3 | Popsány klíčové user stories | ✅ |
| 3 | Git repozitář, úvodní commit | ✅ |
| 4 | Aktéři, produkty, business use-cases | ✅ |
| 6 | Návrh backendu (endpointy, datový model) | ✅ |
| 7 | Technické řešení IoT části | ✅ |
| 7 | Základní implementace backendu | ⬜ |
| 8 | Základní implementace IoT části | ⬜ |
| 9 | Návrh frontendu (routy, komponenty) | ⬜ |
| 10 | Základní implementace frontendu | ⬜ |
| 12 | Nasazení v cloudu | ⬜ |

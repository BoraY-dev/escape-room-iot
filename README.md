# Escape Room IoT Platform

Semestrální projekt z předmětu **Internet of Things**.

IoT platforma pro únikové hry. Provozovatelé mohou stavět a měnit hádanky bez programování:
zařízení v místnosti (HARDWARIO Core Module) se připojí ke gateway, logika hádanek se složí
z pravidel ve webové aplikaci a game master má pod kontrolou celý průběh hry – může ji sledovat
živě a kdykoliv zasáhnout.

## Architektura

```
[IoT Node]  --UART/USB-->  [Gateway: Node-RED]  --HTTPS-->  [Cloud: Express.js API]  <--  [Frontend: React]
 (Core Module)              (Raspberry Pi)                    (databáze)                   (provozovatel, game master)
 tlačítko                   - vyhodnocení pravidel
 akcelerometr               - downsampling teploty
 teploměr                   - fronta neodeslaných dat
```

- **IoT Node** – HARDWARIO Core Module (tlačítko, 3osý akcelerometr, teploměr). Posílá události a měření přes UART.
- **Gateway** – Node-RED na Raspberry Pi. Vyhodnocuje pravidla hádanek lokálně (okamžitá odezva, funguje i bez internetu),
  provádí downsampling teploty, ukládá data a odesílá je do cloudu. Startuje automaticky po zapnutí zařízení.
- **Cloud backend** – Express.js REST API. Registrace a autentizace gateway, ukládání událostí a měření, správa místností, hádanek a her.
- **Frontend** – React. Editor hádanek, živý přehled hry pro game mastera, přehled zařízení a statistiky.

## Struktura repozitáře

| Složka | Obsah |
|---|---|
| `docs/` | Dokumentace (Business Request, Business Model, Application Model) |
| `iot-node/` | Firmware pro HARDWARIO Core Module |
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
| 4 | Aktéři, produkty, business use-cases | ⬜ |
| 6 | Návrh backendu (endpointy, datový model) | ⬜ |
| 7 | Technické řešení IoT části | ⬜ |
| 7 | Základní implementace backendu | ⬜ |
| 8 | Základní implementace IoT části | ⬜ |
| 9 | Návrh frontendu (routy, komponenty) | ⬜ |
| 10 | Základní implementace frontendu | ⬜ |
| 12 | Nasazení v cloudu | ⬜ |

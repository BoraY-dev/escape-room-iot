# CLAUDE.md – Escape Room IoT Platform

Semestrální projekt z předmětu **Internet of Things** (Unicorn University).
Celé zadání je v `docs/zadani.md`, user stories v `docs/01-business-request.md`,
aktéři, produkty a use-cases v `docs/02-business-model.md`.
Odevzdává se v **uuManagementKit**; která část patří na kterou stránku a co zbývá doplnit,
je v `docs/uumk-map.md`.

## Jak se mnou pracovat (DŮLEŽITÉ)

Jsem student; software (dokumentace, backend, frontend, cloud) dělám sám, hardware (IoT Node)
dělá kolega David Král; v týmu jsou i Vítek Novotný a Lukáš – viz `docs/04-project-management.md`. Chci, aby práce šla rychle,
ale zároveň se při ní **naučit, co se děje**. Proto:

1. **Před každým krokem** v 1–3 větách řekni, co uděláš a proč.
2. **Nové pojmy** (např. middleware, staging, JWT, downsampling) vysvětli jednou krátce,
   napoprvé, když se objeví. Pak už ne.
3. **Příkazy v terminálu** ukaž v bloku kódu a u nových příkazů napiš, co dělají jednotlivé části.
4. **Git:** `git add` a `git commit` můžeš spouštět sám, ale napiš mi navrženou commit zprávu
   a vysvětli, co commit obsahuje. **`git push` a cokoli, co mění GitHub nebo cloud, spouštím já**,
   nebo se mě nejdřív zeptej.
5. Pracuj **po malých krocích** odpovídajících milníkům. Po každém kroku řekni,
   jak výsledek ověřím (URL, příkaz, co mám vidět).
6. Na konci kroku shrň ve 2–3 bodech, **co jsem se naučil**.
7. Když je víc možností řešení, krátce je porovnej a doporuč jednu; rozhodnutí zapiš
   do sekce „Rozhodnutí“ níže.
8. Neměň nic, co se netýká aktuálního úkolu.

Komunikuj **česky**. Kód (proměnné, funkce, endpointy, názvy souborů) piš **anglicky**,
komentáře v kódu a dokumentaci česky.

## Prostředí

- Windows, VS Code, terminál **PowerShell** (příkazy piš pro PowerShell, ne pro bash).
- Projekt je ve složce `C:\Users\borac\Unicorn\escape-room-iot`.
- Node.js LTS, Git, GitHub (autentizace přes Git Credential Manager v prohlížeči).
- IoT Node: **Arduino Mega 2560**, Arduino C++ (Arduino IDE nebo PlatformIO).
- Gateway: **Raspberry Pi 5** s Node-RED.

## Vize projektu

**IoT platforma pro únikové hry.** Provozovatelé únikových her mohou stavět a měnit hádanky
bez programování. Zařízení v místnosti se připojí ke gateway, logika hádanek se složí z pravidel
„když – pak“ ve webové aplikaci a game master má pod kontrolou celý průběh hry: sleduje ji živě
a může kdykoliv zasáhnout (nápověda, ruční vyřešení hádanky, pauza, reset místnosti).

Aktéři: **Provozovatel**, **Game master**, **Hráč** (jen fyzicky ovládá předměty), systémy **IoT Node** a **Gateway**.

## Architektura

```
[IoT Node]  <--USB serial-->  [Gateway: Node-RED]  --HTTPS-->  [Backend: Express.js]  <--  [Frontend: React]
 Arduino Mega 2560             Raspberry Pi 5                    + MongoDB Atlas
 tlačítko                      - lokální vyhodnocení pravidel
 akcelerometr GY-521           - downsampling teploty
 termistor                     - perzistentní fronta dat
 LED (výstup)                  - povely pro node (LED)
```

| Část | Technologie | Složka |
|---|---|---|
| IoT Node | Arduino Mega 2560 (Arduino C++, Arduino IDE / PlatformIO) | `iot-node/` |
| Gateway | Node-RED + `node-red-node-serialport` + `node-red-dashboard` | `gateway/` |
| Backend | Node.js + Express.js (REST API přes HTTPS) | `server/` |
| Frontend | React + Vite | `client/` |
| Dokumentace | uuApp Framework (Business Request, Business Model, Application Model) | `docs/` |

## Povinné požadavky ze zadání (kontroluj je při návrhu)

- Dokumentace dle uuApp Framework pokrývá cloud **i** IoT část (node, gateway).
- Gateway = Node-RED flow; **automaticky startuje** po zapnutí zařízení (systemd na RPi, nebo Docker restart).
- Gateway provádí **downsampling** se zdůvodněnou strategií.
- Gateway **ukládá data** a odesílá je, když je připojení; **neodeslaná data se drží neomezeně**,
  odeslaná mají **zdůvodněnou retenci** (např. 24 h).
- Gateway se **registruje do cloudu** a při odesílání je **autentizovaná a autorizovaná**.
- Gateway komunikuje s cloudem přes **HTTPS** endpointy.
- Cloud umí obsloužit **více gateway**.
- Backend **Express.js**, frontend **React**.
- Aplikace je **nasazená v cloudu** a celý řetězec Node → Gateway → Cloud funguje.

## Rozhodnutí

| Téma | Rozhodnutí | Důvod |
|---|---|---|
| Kde se vyhodnocují pravidla hádanek | Na **gateway**; cloud pravidla ukládá, gateway si je stahuje | Okamžitá odezva pro hráče, hra běží i bez internetu |
| Co se posílá do cloudu | Herní události (vyřešení, nápověda, ruční zásah) hned; teplota po downsamplingu | Události jsou důležité živě, teplota ne |
| HW IoT Node | Arduino Mega 2560 + tlačítko, akcelerometr GY-521, termistor, LED | Rozhodnutí týmu (HW dělá David); zadání jiný mikrokontrolér povoluje – **ověřit s vyučujícím povinný nákup HARDWARIO Core Module** |
| Komunikace node ↔ gateway | Sériová linka přes USB, obousměrně (události nahoru, povely dolů); více nodů přes další USB porty / hub; rádio 868 MHz volitelně | Jednoduché, spolehlivé |
| Databáze | MongoDB (Atlas free tier) – **potvrzeno** | Snadné nasazení zdarma |
| Rozsah MVP | US01–US04, US09–US12, US14–US17; ostatní jako rozšíření | Malý tým, software dělám sám |
| Role teploměru | (1) podmínka hádanky – okamžitá hodnota, bez downsamplingu; (2) monitoring teploty místnosti – downsampling na gateway (měření à 10 s → 1 hodnota / 5 min) | Downsampling dává smysl jen u průběžné veličiny; tlačítko a náklon jsou jednorázové události. Strategie (průměr/medián) se zdůvodní v týdnu 7 |
| Metoda řízení | Kanban přes GitHub Projects | Malý tým s nepravidelnou prací, sprinty by byly zbytečná režie |
| Rozdělení práce | Software já, hardware (Arduino, firmware, RPi) David Král; gateway sdílená – k potvrzení. Týden 6: datový model já, commandy webu a profily Vítek, commandy gateway Lukáš (převzato od Davida, který neodpovídal) | Viz `docs/04-project-management.md` |
| Živý přehled hry | Frontend se dotazuje (polling) každé 2 s na `game/getCurrent` (stav hry, upozornění i nové události) | Jednoduché na implementaci i nasazení; WebSockety lze doplnit později beze změny commandů |
| Povely z webu pro gateway | Fronta `gatewayCommand` v cloudu, gateway si ji vyzvedává | Gateway je za NAT, cloud ji nemůže volat; při výpadku povely počkají |
| Oprávnění Operators | Provozovatel smí i řídit hru (vše co game master) | V malé provozovně hru často řídí majitel |
| Styl endpointů | uuCommand: `POST /room/create`, `GET /room/list`, dtoIn/dtoOut, `uuAppErrorMap` | Odpovídá šabloně Command List v uuMK |
| Přístup k databázi | Mongoose | Schémata s validací přímo odpovídají Persistence Layer |
| Vazba místnost–gateway | Jen `gateway.roomId` (unikátní), bez `room.gatewayId` | Jeden zdroj pravdy; při výměně gateway zůstanou zařízení i pravidla u místnosti |
| Opakované odeslání z gateway | Unikátní `gatewayEventId` u událostí, `deviceId` + `windowStart` u měření | Po výpadku se data posílají znovu a nesmí vzniknout duplicity |
| Retence v cloudu | `event` a `measurement` 90 dní (TTL), doručené `gatewayCommand` 7 dní, výsledky her trvale | Atlas free tier má 512 MB; výsledky zůstávají v `game` |

## Milníky

| Týden | Milník | Body | Stav |
|---|---|---|---|
| 3 | Vytvořen tým | 2 | ✅ |
| 3 | Popsány klíčové user stories | 2 | ✅ |
| 3 | Git repozitář založen, odkázán na portále, úvodní commit | 2 | ✅ https://github.com/BoraY-dev/escape-room-iot |
| 4 | Popsáni klíčoví aktéři, produkty a business use-cases | 2 | ✅ v uuBookKitu |
| 6 | Návrh backendu (endpointy, datový model) | 2 | ✅ v uuMK (PR #1) |
| 7 | Navrženo technické řešení IoT části | 2 | ⏳ **aktuální** (větev `iot-design`) |
| 7 | Základní implementace backendu | 2 | ⬜ |
| 8 | Základní implementace IoT části (node, gateway) | 2 | ⬜ |
| 9 | Návrh frontendu (routy, komponenty) | **4** | ⬜ |
| 10 | Základní implementace frontendu | 2 | ⬜ |
| 12 | Nasazení aplikace v cloudu | 2 | ⬜ |

Po dokončení milníku aktualizuj tuto tabulku i tabulku v `README.md`.

## Cílová struktura repozitáře

```
escape-room-iot/
├── CLAUDE.md
├── README.md
├── .gitignore
├── docs/        # zadani.md, 01-business-request.md, 02-business-model.md, 03-application-model.md,
│                # 04-project-management.md, uumk-map.md
├── iot-node/    # firmware Arduino Mega 2560 (README zatím)
├── gateway/     # flows.json, README s instalací a autostartem
├── server/      # Express.js: package.json, src/index.js (GET /health)
└── client/      # React + Vite
```

## Příkazy

```powershell
# backend
cd server; npm install; npm run dev      # http://localhost:3000/health
# frontend
cd client; npm install; npm run dev      # http://localhost:5173
```

## Konvence

- Commit zprávy česky, v rozkazovacím nebo popisném tvaru, první řádek do 72 znaků
  (např. `Přidán endpoint /health`).
- Malé commity, jeden commit = jedna logická změna.
- Nikdy necommituj `node_modules/`, `.env`, přihlašovací údaje Node-RED (`*_cred.json`).
- Tajné hodnoty jen v `.env`; do repozitáře patří `.env.example`.

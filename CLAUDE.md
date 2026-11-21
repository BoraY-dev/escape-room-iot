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
 3 tlačítka                    - lokální vyhodnocení pravidel
 akcelerometr GY-521           - downsampling teploty
 teploměr DHT11                - perzistentní fronta dat
 2 LED (výstup)                - povely pro node (LED)
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
| HW IoT Node | Arduino Mega 2560 + 3 tlačítka, akcelerometr GY-521, teploměr DHT11, 2 LED (MVP); klávesnice 4x4, enkodér KY-040, LCD 1602 zapojené pro 2. fázi | Rozhodnutí týmu (HW dělá David); zadání jiný mikrokontrolér povoluje – **ověřit s vyučujícím povinný nákup HARDWARIO Core Module** |
| Komunikace node ↔ gateway | Sériová linka přes USB, obousměrně (události nahoru, povely dolů); více nodů přes další USB porty / hub; rádio 868 MHz volitelně | Jednoduché, spolehlivé |
| Databáze | MongoDB (Atlas free tier) – **potvrzeno** | Snadné nasazení zdarma |
| Rozsah MVP | US01–US04, US09–US12, US14–US17; ostatní jako rozšíření | Malý tým, software dělám sám |
| Role teploměru | (1) podmínka hádanky – okamžitá hodnota, bez downsamplingu; (2) monitoring teploty místnosti – downsampling na gateway (měření à 10 s → 1 hodnota / 5 min) | Downsampling dává smysl jen u průběžné veličiny; tlačítko a náklon jsou jednorázové události. Strategie: **medián** za 5 min (UTC okna) – odolný vůči krátkým výkyvům (teploměr v ruce hráče, rušení) |
| Metoda řízení | Kanban přes GitHub Projects | Malý tým s nepravidelnou prací, sprinty by byly zbytečná režie |
| Rozdělení práce | Software já, hardware (Arduino, firmware, RPi) David Král; gateway sdílená – k potvrzení. Týden 6: datový model já, commandy webu a profily Vítek, commandy gateway Lukáš (převzato od Davida, který neodpovídal). Týden 7: Node-RED flow Lukáš; zapojení HW a firmware já (David a Vítek bez odezvy) | Viz `docs/04-project-management.md` |
| Živý přehled hry | Frontend se dotazuje (polling) každé 2 s na `game/getCurrent` (stav hry, upozornění i nové události) | Jednoduché na implementaci i nasazení; WebSockety lze doplnit později beze změny commandů |
| Povely z webu pro gateway | Fronta `gatewayCommand` v cloudu, gateway si ji vyzvedává | Gateway je za NAT, cloud ji nemůže volat; při výpadku povely počkají |
| Oprávnění Operators | Provozovatel smí i řídit hru (vše co game master) | V malé provozovně hru často řídí majitel |
| Styl endpointů | uuCommand: `POST /room/create`, `GET /room/list`, dtoIn/dtoOut, `uuAppErrorMap` | Odpovídá šabloně Command List v uuMK |
| Přístup k databázi | Mongoose | Schémata s validací přímo odpovídají Persistence Layer |
| Vazba místnost–gateway | Jen `gateway.roomId` (unikátní), bez `room.gatewayId` | Jeden zdroj pravdy; při výměně gateway zůstanou zařízení i pravidla u místnosti |
| Opakované odeslání z gateway | Unikátní `gatewayEventId` u událostí, `deviceId` + `windowStart` u měření | Po výpadku se data posílají znovu a nesmí vzniknout duplicity |
| Zapojení IoT Node | Tlačítka D2–D4 (`INPUT_PULLUP`), DHT11 D5, GY-521 na I2C (20/21, `0x68`), LED zelená D22 a červená D23 přes 220 Ω; rozšíření: enkodér D6–D8, klávesnice D30–D37, LCD D40–D45; Arduino napájené z USB RPi 5 | **Skutečný prototyp** (David, 19. 11.); HW se nemění, odchylky od protokolu (rychlost linky) řeší náš firmware |
| Rozsah HW v MVP | MVP: tlačítka, GY-521, DHT11, LED. Klávesnice, enkodér, LCD = 2. fáze (nové typy zařízení `keypad`, `encoder`, `display`) | Milník 8 do víkendu; rozšíření mění i cloud a frontend |
| Teploměr DHT11 | Celé °C, čtení à 10 s, vlhkost se v MVP neposílá; limit zpráv node → gateway zvýšen na 512 B | `hello` se 7 zařízeními má ~310 B; DHT11 blokuje ~25 ms, ztracený povel pokryje opakování gateway |
| Formát zpráv node ↔ gateway | JSON na řádek, 115 200 Bd; `hwId` = `<NODE_ID>.<zařízení>`; povely nastavují absolutní stav s `cid` + `ack` | Node-RED parsuje jedním uzlem, čitelné, rozšiřitelné; opakovaný povel je neškodný. Detail v `docs/03-application-model/iot-protocol.md`. 115 200 Bd ověřeno na prototypu 21. 11. (dřívější „nesmysly“ = jiná rychlost v Serial Monitoru) |
| Rozšíření ve firmwaru (2. fáze) | Firmware 1.1.0 obsluhuje klávesnici (`code`), enkodér (absolutní poloha 0–19) a LCD (povel `lcd`) za přepínačem `ENABLE_EXTENSIONS` v `config.h`, výchozí `0`; protokol v `iot-protocol.md` kap. 9 | Gateway odmítne celé `hello` s neznámým typem a cloud typy nezná – s `0` MVP funguje beze změny; po úpravě gateway a cloudu stačí přepnout |
| Rozšíření v gateway | Gateway přijímá nové typy (`DEVICE_TYPES`), ale do cloudu posílá jen `CLOUD_DEVICE_TYPES` (MVP); události klávesnice a enkodéru jsou jen lokální (dashboard, pravidla `eq` / `showText`); text LCD z dashboardu | Cloud by nové typy odmítl a události bez mapování by ve frontě čekaly navždy; po doplnění cloudu stačí rozšířit jeden seznam |
| Retence v cloudu | `event` a `measurement` 90 dní (TTL), doručené `gatewayCommand` 7 dní, výsledky her trvale | Atlas free tier má 512 MB; výsledky zůstávají v `game` |
| Struktura backendu | Společný obal `registerCommand` místo ručních routes (ověření → validace dtoIn → abl → `uuAppErrorMap`), vrstvy `abl/` a `dao/` | Commandy obsahují jen vlastní logiku; odpovídá DAO Method Listu |
| Validace dtoIn | Vlastní malý validátor se stejným zápisem jako Command List (`shape`, `string(1,100)`, `id()` …) | Kód se čte stejně jako návrh, vrací `invalidValueKeyMap` i `unsupportedKeys` bez další knihovny |
| Přihlášení | `user/login` (bcrypt + JWT 12 h), první provozovnu a uživatele zakládá `node scripts/create-user.js` (přes `npm run … --` v PowerShellu parametry nedojdou) | Otevřený bod 1 z Application Profiles; správa uživatelů z webu je rozšíření |
| Testy a lokální běh | `node --test` + supertest + mongodb-memory-server (replica set kvůli transakcím); `npm run dev:memory` bez Atlasu | Testy nepotřebují cloud; transakce `sendEvents` fungují stejně jako v Atlasu |
| Databáze gateway | Uzel `node-red-node-sqlite` (zadání: „rozšíření Node-RED pro databázi“); všechny zápisy přes jediné „DB dotaz“ / „DB transakce“ (link call), vícetabulkové změny jako jedna dávka `BEGIN…COMMIT`, při chybě ROLLBACK | Varianta B zvolená 19. 11.; odpovídá zadání, zápisy se neprokládají |
| Zdroj flow | `gateway/flows.json` se generuje (`npm run build`) z `src/functions/*.js` a knihovny `src/lib/gw.js`; knihovna se při startu vloží do globálního kontextu | Kód čitelný a revidovatelný v gitu, výpočty testované (`npm test`) |
| Hosting | Backend na **Render** (free, Frankfurt, Blueprint `render.yaml`, nasazuje se z `main`), databáze **MongoDB Atlas M0** (Frankfurt); `JWT_SECRET` generuje Render, `MONGODB_URI` jen v Renderu a lokálním `.env` | Zdarma, HTTPS automaticky, oba ve stejném regionu; free služba usíná po 15 min, heartbeat gateway ji drží vzhůru. Adresa: https://escape-room-iot-api.onrender.com |
| Token gateway | V lokální SQLite (`kv`), soubor jen pro účet služby (`UMask=0077`); vlastní credentials uzel je rozšíření | Základní implementace; token se nedostane do dashboardu, logů ani fronty |

## Milníky

| Týden | Milník | Body | Stav |
|---|---|---|---|
| 3 | Vytvořen tým | 2 | ✅ |
| 3 | Popsány klíčové user stories | 2 | ✅ |
| 3 | Git repozitář založen, odkázán na portále, úvodní commit | 2 | ✅ https://github.com/BoraY-dev/escape-room-iot |
| 4 | Popsáni klíčoví aktéři, produkty a business use-cases | 2 | ✅ v uuBookKitu |
| 6 | Návrh backendu (endpointy, datový model) | 2 | ✅ v uuMK (PR #1) |
| 7 | Navrženo technické řešení IoT části | 2 | ✅ (PR #2) |
| 7 | Základní implementace backendu | 2 | ✅ (`server/`, testy `npm test`) |
| 8 | Základní implementace IoT části (node, gateway) | 2 | 🔶 firmware i Node-RED flow hotové a otestované bez HW; čeká test na RPi s Arduinem |
| 9 | Návrh frontendu (routy, komponenty) | **4** | ⬜ |
| 10 | Základní implementace frontendu | 2 | ⬜ |
| 12 | Nasazení aplikace v cloudu | 2 | 🔶 backend nasazený (Render + Atlas, 20. 11.), frontend zatím ne |

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
cd server; npm install; npm run dev      # http://localhost:3000/health (potřebuje .env s MONGODB_URI)
cd server; npm run dev:memory            # bez Atlasu: databáze v paměti + demo účty (server/README.md)
cd server; npm test                      # testy API
# frontend
cd client; npm install; npm run dev      # http://localhost:5173
```

## Konvence

- Commit zprávy česky, v rozkazovacím nebo popisném tvaru, první řádek do 72 znaků
  (např. `Přidán endpoint /health`).
- Malé commity, jeden commit = jedna logická změna.
- Nikdy necommituj `node_modules/`, `.env`, přihlašovací údaje Node-RED (`*_cred.json`).
- Tajné hodnoty jen v `.env`; do repozitáře patří `.env.example`.

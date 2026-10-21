# CLAUDE.md – Escape Room IoT Platform

Semestrální projekt z předmětu **Internet of Things** (Unicorn University).
Celé zadání je v `docs/zadani.md`, user stories v `docs/01-business-request.md`,
aktéři, produkty a use-cases v `docs/02-business-model.md`.

## Jak se mnou pracovat (DŮLEŽITÉ)

Jsem student; software (dokumentace, backend, frontend, cloud) dělám sám, hardware (IoT Node)
dělá kolega – viz `docs/04-project-management.md`. Chci, aby práce šla rychle,
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
- IoT Node: HARDWARIO Core Module, programuje se ve VS Code přes rozšíření **HARDWARIO Code**.

## Vize projektu

**IoT platforma pro únikové hry.** Provozovatelé únikových her mohou stavět a měnit hádanky
bez programování. Zařízení v místnosti se připojí ke gateway, logika hádanek se složí z pravidel
„když – pak“ ve webové aplikaci a game master má pod kontrolou celý průběh hry: sleduje ji živě
a může kdykoliv zasáhnout (nápověda, ruční vyřešení hádanky, pauza, reset místnosti).

Aktéři: **Provozovatel**, **Game master**, **Hráč** (jen fyzicky ovládá předměty), systémy **IoT Node** a **Gateway**.

## Architektura

```
[IoT Node]  --UART/USB-->  [Gateway: Node-RED]  --HTTPS-->  [Backend: Express.js]  <--  [Frontend: React]
 Core Module                Raspberry Pi / notebook           + databáze
 tlačítko                   - lokální vyhodnocení pravidel
 akcelerometr               - downsampling teploty
 teploměr                   - fronta neodeslaných dat
```

| Část | Technologie | Složka |
|---|---|---|
| IoT Node | HARDWARIO Core Module (C, SDK TOWER) | `iot-node/` |
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
| Komunikace node → gateway | USB/UART (1 node na gateway); Radio Dongle volitelně později | Jednodušší start |
| Databáze | MongoDB (Atlas free tier) – **potvrzeno** | Snadné nasazení zdarma |
| Rozsah MVP | US01–US04, US09–US12, US14–US17; ostatní jako rozšíření | Malý tým, software dělám sám |
| Role teploměru | (1) podmínka hádanky – okamžitá hodnota, bez downsamplingu; (2) monitoring teploty místnosti – downsampling na gateway (měření à 10 s → 1 hodnota / 5 min) | Downsampling dává smysl jen u průběžné veličiny; tlačítko a náklon jsou jednorázové události. Strategie (průměr/medián) se zdůvodní v týdnu 7 |
| Metoda řízení | Kanban přes GitHub Projects | Malý tým s nepravidelnou prací, sprinty by byly zbytečná režie |
| Rozdělení práce | Software já, hardware (Core Module, firmware, RPi) kolega; gateway sdílená – k potvrzení | Viz `docs/04-project-management.md` |

## Milníky

| Týden | Milník | Body | Stav |
|---|---|---|---|
| 3 | Vytvořen tým | 2 | ✅ |
| 3 | Popsány klíčové user stories | 2 | ✅ |
| 3 | Git repozitář založen, odkázán na portále, úvodní commit | 2 | ✅ https://github.com/BoraY-dev/escape-room-iot |
| 4 | Popsáni klíčoví aktéři, produkty a business use-cases | 2 | ✅ v uuBookKitu |
| 6 | Návrh backendu (endpointy, datový model) | 2 | ⏳ **aktuální** |
| 7 | Navrženo technické řešení IoT části | 2 | ⬜ |
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
│                # 04-project-management.md
├── iot-node/    # firmware Core Module (README zatím)
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

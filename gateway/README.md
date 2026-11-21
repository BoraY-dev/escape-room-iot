# Gateway (Node-RED)

Gateway běží jako Node-RED flow na Raspberry Pi 5. IoT Node (Arduino Mega 2560) je připojený přes USB,
s cloudem komunikuje přes HTTPS. Návrh: `docs/03-application-model/iot-gateway.md`, protokol s nodem
`iot-protocol.md`, commandy cloudu `command-list-gateway.md`.

## Co gateway dělá

| Záložka flow | Úloha |
|---|---|
| 1 Start a databáze | načte knihovnu `gw`, založí tabulky SQLite, obnoví stav po restartu; jediný přístup k databázi |
| 2 Node (USB) | čte řádky JSON z Arduina (115 200 Bd), registr nodů (`hello`, `hb`, `err`), povely s potvrzením `ack` |
| 3 Hra a data | události do fronty, lokální pravidla hádanek, vzorky teploty a **medián za 5min okno UTC** |
| 4 Cloud | odesílání dávek (max. 100), heartbeat à 30 s, konfigurace, povely à 2 s, registrace, retence |
| 5 Dashboard | `http://<rpi>:1880/ui` – stav cloudu, nodů a fronty, registrační kód, ovládání |
| 6 Simulátor (vývoj) | zprávy „jako z Arduina“ pro test bez hardwaru |

**Fronta dat (SQLite, tabulka `outbox`):** neodeslaná data se drží **bez časového omezení**, cloudem potvrzená
se mažou po **24 h** (diagnostika ze stejného herního dne), potvrzené povely po 7 dnech. Trvale odmítnutý záznam
jde do karantény a neblokuje ostatní.

## Rozšíření: klávesnice, enkodér, LCD

Flow přijme node s firmwarem 1.1.0 a `ENABLE_EXTENSIONS = 1` (`iot-node/README.md`). Cloud nové typy zatím nezná,
proto zůstávají **jen na gateway** (`CLOUD_DEVICE_TYPES` v `src/lib/gw.js`): do heartbeatu ani do fronty nejdou.

- Dashboard *Stav gateway → Rozšíření*: poslední kód z klávesnice, poloha enkodéru, text na LCD.
- Dashboard *Displej nodu (LCD)*: formulář pro ruční text na displeji (diakritika se odstraní, max. 16 znaků).
- Pravidla z cloudu s podmínkou `eq` (kód, poloha) a akcí `showText` gateway vyhodnotí, až je cloud bude umět poslat.
- Simulátor má i `hello` s rozšířením, klávesu, kód a polohu enkodéru.

S MVP firmwarem (`ENABLE_EXTENSIONS = 0`) se flow chová jako dřív.

## Soubory

| Soubor | Obsah |
|---|---|
| `flows.json` | **vygenerovaný** flow pro Node-RED – neupravovat ručně, upravuje se `src/` a spustí `npm run build` |
| `src/lib/gw.js` | výpočty bez sítě a DB: protokol, medián, okna, pravidla hádanek, povely, vyhodnocení odpovědí |
| `src/functions/*.js` | kód jednotlivých function uzlů (název souboru = uzel) |
| `scripts/build-flow.js` | sestaví `flows.json` (uzly, propojení, kontrola) |
| `test/gw.test.js` | testy knihovny (`npm test`) |

## Instalace na Raspberry Pi

1. Node-RED a Node.js (LTS) oficiálním skriptem – vytvoří službu `nodered.service`:

   ```bash
   bash <(curl -fsSL https://raw.githubusercontent.com/node-red/linux-installers/master/deb/update-nodejs-and-nodered)
   ```

   Odpovědi: „Are you really sure?“ → **y**, „Pi-specific nodes?“ → **n** (GPIO nepoužíváme).
   `-f` zajistí, že se při chybě serveru (404) nespustí chybová stránka jako skript. Odkaz přes
   `releases/latest/download/…-deb` už nefunguje (404, ověřeno 21. 11. 2026).

2. Rozšíření Node-RED (sériová linka, dashboard, databáze):

   ```bash
   cd ~/.node-red
   npm install node-red-node-serialport node-red-dashboard node-red-node-sqlite
   ```

3. Účet služby musí mít přístup k USB portům a adresář pro databázi:

   ```bash
   sudo usermod -aG dialout $USER                 # přístup k /dev/ttyACM0
   sudo mkdir -p /var/lib/escape-gateway
   sudo chown $USER: /var/lib/escape-gateway
   ls -l /dev/serial/by-id/                        # stabilní název portu Arduina
   ```

4. Nastavení služby (proměnné prostředí a restart při pádu):

   ```bash
   sudo systemctl edit nodered.service
   ```

   ```ini
   [Service]
   Environment=CLOUD_URL=https://<adresa-backendu>
   Environment=SERIAL_PORT=/dev/serial/by-id/usb-Arduino...   # výstup z ls výše
   Environment=GATEWAY_DB=/var/lib/escape-gateway/gateway.sqlite
   Restart=on-failure
   RestartSec=5
   UMask=0077
   ```

   `UMask=0077` zajistí, že databáze (obsahuje token gateway) je čitelná jen pro účet služby.

5. Flow a autostart:

   ```bash
   cp flows.json ~/.node-red/flows.json            # z tohoto repozitáře
   sudo systemctl daemon-reload
   sudo systemctl enable --now nodered.service     # start teď i po každém zapnutí RPi
   systemctl status nodered.service
   journalctl -u nodered.service -n 50 --no-pager
   ```

6. Registrace: ve webové aplikaci (nebo `POST /gateway/create`) vytvořit gateway k místnosti, registrační kód
   zadat na dashboardu `http://<rpi>:1880/ui` → *Registrace*. Kód platí 24 h a jen jednou.
   Bez dashboardu lze kód předat jednorázově proměnnou `REGISTRATION_CODE` (po registraci ji odstranit).

Editor Node-RED (`:1880`) i dashboard doporučujeme chránit heslem (`adminAuth` a `httpNodeAuth` v `~/.node-red/settings.js`).

## Ověření (bez hardwaru, na PC)

```powershell
cd gateway
npm test                     # testy knihovny
npm run build                # znovu vygeneruje flows.json
npm install --prefix .dev node-red@4 node-red-node-sqlite node-red-dashboard node-red-node-serialport
# v jiném terminálu: cd server; npm run dev:memory
$env:GATEWAY_DB = "$PWD\.dev\gateway.sqlite"; $env:SERIAL_PORT = "COM99"; $env:CLOUD_URL = "http://localhost:3000"
node .dev\node_modules\node-red\red.js --userDir .dev "$PWD\flows.json"
```

V editoru `http://localhost:1880` na záložce *6 Simulátor* klikat na inject uzly (hello, stisk, náklon, teplota);
stav je vidět na `http://localhost:1880/ui`. Ověřeno 19. 11. 2026: registrace kódem, mapování zařízení přes heartbeat,
odeslání událostí čekajících před registrací, medián okna (22, 23, 22, 40, 22 → 22), výpadek cloudu
(data zůstanou ve frontě, po obnovení odejdou se stejným UUID), dashboard.

## Zjednodušení oproti návrhu (základní implementace)

- **Token gateway** je v lokální SQLite (tabulka `kv`, soubor jen pro účet služby díky `UMask=0077`), ne ve vlastním
  credentials uzlu Node-RED. Do dashboardu, logů ani fronty dat se nedostane.
- **Jeden sériový port** (jeden node). Návrh počítá s více nody na více portech.
- Cloudový povel se potvrdí po provedení v místním stavu a zařazení povelů pro node; doručení LED hlídá sériová fronta
  (ack, 3 opakování) a selhání zobrazí na dashboardu.
- Karanténu lze z dashboardu vrátit k odeslání jen celou, ne po jednotlivých záznamech.

# Gateway (Node-RED)

Gateway běží jako Node-RED flow na Raspberry Pi. IoT Node je připojen přes USB (UART).

## Úlohy gateway
- čtení zpráv z IoT Node (`node-red-node-serialport`),
- lokální vyhodnocení pravidel hádanek (pravidla se stahují z cloudu),
- downsampling teploty před odesláním,
- perzistence neodeslaných dat (retence neomezená) a odeslání po obnovení připojení,
- autentizace vůči cloudu (registrace gateway, token),
- dashboard gateway (`node-red-dashboard`),
- automatický start po zapnutí zařízení.

## Instalace (Raspberry Pi)
```bash
bash <(curl -sL https://github.com/node-red/linux-installers/releases/latest/download/update-nodejs-and-nodered-deb)
sudo systemctl enable nodered.service   # automatický start
cd ~/.node-red && npm install node-red-node-serialport node-red-dashboard
```

Flow se ukládá do `flows.json` v této složce (export z Node-RED).

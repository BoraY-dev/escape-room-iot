# Zadání semestrálního projektu – Internet of Things

Cílem je navrhnout a vytvořit kompletní IoT řešení složené z **IoT nodů**, **gateway** a **cloudové aplikace**,
které řeší reálný problém. Výsledkem je MVP – cloudová aplikace dostupná z internetu.

IoT node může být HARDWARIO Core Module (tlačítko, 3osý akcelerometr, digitální teploměr) nebo jiný
mikrokontrolér. Node lze rozšířit o další senzory, moduly a tagy HARDWARIO.

Příklady úloh ze zadání:
- **teploměr** – prevence požáru, úspora energie, prediktivní údržba, meteostanice,
- **akcelerometr** – pád stromu, náraz stroje, neoprávněná manipulace,
- **tlačítko** – přivolání obsluhy, stav výroby, hlášení poruchy, SOS tlačítko.

Každý tým musí **koupit aspoň jeden HARDWARIO Core Module**
([e-shop](https://obchod.hardwario.cz/core-module/), studentská sleva 10 % s kódem `UNICORN10`).

## Architektura

- Bez Radio Donglu: IoT Node komunikuje s Gateway přes **USB/UART**, jeden node na jednu gateway.
- S Radio Donglem (zapojeným do gateway): rádiová komunikace 868/915 MHz, až **32 nodů** na gateway.
- Gateway komunikuje s cloudovou aplikací přes **HTTPS**.

## Požadavky

1. Připravit základní myšlenku projektu.
2. Vytvořit dokumentaci dle **uuApp Framework** (Business Requests, Business Model, Application Model),
   která pokrývá cloud i IoT část (IoT Node, gateway).
3. Zapojit a naprogramovat IoT node (Core Module, VS Code + HARDWARIO Code / TOWER Extension).
4. Naprogramovat **Gateway** jako flow (jedno či více) v **Node-RED** na Raspberry Pi nebo notebooku
   (doporučen Raspberry Pi). Node je připojen přes USB/UART, nebo bezdrátově přes Radio Dongle.
5. Zařízení s gateway musí být nakonfigurováno tak, aby se po zapnutí **Node-RED a jeho závislosti spustily
   automaticky** bez zásahu uživatele. Alternativně gateway jako **Docker image** na notebooku
   (restart kontejneru = vypnutí/zapnutí zařízení; pozor na zpřístupnění USB kontejneru – pro pokročilé).
6. Implementovat cloudovou aplikaci, která přijímá data z gateway, ukládá je a umožňuje je číst.
   Musí umět připojit **více gateway**.
7. Gateway volá endpointy cloudu přes **HTTPS**.
8. Backend nad **Express.js** (nebo nadstavbou), frontend nad **React.js**.
9. Aplikace je **nasazená v cloudu** a plně funkční: node → gateway → cloud.

## Gateway – podrobnosti

- Gateway typicky dělá **downsampling** (node měří každé 1–2 s nebo 10 s, gateway pošle např. jednu hodnotu
  za 5 minut). Strategie: aritmetický průměr, vážený průměr, medián… Volbu je nutné **zdůvodnit a obhájit**.
- Gateway musí **persistovat** naměřená data (po downsamplingu) a při dostupném připojení je **odeslat**.
- Po odeslání data maže, trvale je neuchovává – buď hned, nebo po retenční době (např. 24 h).
  **Retence neodeslaných dat je neomezená.**
  Retence odeslaných dat je na nás, ale **nějaká musí být** a musí být zdůvodněná.
- Gateway se musí do cloudu **registrovat** a při odesílání dat být **autentizovaná a autorizovaná**.
- Potřebná rozšíření Node-RED: kromě rozšíření pro **databázi** (lokální úložiště dat na gateway)
  také `node-red-dashboard` (dashboard gateway) a `node-red-node-serialport` (UART).
- Node.js vždy LTS verze.

Odkazy:
- [Node.js](https://nodejs.org/en/) (LTS), [Node-RED](https://nodered.org),
  [instalace Node-RED](https://nodered.org/docs/getting-started/local#prerequisites)
- [Funkce v Node-RED, context a flow proměnné](https://nodered.org/docs/user-guide/writing-functions#storing-data)

## Proces

Týmová práce: rozdělení činností, organizace práce, metoda řízení, dokumentace všech částí a závěrečná prezentace.
Tyto části jsou podle zadání **nezbytnou součástí řešení** (viz `04-project-management.md`).

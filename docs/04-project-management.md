# Řízení projektu

## Tým a rozdělení práce

| Člen | Odpovědnost |
|---|---|
| **Bora Yildirim** | dokumentace (uuApp Framework), backend (Express.js, MongoDB), frontend (React), nasazení v cloudu, Git repozitář |
| **David Král** | hardware: nákup a zapojení HARDWARIO Core Module, firmware IoT Node, příprava Raspberry Pi |

Gateway (Node-RED) je na rozhraní obou částí – rozdělení je **návrh, k potvrzení**:

| Část gateway | Kdo |
|---|---|
| instalace Node-RED na Raspberry Pi, automatický start (systemd), čtení dat přes UART | David Král |
| vyhodnocení pravidel, downsampling, lokální úložiště, komunikace s cloudem (registrace, HTTPS) | Bora Yildirim |

Rozhraní mezi částmi se domlouvá dokumentem, ne ústně:
- **formát zpráv node → gateway** (UART) – navrhuje se v milníku „Technické řešení IoT části“ (týden 7),
- **REST API gateway → cloud** – navrhuje se v milníku „Návrh backendu“ (týden 6).

## Metoda řízení: Kanban

Práci řídíme metodou **Kanban** přes **GitHub Projects** (tabule napojená na repozitář).

- Sloupce: **To do → In progress → Done**.
- Každý milník je rozdělený na menší úkoly (GitHub Issues), každý úkol má přiřazeného člena týmu.
- Rozpracovaný může mít každý najednou nejvýš 2 úkoly, aby se věci dokončovaly.
- Kanban jsme zvolili místo Scrumu, protože tým je malý a pracuje nepravidelně;
  pevné sprinty a pravidelné porady by byly zbytečná režie. Tempo určují milníky předmětu.

## Komunikace a spolupráce

- Průběžný stav: GitHub Projects (kdo na čem pracuje).
- Týdenní shrnutí stavu projektu do skupiny předmětu.
- Kód: repozitář na GitHubu, malé commity s českou zprávou, větev `main`.
- Dokumentace: uuBookKit, zdrojové texty v `docs/`.

## Plán milníků

| Týden | Milník | Odpovídá |
|---|---|---|
| 3 | Tým, user stories, Git repozitář | Bora |
| 4 | Aktéři, produkty, business use-cases | Bora |
| 6 | Návrh backendu (endpointy, datový model) | Bora |
| 7 | Technické řešení IoT části | oba |
| 7 | Základní implementace backendu | Bora |
| 8 | Základní implementace IoT části (node, gateway) | David (node), oba (gateway) |
| 9 | Návrh frontendu (routy, komponenty) | Bora |
| 10 | Základní implementace frontendu | Bora |
| 12 | Nasazení aplikace v cloudu | Bora |

## Závěrečná prezentace

Osnova (doplní se před koncem semestru):
1. Problém a vize – proč platforma pro únikové hry.
2. Architektura – node, gateway, cloud, frontend.
3. Klíčová rozhodnutí – vyhodnocení pravidel na gateway, downsampling, retence dat, autentizace gateway.
4. **Živá ukázka** – stisk/naklonění modulu → vyřešená hádanka ve webové aplikaci; restart gateway (autostart);
   výpadek internetu a dodatečné odeslání dat.
5. Řízení projektu a co bychom příště udělali jinak.

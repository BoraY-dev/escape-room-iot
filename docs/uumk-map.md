# Mapa dokumentace v uuManagementKit

Odevzdávaná dokumentace je v uuManagementKit (kurz BIOT, Tým 1). Zdrojové texty jsou v `docs/`.
Každý dokument má „Main page“ a podstránky (dropdown u názvu stránky).
Stav k 2. 11. 2026.

## BIOT DL Business Requests – Tým 1 (`01-business-request.md`)

| Stránka | Obsah | Stav |
|---|---|---|
| Main page | Vision + diagram, User Stories US01–US19, rozsah MVP | ✅ |
| Dictionary | Room, Puzzle, Game | ✅ |
| Context | kontext aplikace | ❌ prázdné |
| User story | detail US01–US04 (Why / Goal / Context / Initial situation) | ⚠️ chybí Scenario a Diagram |

## BIOT DL Business Model – Tým 1 (`02-business-model.md`)

| Stránka | Obsah | Stav |
|---|---|---|
| Main page | Overview (A4), životní cyklus hry | ✅ (aktéři, produkty a BUC přesunout do podstránek) |
| Processes | Process Diagram, Process–Products, BUC List Diagram | ❌ šablona |
| Business actors | tabulka aktérů + diagram | ⚠️ připraveno v `02-business-model.md`, vložit |
| Products | Product Overview + class diagram | ⚠️ připraveno, vložit |
| Business use cases | BUC dle šablony (Trigger, Pre/Post-conditions, Happy day, Mockups, data binding) | ⚠️ připraveno, vložit |

Připomínka vyučujícího (25. 10.): aktéry, produkty a BUC převést do podstránek;
**statistiky nejsou produkt**, ale BUC (→ BUC10 Zobrazení statistik).

## BIOT DL Application Model – Tým 1 (`03-application-model.md`)

| Stránka | Obsah | Milník | Stav |
|---|---|---|---|
| Main page | Application Description (node, gateway, cloud, profily, toky dat, zabezpečení), Application Topology | – | ✅ |
| Application Profiles | Role Profiles (Operators, GameMasters, Gateways), Role Group Profiles | 6 | ❌ |
| Persistence Layer | Schema Diagram, Schema, Limit List, DAO Method List | 6 | ❌ šablona |
| Command List | uuCommand: dtoIn validace, dtoOut, chyby (`unsupportedKeys`, `invalidDtoIn`) | 6 | ❌ šablona |
| User view entry points | vstupní body (routy) | 9 | ❌ |
| Routes | Basic Info, props, Component Diagram, render pravidla | 9 | ❌ šablona |
| Components | Basic Info, props, Component Diagram | 9 | ❌ šablona |
| IoT Gateway | Node-RED flow, downsampling, fronta, retence | 7 | ❌ |
| IoT Node | firmware, formát zpráv | 7 | ❌ |

## Co zbývá doplnit

1. Business Requests → Context.
2. Business Requests → User story: Scenario a Diagram u US01–US04.
3. Business Model → Business actors / Products / Business use cases: vložit z `02-business-model.md`.
4. Business Model → Processes: procesní diagram.
5. Application Model → Application Profiles, Persistence Layer, Command List *(týden 6)*.
6. Application Model → IoT Gateway, IoT Node *(týden 7)*.
7. Application Model → User view entry points, Routes, Components *(týden 9)*.

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
| Main page | Overview (A4), životní cyklus hry | ✅ |
| Processes | Process Diagram, Process–Products, BUC List Diagram | ❌ šablona |
| Business actors | tabulka aktérů + diagram | ✅ |
| Products | Product Overview (diagram vazeb + tabulka) | ✅; ❌ šablona „Product Name / Attributes“ – doplnit s datovým modelem (týden 6) |
| Business use cases | BUC List + BUC01–BUC10 na jedné stránce dle šablony | ✅ |

Připomínka vyučujícího (25. 10.): aktéry, produkty a BUC převést do podstránek;
**statistiky nejsou produkt**, ale BUC → **opraveno 2. 11.** (BUC10 Zobrazení statistik), odpověď pod komentářem.

Odchylky od `02-business-model.md` v uuMK: na Main page zůstaly původní diagramy týmu;
kardinality v diagramu produktů vyjadřují typy čar; Data binding je zatím text (pole ještě nejsou navržená).

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
3. Business Model → Processes: procesní diagram.
4. Business Model → Products: atributy produktů („Product Name / Attributes“) *(týden 6)*.
5. Application Model → Application Profiles, Persistence Layer, Command List *(týden 6)*.
6. Application Model → IoT Gateway, IoT Node *(týden 7)*.
7. Application Model → User view entry points, Routes, Components *(týden 9)*.

## Tipy k editaci uuMK (ověřeno 2. 11. 2026)

- **Upravit** → klik na sekci → ⋮ → **„Editovat uu5String“** otevře zdroj sekce; uložení stránky: **„Ukončit úpravy“**.
- Použitelné komponenty: `Uu5Bricks.Section`, `Uu5RichTextBricks.Block uu5String="<uu5string/>…"`,
  `Uu5TilesBricks.Table` (`data`/`columns` jako `<uu5json/>`, buňky mohou být uu5string),
  `UuApp.DesignKit.BusinessScenario` (kroky), `UuBml.Draw.Diagram`.
- `Uu5Bricks.P` **neexistuje** – rozbije načtení komponenty.
- Nadpis první sekce se přes uu5String nepropíše – přepsat přímo v editoru.
- V číslovaných seznamech uuMK skrývá čísla – psát je ručně.
- Editor diagramů: **Escape zavře celý editor** – průběžně ukládat (Save). Popisek spojnice: pravý klik → Add label.
- Mazání komponenty se nedá vrátit („Komponentu nelze obnovit“).

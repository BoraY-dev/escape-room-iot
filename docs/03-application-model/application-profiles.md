# Application Profiles

> Zdroj pro stránku **BIOT DL Application Model – Tým 1 → Application Profiles**.
> Commandy jsou popsané v [`command-list-webapp.md`](command-list-webapp.md).


## Přehled

**Profil** je sada oprávnění. U každého commandu je uvedeno, které profily ho smí volat.
Server profil volajícího ověří **dřív**, než command spustí (jinak `userNotAuthorized`, HTTP 403).

Kromě profilu se kontroluje i **rozsah dat**. Každý objekt patří jedné provozovně a volající smí pracovat
jen s objekty své provozovny. Objekt cizí provozovny se tváří, jako by neexistoval (`…DoesNotExist`, HTTP 404),
takže volající nezjistí ani to, že existuje.

| Profil | Business aktér | Druh | Ověření volajícího | Rozsah dat |
|---|---|---|---|---|
| **Operators** | Provozovatel | člověk, webová aplikace | přihlášení → JWT token | celá vlastní provozovna |
| **GameMasters** | Game master | člověk, webová aplikace | přihlášení → JWT token | místnosti vlastní provozovny (MVP: všechny; rozšíření BUC08: jen přidělené) |
| **Gateways** | Gateway | zařízení, Node-RED | přístupový token gateway z registrace | jen vlastní místnost |

- **JWT** (JSON Web Token) je podepsaný token, který uživatel dostane po přihlášení a posílá ho v hlavičce
  `Authorization: Bearer <token>`. Obsahuje `userId`, `venueId` a roli (`operator` | `gameMaster`).
- Token gateway je vázaný na jedno `gatewayId`. Z něj server odvodí provozovnu i místnost, gateway je sama neposílá.
- **Hráč** profil nemá. Aplikaci nikdy nevolá, ovládá jen fyzické předměty.

## Role Profiles

### Operators

Majitel nebo správce provozovny, který místnosti staví a udržuje.

- spravuje místnosti (`room/*`), pojmenovává zařízení (`device/update`), skládá scénář a hádanky (`scenario/*`, `puzzle/*`),
- smí totéž co game master (`game/*`), protože v malé provozovně hru často řídí sám majitel.

### GameMasters

Zaměstnanec provozovny, který řídí jednotlivé hry.

- **řídí hru**: reset, start, pauza, pokračování, ukončení, ruční vyřešení nebo vrácení hádanky,
- sleduje živý přehled hry (`game/getCurrent`),
- místnosti, zařízení a scénář **jen čte** (aby viděl, co v místnosti je a zda zařízení fungují), ale měnit je nesmí.

### Gateways

Gateway s Node-RED v místnosti (systémový aktér). Volá jen commandy pro gateway, které navrhuje David:
registrace, stažení konfigurace a pravidel, odesílání událostí a měření, heartbeat a převzetí povelů.
**Žádný command webové aplikace volat nesmí.**

Výjimkou je registrace gateway: volá se ještě **před** získáním tokenu, proto se ověřuje
jednorázovým registračním kódem (BUC01).

## Role Group Profiles

| Skupina | Profily | Použití |
|---|---|---|
| **WebUsers** | Operators, GameMasters | lidé přihlášení do webové aplikace (JWT); commandy, které smí volat oba (čtení, řízení hry) |
| **Devices** | Gateways | zařízení s tokenem gateway; všechny commandy pro gateway |

## Matice oprávnění (commandy webové aplikace)

„ano“ = povoleno, „ne“ = odmítnuto s chybou `userNotAuthorized`.

| Command | Operators | GameMasters | Gateways |
|---|:-:|:-:|:-:|
| `room/create`, `room/update`, `room/delete` | ano | ne | ne |
| `room/get`, `room/list` | ano | ano | ne |
| `device/update` | ano | ne | ne |
| `device/list` | ano | ano | ne |
| `scenario/update`, `puzzle/create`, `puzzle/update`, `puzzle/delete` | ano | ne | ne |
| `scenario/get` | ano | ano | ne |
| `game/reset`, `game/start`, `game/pause`, `game/resume`, `game/stop` | ano | ano | ne |
| `game/solvePuzzle`, `game/unsolvePuzzle`, `game/getCurrent` | ano | ano | ne |
| commandy pro gateway (Davidův seznam) | ne | ne | ano |

## Otevřené body

1. **Přihlášení uživatelů** (`user/login`, založení první provozovny a provozovatele) zatím nemá nikdo
   přidělené. Návrh: jednoduchý `user/login` (e-mail + heslo → JWT) a skript, který založí první provozovnu
   a provozovatele. Správa game masterů (US07) je rozšíření.
2. **Přidělení místností game masterům** (BUC08, rozšíření): v MVP vidí game master všechny místnosti provozovny.

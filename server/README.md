# Backend (Express.js + MongoDB)

REST API ve stylu uuCommand podle `docs/03-application-model/` (Command List, Application Profiles, Persistence Layer).

## Spuštění

```powershell
cd server
npm install
npm run dev:memory   # bez Atlasu: dočasná databáze v paměti + demo účty, http://localhost:3000
npm test             # testy API (databáze v paměti)
```

Se skutečnou databází (MongoDB Atlas):

```powershell
copy .env.example .env      # doplnit MONGODB_URI a JWT_SECRET
$env:USER_PASSWORD = "<heslo>"; node scripts/create-user.js --venue "Název provozovny" --email jan@example.com --name "Jan Novák"
npm run dev                 # http://localhost:3000/health
```

Demo účty `npm run dev:memory` (jen lokálně, data po ukončení zmizí):
`operator@demo.local` a `gamemaster@demo.local`, heslo `demo-heslo-123`.

## Struktura

| Soubor / složka | Obsah |
|---|---|
| `src/index.js` | start: připojení k DB, naslouchání na portu |
| `src/app.js` | Express aplikace, registrace commandů |
| `src/command.js` | obal uuCommandu: ověření → validace dtoIn → logika → `uuAppErrorMap` |
| `src/validation.js` | typový zápis dtoIn (`shape`, `string`, `id`, …) jako v Command Listu |
| `src/auth.js` | JWT pro web, token gateway, kontrola profilů |
| `src/models/` | Mongoose schémata a indexy (Persistence Layer) |
| `src/dao/` | jediná vrstva, která mluví s databází (DAO Method List) |
| `src/abl/` | logika commandů: `user`, `room`, `device`, `gateway` |
| `scripts/` | `create-user` (první provozovna a uživatel), `dev-memory` |
| `test/` | testy API (`node --test`, supertest, mongodb-memory-server) |

## Implementované commandy

| Oblast | Commandy | Profily |
|---|---|---|
| Přihlášení | `POST /user/login` | bez tokenu |
| Místnost | `room/create`, `room/get`, `room/list`, `room/update`, `room/delete` | Operators (čtení i GameMasters) |
| Zařízení | `device/list`, `device/update` | Operators (čtení i GameMasters) |
| Gateway – správa | `gateway/create`, `gateway/delete` | Operators |
| Gateway – registrace | `gateway/register` | jednorázový registrační kód |
| Gateway – provoz | `gateway/getConfig`, `gateway/heartbeat`, `gateway/sendEvents`, `gateway/sendMeasurements`, `gateway/getCommands`, `gateway/ackCommands` | Gateways |

Zbývá: `scenario/*`, `puzzle/*`, `game/*` (návrh v Command Listu, implementace s frontendem).

## Příklad: gateway od založení po odeslání dat

```powershell
$base = "http://localhost:3000"
$login = Invoke-RestMethod -Method Post "$base/user/login" -ContentType "application/json" -Body '{"email":"operator@demo.local","password":"demo-heslo-123"}'
$web = @{ Authorization = "Bearer $($login.token)" }
$room = Invoke-RestMethod -Method Post "$base/room/create" -Headers $web -ContentType "application/json" -Body '{"name":"Test"}'
$gw = Invoke-RestMethod -Method Post "$base/gateway/create" -Headers $web -ContentType "application/json" -Body (@{ roomId = $room.id; name = "RPi" } | ConvertTo-Json)
$reg = Invoke-RestMethod -Method Post "$base/gateway/register" -ContentType "application/json" -Body (@{ registrationCode = $gw.registrationCode } | ConvertTo-Json)
$dev = @{ Authorization = "Bearer $($reg.accessToken)" }
Invoke-RestMethod -Method Post "$base/gateway/heartbeat" -Headers $dev -ContentType "application/json" -Body '{"scenarioRevision":0,"deviceList":[{"hwId":"node1.btn1","type":"button"}]}'
Invoke-RestMethod "$base/device/list?roomId=$($room.id)" -Headers $web
```

## Poznámky k implementaci

- `gateway/sendEvents` ukládá událost a její efekt na hru v **transakci MongoDB**; transakce vyžadují replica set
  (Atlas ho má vždy, lokálně `dev:memory` i testy spouštějí jednouzlový replica set).
- Registrační kód (128 bitů) a token gateway (256 bitů) se ukládají jen jako SHA-256 hash, hesla jako bcrypt.
- `user/login` a `gateway/register` mají omezení četnosti (429).
- HTTPS zajistí cloudový hosting (proxy před serverem), aplikace proto nastavuje `trust proxy`.

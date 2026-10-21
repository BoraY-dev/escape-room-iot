# Business Request

## Vision

**IoT platforma pro únikové hry.** Cílem aplikace je, aby provozovatelé únikových her mohli stavět
a měnit hádanky bez programování. Zařízení v místnosti se připojí ke gateway, logika hádanek se složí
z pravidel ve webové aplikaci a game master má pod kontrolou celý průběh hry. Hru může sledovat
živě a kdykoliv zasáhnout.

## User Stories

### Provozovatel únikové hry
| ID | User story |
|---|---|
| US01 | Jako provozovatel chci zaregistrovat gateway ke své provozovně, aby mohla bezpečně posílat data do cloudu. |
| US02 | Jako provozovatel chci vytvořit herní místnost a přiřadit k ní IoT zařízení, abych věděl, co kde je nainstalované. |
| US03 | Jako provozovatel chci vidět stav všech zařízení (online/offline, poslední zpráva), abych odhalil závadu ještě před začátkem hry. |
| US04 | Jako provozovatel chci složit hádanku z pravidel „když – pak“ (např. „když se krabička nakloní o víc než 45°, hádanka je vyřešena“), abych nemusel programovat. |
| US05 | Jako provozovatel chci řetězit hádanky (hádanka B se zpřístupní až po vyřešení A), abych mohl vytvořit celý scénář hry. |
| US06 | Jako provozovatel chci hádanku vyzkoušet v testovacím režimu, abych ověřil, že funguje, než do místnosti pustím hráče. |
| US07 | Jako provozovatel chci přidávat game mastery a přidělovat jim místnosti, aby každý viděl jen to, co řídí. |
| US08 | Jako provozovatel chci vidět statistiky odehraných her (čas, počet nápověd, nejdéle řešené hádanky), abych mohl ladit obtížnost. |

### Game master
| ID | User story |
|---|---|
| US09 | Jako game master chci spustit, pozastavit a ukončit hru, aby se správně měřil čas. |
| US10 | Jako game master chci živě vidět stav hádanek a události ze zařízení, abych věděl, kde se hráči nacházejí. |
| US11 | Jako game master chci ručně označit hádanku za vyřešenou nebo ji vrátit zpět, abych mohl zasáhnout, když zařízení selže nebo hráči uvíznou. |
| US12 | Jako game master chci dostat upozornění, když hráči požádají o nápovědu nebo když vyprší čas, abych mohl včas reagovat. |
| US13 | Jako game master chci být upozorněn, když zařízení během hry přestane komunikovat, abych mohl problém vyřešit dřív, než zkazí zážitek. |
| US14 | Jako game master chci jedním krokem resetovat místnost do výchozího stavu, abych ji rychle připravil pro další skupinu. |

### Hráč
| ID | User story |
|---|---|
| US15 | Jako hráč chci, aby zařízení reagovalo okamžitě, aby hra působila plynule. |
| US16 | Jako hráč chci mít možnost tlačítkem požádat o nápovědu, když nevíme, jak dál. |

### Spolehlivost
| ID | User story |
|---|---|
| US17 | Jako provozovatel chci, aby hra běžela i při výpadku internetu a data se odeslala po jeho obnovení, aby výpadek nezkazil rozehranou hru. |

## Rozsah MVP
Do MVP patří US01–US04, US09–US12, US14–US17. Řetězení hádanek (US05), testovací režim (US06),
správa game masterů (US07) a statistiky (US08) jsou rozšíření, pokud zbude čas.

# Elo Ranking Discord Bot

En Discord-bot der holder styr på Elo-ranking for single- og double-kampe. Bygget som en
[Cloudflare Worker](https://developers.cloudflare.com/workers/) med
[discord-interactions](https://github.com/discord/discord-interactions-js) og MongoDB som database.

## Funktioner

- Elo-ranking for både single- og double-kampe
- Sæsoner med historik og statistik
- Udfordringer, resultatrapportering og accept/afvis-flow
- Holdnavne, som et makkerpar selv sætter pr. kanal
- Admin-kommandoer (nulstil sæson, annullér kampe m.m.)

## Tech stack

| Del          | Teknologi                          |
| ------------ | ---------------------------------- |
| Runtime      | Cloudflare Workers                 |
| Discord      | `discord-interactions`             |
| Database     | MongoDB (`mongodb` driver)         |
| Deploy/dev   | Wrangler                           |

## Kom i gang (lokal udvikling)

### 1. Forudsætninger

- [Node.js](https://nodejs.org/) (LTS)
- En [Cloudflare-konto](https://dash.cloudflare.com/) (gratis)
- En [Discord-applikation](https://discord.com/developers/applications)
- En [MongoDB-database](https://www.mongodb.com/atlas) (fx gratis MongoDB Atlas)

### 2. Klon og installér

```bash
git clone https://github.com/<dit-brugernavn>/eloranking.git
cd eloranking
npm install
```

### 3. Opsæt hemmeligheder

Kopiér eksempelfilen og udfyld dine egne værdier:

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` er ignoreret af git og bliver aldrig committet. Du skal bruge:

| Variabel             | Hvor finder jeg den?                                                        |
| -------------------- | --------------------------------------------------------------------------- |
| `DISCORD_PUBLIC_KEY` | Discord Developer Portal → din app → **General Information** → Public Key    |
| `MONGODB_URI`        | MongoDB Atlas → **Connect** → connection string                             |

### 4. Kør lokalt

```bash
npx wrangler dev
```

### 5. Registrér slash-kommandoer i Discord

`command-setup.js` sender kommando-listen til Discord. Kør den med dine hemmeligheder som
miljøvariabler (**commit dem aldrig**):

```bash
# Git Bash / Linux / macOS
APP_ID=din_app_id BOT_TOKEN=din_bot_token node command-setup.js
```

```powershell
# PowerShell (Windows)
$env:APP_ID="din_app_id"; $env:BOT_TOKEN="din_bot_token"; node command-setup.js
```

- `APP_ID`: Discord Developer Portal → **General Information** → Application ID
- `BOT_TOKEN`: Discord Developer Portal → **Bot** → **Reset Token**

## Holdnavne

Et makkerpar kan give sig selv et navn, så doubler ikke bare er "Team 1" og
"Team 2". Et hold ER de to spillere: dit holdnavn hænger på hvem du spiller med,
og de to spillere er de eneste der kan ændre det — det følger af kommandoen, som
kun kan navngive det hold man selv er den ene halvdel af.

| Kommando                                  | Hvad den gør                                     |
| ----------------------------------------- | ------------------------------------------------ |
| `/set-team-name teammate:@X name:Navnet`  | Døber holdet dig + X.                            |
| `/set-team-name teammate:@X`              | Fjerner navnet igen (`name` udeladt).            |
| `/team-name teammate:@X`                  | Viser hvad I to hedder.                          |
| `/team-list`                              | Alle navngivne hold i kanalen.                   |

Navne er **pr. kanal**, ligesom ranglisten. Det samme makkerpar kan hedde noget
forskelligt i to kanaler, og et navn taget i den ene kanal blokerer ikke i den
anden.

Nummeret bliver altid stående foran navnet:

```
The teams are:
Team 1 — Nordic Chaos: @mikkel, @Christian Lund (elo: 983)
Team 2: @Morten, @Lukas (elo: 1017.5)
```

Det er nummeret `/result team_1_score:` og `/bet team:1` peger på, så et hold der
kun stod med sit navn ville efterlade folk uden en reference. Hold uden navn står
som før. Navnet vises i `/play`, `/reroll`, `/play-double`, `/double-accepted`,
`/matches-overview`, `/result`, `/bet` og i væddemålsafregningen.

To hold i samme kanal kan ikke hedde det samme — store og små bogstaver tæller
ikke med. Reglen håndhæves af et unikt indeks på (kanal, navn), ikke af en
læsning inden skrivningen, så to der omdøber samtidig ikke kan slippe forbi
hinanden. Navnet må være 2–40 tegn og må ikke indeholde `@` eller markdown-tegn:
det står midt i en offentlig besked, og skal hverken kunne pinge nogen eller
brække formateringen.

Begge spillere skal være med på ranglisten i kanalen (`/join-ranking`). Navnene
ligger i `Teams`-kollektionen, ét dokument pr. makkerpar pr. kanal; intet dokument
betyder bare "intet navn", så der er ikke noget at migrere.

De tre kommandoer skal registreres i Discord med `command-setup.js` — se
afsnittet ovenfor.

## Deploy til produktion

```bash
# Sæt produktions-secrets i Cloudflare (gemmes krypteret, ikke i koden)
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put MONGODB_URI
npx wrangler secret put DISCORD_BOT_TOKEN

# Deploy
npx wrangler deploy
```

### RNGdle

RNGdle er et terningspil i Discord. Hver spiller får **ét rul om dagen**: botten
trækker et tilfældigt tal mellem 0 og 1.000.000 og giver point (EP) efter, hvor
interessant tallet er. Point lægges sammen over tid til en fælles stilling.

| Kommando                        | Hvad den gør                                                     |
| ------------------------------- | ---------------------------------------------------------------- |
| `/roll`                         | Rul dagens tal. Ét pr. spiller pr. døgn.                         |
| `/roll-ranking`                 | Den samlede EP-stilling for alle spillere.                       |
| `/roll-ranking board:highest`   | De bedste enkeltrul nogensinde.                                  |
| `/roll-ranking board:lowest`    | De dårligste enkeltrul nogensinde — hall of shame.               |
| `/roll-ranking board:daily`     | Dagens felt indtil videre, bedste rul først.                     |

`board:highest` og `board:lowest` rangerer **rul**, ikke spillere, så den
samme spiller kan fylde flere pladser. Begge er sorteret på EP, ikke på
tallets størrelse — små tal som 0, 7 og 69 scorer skyhøjt og havner aldrig på
`board:lowest`.

Sæt `RNGDLE_CHANNEL_ID` i `wrangler.toml` til ID'et på den kanal, spillet skal
køre i. De to kommandoer virker **kun** der, og de øvrige kommandoer virker
**alle andre steder end** der — Elo-ranglisten scopes på kanal, så de to ting
skal holdes adskilt. Hver dag kl. 16:00 (København) annoncerer botten dagens
bedste rul og den samlede stilling. Det kræver `DISCORD_BOT_TOKEN` som secret.

Døgnet følger København, ikke UTC. Hvert rul gemmes som ét dokument i
`RngdleRolls`-kollektionen, og stillingen regnes altid ud fra rullene — der er
ingen separat total, der kan komme ud af trit. Et unikt indeks på
(kanal, spiller, dato) er det, der håndhæver ét rul om dagen.

Slår et rul din egen højeste eller laveste EP — eller kanalens — bliver det sagt
i rulbeskeden med det samme. Rekorderne regnes ud fra rullene i kanalen lige før
dit eget, en global rekord fortrænger den personlige, og en tangering tæller
ikke. Bandlystes rul holdes ude, ligesom i stillingen, og det allerførste rul i
kanalen sætter ingen rekord — det ville trivielt være både det højeste og det
laveste.

#### Pointsystemet

Tallet testes mod 230 badges — meme-tal (69, 420, 1337), palindromer, ens cifre,
sekvenser, primtal, potenser, cifresummer og mere. EP er summen af de badges,
tallet rammer. Badges er samlet i 40 **familier**, hvor kun det dyreste optjente
badge i hver familie tæller; ellers ville 777777 score Jackpot, Jackpot Four,
Five, Six og Exact Jackpot oveni hinanden.

Scoringen er en ren funktion af tallet — samme tal giver altid samme EP. Reglerne
ligger i `src/rngdle.js` og er verificeret tal-for-tal mod en uafhængig
implementering af rngdle.com's regler: alle 1.000.001 tal gav samme EP og samme
badges. Resultatet er låst fast med et fingeraftryk:

```bash
npm test
```

Den fejler, hvis en badge-test, en EP-værdi eller en familie ændrer sig. Er
ændringen bevidst, kør `node test/parity.mjs --update` og commit det nye
fingeraftryk sammen med ændringen.

Den samlede EP på ét rul giver en tier, hvor grænserne er percentiler over alle
mulige tal — så 1% af alle rul er mythic, 5% er epic, og så videre:

| Tier     | Total EP    | Andel af alle tal |
| -------- | ----------- | ----------------- |
| 🗑️ trash    | < 2.098     | 1,0 %             |
| ⚪ common   | < 5.761     | 49,0 %            |
| 🟢 uncommon | < 9.644     | 25,0 %            |
| 🔵 rare     | < 23.077    | 15,0 %            |
| 🟣 epic     | < 35.744    | 5,0 %             |
| 🟠 anomaly  | < 164.953   | 4,0 %             |
| 🌟 mythic   | ≥ 164.953   | 1,0 %             |

#### Bandlys en snyder

Sæt `RNGDLE_BANNED_IDS` i `wrangler.toml` til en kommasepareret liste af Discord-bruger-ID'er
(højreklik på brugeren i Discord → **Kopiér bruger-ID**; kræver Udviklertilstand under
Indstillinger → Avanceret). Deploy bagefter med `npx wrangler deploy`.

```toml
RNGDLE_BANNED_IDS = "123456789012345678,987654321098765432"
```

En bandlyst bruger:

- får afvist både `/roll` og `/roll-ranking`
- tælles ikke med i dagens resultat — hverken som vinder eller i deltagerlisten
- filtreres ud af den samlede stilling
- får nægtet **Send Messages** i RNGdle-kanalen af botten

Skriveblokeringen kræver at bottens rolle har **Manage Roles** i serveren og ligger **over**
brugerens højeste rolle i rollelisten. Kan botten ikke sætte rettigheden, logges det og resten
af bandlysningen virker stadig; den sættes på næste cron-kørsel efter deploy.

Nu hvor botten selv trækker tallet, er det i praksis ikke længere muligt at snyde med
et resultat — bandlysning er kun et værktøj til at holde nogen ude af spillet.

Peg til sidst din Discord-apps **Interactions Endpoint URL** hen på din deployede Worker-URL.

## Bidrag til projektet

Bidrag er meget velkomne! Sådan gør du:

1. **Fork** dette repository.
2. Lav en branch til din feature: `git checkout -b feature/min-fede-feature`
3. Lav dine ændringer og commit: `git commit -m "Tilføj min fede feature"`
4. Push til din fork: `git push origin feature/min-fede-feature`
5. Åbn en **Pull Request** her på GitHub.

### Retningslinjer

- **Commit aldrig hemmeligheder** (tokens, connection strings). Brug `.dev.vars` lokalt.
- Test dine ændringer lokalt med `npx wrangler dev` før du åbner en PR.
- Hold gerne PR'er små og fokuserede på én ting.
- Har du en idé, men er usikker på implementeringen? Åbn et **Issue** og lad os snakke om det først.

## Licens

ISC

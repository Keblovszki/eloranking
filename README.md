# Elo Ranking Discord Bot

En Discord-bot der holder styr på Elo-ranking for single- og double-kampe. Bygget som en
[Cloudflare Worker](https://developers.cloudflare.com/workers/) med
[discord-interactions](https://github.com/discord/discord-interactions-js) og MongoDB som database.

## Funktioner

- Elo-ranking for både single- og double-kampe
- Sæsoner med historik og statistik
- Udfordringer, resultatrapportering og accept/afvis-flow
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

| Kommando        | Hvad den gør                                  |
| --------------- | --------------------------------------------- |
| `/roll`         | Rul dagens tal. Ét pr. spiller pr. døgn.      |
| `/roll-ranking` | Den samlede EP-stilling for alle spillere.    |

Sæt `RNGDLE_CHANNEL_ID` i `wrangler.toml` til ID'et på den kanal, spillet skal
køre i. De to kommandoer virker **kun** der, og de øvrige kommandoer virker
**alle andre steder end** der — Elo-ranglisten scopes på kanal, så de to ting
skal holdes adskilt. Hver dag kl. 16:00 (København) annoncerer botten dagens
bedste rul og den samlede stilling. Det kræver `DISCORD_BOT_TOKEN` som secret.

Døgnet følger København, ikke UTC. Hvert rul gemmes som ét dokument i
`RngdleRolls`-kollektionen, og stillingen regnes altid ud fra rullene — der er
ingen separat total, der kan komme ud af trit. Et unikt indeks på
(kanal, spiller, dato) er det, der håndhæver ét rul om dagen.

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

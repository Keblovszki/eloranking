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

### RNGdle-kanal

Sæt `RNGDLE_CHANNEL_ID` i `wrangler.toml` til ID'et på den kanal, hvor spillere
poster deres RNGdle-resultater. Hver dag kl. 16:00 (København) læser botten
dagens resultater i den kanal og annoncerer dagens bedste (flest EP), med tag
af alle der har postet et resultat den dag. Kræver `DISCORD_BOT_TOKEN` som
secret (se ovenfor) med **Read Message History**-tilladelse i kanalen.

Kun hver spillers **første** resultat på dagen tælles. Pointene lægges sammen
over tid i `Rngdle`-kollektionen (ét dokument pr. kanal), og den samlede
stilling vises i samme besked som dagens vinder. Der er ingen kommando til den —
den følger automatisk med hver daglige annoncering.

RNGdle nulstiller kl. 02:00 (København), og det er dér dagen tælles fra. Botten
poster en skillelinje med dagens dato på nulstillingstidspunktet, så det er til
at se hvor dagen skifter — alt der postes under markøren tæller med i den
følgende annoncering kl. 16:00. Markøren er en bot-besked og kan derfor aldrig
selv ende på stillingen.

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

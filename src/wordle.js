// Wordle-ranglisten. Wordle-appen poster selv gruppens resultat hver morgen —
// "Here are yesterday's results:" efterfulgt af én linje pr. antal forsøg — og
// det er den besked vi læser. Der er ingen kommando spillerne skal huske, og
// derfor heller ikke noget at snyde med: tallene kommer fra Wordle, ikke fra os.
//
// Alt i denne fil er rene funktioner uden database og uden netværk, så hele
// fortolkningen og pointudregningen kan testes mod en rigtig besked
// (test/wordle.mjs).

// Wordle-appens bruger-id. Kun beskeder FRA appen tælles — ellers kunne enhver
// skrive "1/6: @migselv" i kanalen og komme på ranglisten.
export const WORDLE_APP_ID = "1211781489931452447";

// Et forsøg der ikke løste ordet ("X/6") skal tabe til alle der løste det, og
// stå lige med andre der heller ikke løste det. 7 gør præcis det, uden at
// sammenligningen behøver kende til et særtilfælde.
export const WORDLE_FAILED_GUESSES = 7;

// Elo pr. dag fordeles over modstanderne. Uden delingen ville en dag med 6
// spillere flytte op til 5 gange så mange point som en dag med 2 — så ville
// ranglisten mest måle hvor mange der var med, ikke hvem der var bedst.
const WORDLE_K = 48;

export const WORDLE_START_RATING = 1000;

// Resultatlinjerne ser sådan ud (👑 står på dagens bedste):
//   👑 2/6: <@1411995926301638731> @Troels
//   X/6: <@238650592589774848>
// Bemærk at nogle spillere står som rigtige mentions og andre som ren tekst —
// samme spiller kan skifte form fra dag til dag. Den rene tekst har intet id,
// så den skal slås op på navnet bagefter.
const RESULT_LINE = /^\s*(?:👑\s*)?([1-6X])\/6:\s*(.+)$/iu;
const STREAK_LINE = /on\s+(?:an?\s+)?(\d+)\s+day\s+streak/i;

// Dagens deltagere står efter kolonet som en blanding af "<@id>" og "@Navn".
// Et visningsnavn kan indeholde mellemrum ("Peter - pfrank"), så et navn kan
// ikke bare læses som "frem til næste mellemrum". Derfor prøves de kendte navne
// fra serveren først, længste først, og kun hvis intet matcher falder vi tilbage
// til ét ord. nameIndex er små bogstaver -> id (se buildWordleNameIndex).
export function parseWordlePlayers(rest, nameIndex) {
    // Længste navne først, så "Peter - pfrank" vinder over et medlem der bare
    // hedder "Peter".
    const knownNames = [...(nameIndex?.keys() ?? [])].sort((a, b) => b.length - a.length);
    const players = [];
    let i = 0;

    while (i < rest.length) {
        const ch = rest[i];
        if (ch === '<') {
            const end = rest.indexOf('>', i);
            const mention = end === -1 ? null : /^<@!?(\d+)>$/.exec(rest.slice(i, end + 1));
            if (mention) {
                players.push({ playerId: mention[1], rawName: null });
                i = end + 1;
                continue;
            }
        }
        if (ch === '@') {
            const after = rest.slice(i + 1);
            const lower = after.toLowerCase();
            const hit = knownNames.find(n => lower.startsWith(n));
            const rawName = hit ? after.slice(0, hit.length) : (after.match(/^[^\s<@]+/)?.[0] ?? "");
            if (rawName) {
                players.push({ playerId: nameIndex?.get(rawName.toLowerCase()) ?? null, rawName });
                i += 1 + rawName.length;
                continue;
            }
        }
        i++;
    }
    return players;
}

// Læser én dagsbesked. Returnerer null hvis beskeden ikke er et dagsresultat —
// Wordle-appen poster også andet i kanalen. guesses er 1-6, eller
// WORDLE_FAILED_GUESSES for "X/6".
export function parseWordleMessage(content, nameIndex) {
    if (!content) return null;

    const results = [];
    const unresolved = [];
    for (const line of content.split('\n')) {
        const match = RESULT_LINE.exec(line);
        if (!match) continue;

        const [, score, rest] = match;
        const guesses = score.toUpperCase() === 'X' ? WORDLE_FAILED_GUESSES : Number(score);
        for (const player of parseWordlePlayers(rest, nameIndex)) {
            if (player.playerId) results.push({ playerId: player.playerId, name: player.rawName, guesses });
            // Et navn vi ikke kan sætte et id på kan ikke få point, men det skal
            // stadig kunne ses at der manglede nogen — ellers ser en halv dag ud
            // som en hel.
            else unresolved.push(player.rawName);
        }
    }
    if (results.length === 0) return null;

    // Samme spiller kan i princippet stå på to linjer (fx hvis appen retter en
    // besked). Det bedste resultat gælder, så en dobbeltopført spiller ikke
    // ender med at tabe til sig selv.
    const best = new Map();
    for (const r of results) {
        const seen = best.get(r.playerId);
        if (!seen || r.guesses < seen.guesses) best.set(r.playerId, r);
    }

    return {
        results: [...best.values()],
        unresolved,
        streak: Number(STREAK_LINE.exec(content)?.[1]) || null
    };
}

// Hver dag er en lille turnering: alle mod alle, færrest forsøg vinder. Alle
// deltagere bedømmes mod DAGENS startpoint — havde vi opdateret undervejs,
// ville rækkefølgen af par afgøre resultatet.
//
// ratingOf(playerId) skal give spillerens point før dagen. Returnerer én
// opdatering pr. spiller med delta, ny rating og dagens placering.
export function wordleEloUpdates(results, ratingOf) {
    if (results.length < 2) {
        // Med én deltager er der ingen at vinde over. Dagen tælles stadig som
        // spillet, men point flytter sig ikke.
        return results.map(r => ({
            ...r, before: ratingOf(r.playerId), delta: 0, rating: ratingOf(r.playerId),
            rank: 1, opponents: 0, won: true
        }));
    }

    const best = Math.min(...results.map(r => r.guesses));
    const k = WORDLE_K / (results.length - 1);

    return results.map(player => {
        const before = ratingOf(player.playerId);
        let sum = 0;
        for (const other of results) {
            if (other.playerId === player.playerId) continue;
            const score = player.guesses < other.guesses ? 1 : player.guesses === other.guesses ? 0.5 : 0;
            const expected = 1 / (1 + Math.pow(10, (ratingOf(other.playerId) - before) / 400));
            sum += k * (score - expected);
        }
        const delta = Math.round(sum);
        return {
            ...player,
            before,
            delta,
            rating: before + delta,
            // Placering deles ved samme antal forsøg: to på 2/6 er begge nr. 1.
            rank: results.filter(r => r.guesses < player.guesses).length + 1,
            opponents: results.length - 1,
            won: player.guesses === best
        };
    });
}

// Hvad ét resultat gør ved spillerens samlede tal. Holdes her hos Elo-udregningen,
// så en dag altid opdaterer rating og statistik på én gang.
export function wordleStatsIncrement(update) {
    const solved = update.guesses < WORDLE_FAILED_GUESSES;
    return {
        days: 1,
        wins: update.won ? 1 : 0,
        solved: solved ? 1 : 0,
        failed: solved ? 0 : 1,
        // Snittet regnes kun på løste ord; et X har intet meningsfuldt antal
        // forsøg, og at lade det tælle som 7 ville blande "dårlig" sammen med
        // "gav op".
        solvedGuesses: solved ? update.guesses : 0
    };
}

export function wordleScoreLabel(guesses) {
    return guesses >= WORDLE_FAILED_GUESSES ? 'X/6' : `${guesses}/6`;
}

// Test af svarvejen og af hvordan en accepteret kamp rykker point.
//
// Botten kvitterer på en slash-kommando med det samme og leverer først svaret
// bagefter. Det er dér det gik galt før: tog arbejdet mere end 3 sekunder,
// kasserede Discord svaret, mens databasen allerede var skrevet — kampen var
// afgjort uden at nogen kunne se det. Testen låser de to ting fast der gør
// leveringen rigtig: at svaret rammer den rigtige Discord-endpoint, og at
// ephemeral-flaget ikke slipper med over i en redigering, hvor det ikke kan
// bruges til noget.
//
//   node test/reply.mjs

import {
    sendReply, buildRatingUpdate, EPHEMERAL_COMMANDS,
    teamPairKey, normalizeTeamName, teamHeading,
    makePercentileLookup, formatPercentileShort, formatRngdleHistory,
    recordsForDay, formatRngdleDayResult
} from '../src/index.js';

const failures = [];

function check(label, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) failures.push(`${label}\n     forventet ${e}\n     fik       ${a}`);
}

// Fanger kaldene til Discord i stedet for at sende dem.
async function deliver(commandName, reply) {
    const real = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({
            method: init.method,
            path: new URL(url).pathname.slice('/api/v10/webhooks/app-1/tok-1'.length) || '/',
            body: init.body ? JSON.parse(init.body) : null
        });
        return new Response(null, { status: 204 });
    };
    try {
        await sendReply({ application_id: 'app-1', token: 'tok-1', data: { name: commandName } }, reply);
    } finally {
        globalThis.fetch = real;
    }
    return calls;
}

// --- Levering ---

// Et offentligt svar på en offentlig kommando: kvitteringen bliver bare til svaret.
{
    const calls = await deliver('result', { content: 'Result reported' });
    check('offentligt svar redigerer kvitteringen', calls.map(c => c.method), ['PATCH']);
    check('offentligt svar rammer @original', calls[0].path, '/messages/@original');
    check('offentligt svar sender indholdet', calls[0].body, { content: 'Result reported' });
}

// Et ephemeral svar på en ephemeral kommando: også bare en redigering — men
// flaget må ikke med. Det blev sat på kvitteringen, og en redigering kan ikke
// ændre synligheden.
{
    const calls = await deliver('bet', { content: '💰 You bet on Team 1', flags: 64 });
    check('ephemeral svar redigerer kvitteringen', calls.map(c => c.method), ['PATCH']);
    check('flaget følger ikke med i redigeringen', calls[0].body, { content: '💰 You bet on Team 1' });
}

// /roll er offentlig i det almindelige tilfælde, men "du har allerede rullet i
// dag" skal kun rulleren se. Synligheden kan ikke ændres bagefter, så svaret
// sendes som en followup, og den offentlige kvittering fjernes.
{
    const calls = await deliver('roll', { content: 'You already rolled today.', flags: 64 });
    check('ephemeral svar på offentlig kommando bliver en followup',
        calls.map(c => c.method), ['POST', 'DELETE']);
    check('followuppen sendes før kvitteringen fjernes', calls[0].path, '/');
    check('followuppen beholder flaget',
        calls[0].body, { content: 'You already rolled today.', flags: 64 });
    check('kvitteringen fjernes', calls[1].path, '/messages/@original');
}

check('/roll står ikke som altid-ephemeral', EPHEMERAL_COMMANDS.has('roll'), false);
check('/bet står som altid-ephemeral', EPHEMERAL_COMMANDS.has('bet'), true);

// --- Pointtildeling ---

// $inc frem for $set: to kampe der afregnes samtidig må ikke kunne overskrive
// hinandens point.
check('sejr: point op, sejrsstime op, nederlagsstime nulstilles',
    buildRatingUpdate('doubleRanking', 16, 1),
    { $inc: { doubleRanking: 16, winningStreak: 1, wins: 1 }, $set: { losingStreak: 0 } });

check('nederlag: point ned, nederlagsstime op, sejrsstime nulstilles',
    buildRatingUpdate('singleRanking', -16, 0),
    { $inc: { singleRanking: -16, losingStreak: 1, loses: 1 }, $set: { winningStreak: 0 } });

check('uafgjort rykker kun pointene',
    buildRatingUpdate('doubleRanking', 3, 0.5),
    { $inc: { doubleRanking: 3 } });

// --- Holdnavne ---

// Et hold er de to spillere, ikke en rækkefølge. Slog nøglen fejl her, ville
// makkerparret få ét navn når den ene skrev kommandoen og et andet når den anden
// gjorde.
check('makkerparret er det samme uanset rækkefølgen',
    teamPairKey('222', '111'), teamPairKey('111', '222'));

// Navnet står midt i en offentlig besked. Kan det pinge eller bryde markdown,
// kan et holdnavn bruges til at rode med alt det botten skriver.
check('mentions afvises', !!normalizeTeamName('@everyone lol').error, true);
check('markdown afvises', !!normalizeTeamName('**bold**').error, true);
check('for kort afvises', !!normalizeTeamName(' a ').error, true);
check('for langt afvises', !!normalizeTeamName('a'.repeat(41)).error, true);
check('manglende navn afvises', !!normalizeTeamName(undefined).error, true);

// Linjeskift ville trække holdlinjen fra hinanden i kampbeskeden.
check('whitespace koges ned til ét mellemrum',
    normalizeTeamName('  Nordic \n  Chaos '), { name: 'Nordic Chaos', nameKey: 'nordic chaos' });

// Nummeret er det /result og /bet peger på, så det skal stå der uanset om holdet
// har et navn eller ej.
check('nummeret bliver stående foran navnet',
    teamHeading(1, 'Nordic Chaos'), 'Team 1 — Nordic Chaos');
check('et hold uden navn står med sit nummer alene',
    teamHeading(2, null), 'Team 2');

// --- RNGdle-historik ---

// Percentilen i historikken regnes lokalt ud af kanalens EP-fordeling i stedet
// for med tre tællinger pr. rul. Regnestykket SKAL være det samme som
// getRollPercentile laver i databasen: begge sider tælles ærligt hver for sig,
// og rullet tæller sig selv med. Fire rul med EP 0, 10, 10 og 100.
{
    const at = makePercentileLookup([
        { _id: 0, count: 1 }, { _id: 10, count: 2 }, { _id: 100, count: 1 }
    ]);

    check('det bedste rul er top 25% (1 af 4 er mindst så højt)',
        at(100), { topPercent: 25, bottomPercent: 100, total: 4 });
    check('det dårligste rul er bund 25%',
        at(0), { topPercent: 100, bottomPercent: 25, total: 4 });
    // Delte pladser tæller med på BEGGE sider: begge tiere er "mindst så høje"
    // som hinanden og "mindst så lave" som hinanden.
    check('delt EP tæller med på begge sider',
        at(10), { topPercent: 75, bottomPercent: 75, total: 4 });
}

// Uden rul i kanalen er der ingen percentil at vise — og ingen division med nul.
check('tom fordeling giver ingen percentil', makePercentileLookup([])(0), null);

// Samme valg af side som den store percentillinje på /roll: vis den side rullet
// hører til, så et bundrul ikke står som "top 88%".
check('høj percentil vises som top', formatPercentileShort({ topPercent: 3, bottomPercent: 98 }), 'top 3.0%');
check('lav percentil vises som bund', formatPercentileShort({ topPercent: 98, bottomPercent: 3 }), 'bottom 3.0%');
check('uafgjort falder ud til top', formatPercentileShort({ topPercent: 50, bottomPercent: 50 }), 'top 50%');
check('manglende percentil giver ingen tekst', formatPercentileShort(null), null);

function historyRoll(dateKey, number, ep, tier, percentile) {
    return { dateKey, number, ep, tier, percentile };
}

// Nyeste rul først, og hver linje bærer sin egen percentil.
{
    const text = formatRngdleHistory({
        name: 'Hannibal',
        totalEp: 30000,
        rolls: [
            historyRoll('2025-09-08', 777777, 25000, 'epic', { topPercent: 2, bottomPercent: 99 }),
            historyRoll('2025-09-07', 481902, 5000, 'trash', { topPercent: 97, bottomPercent: 4 })
        ]
    });

    // Tusindtalsseparatoren følger maskinens locale, ligesom resten af botten,
    // så forventningen formateres på samme måde i stedet for at være hardcodet.
    const ep = n => n.toLocaleString();
    check('historikken har overskrift, opsummering, streg og én linje pr. rul',
        text.split('\n'), [
            '📜 **RNGdle history — Hannibal** 📜',
            `🎲 2 rolls · 💰 **${ep(30000)} EP** · ⌀ ${ep(15000)} EP per roll`,
            '--------------------------------------',
            `2025-09-08 — 🎲 **777777** 🟣 **${ep(25000)} EP** (top 2.0%)`,
            `2025-09-07 — 🎲 **481902** 🗑️ **${ep(5000)} EP** (bottom 4.0%)`
        ]);
}

// En Discord-besked kan højst rumme 2000 tegn, så en lang historik skæres af i
// stedet for at få hele svaret afvist.
{
    const many = Array.from({ length: 20 }, (_, i) =>
        historyRoll(`2025-09-${String(i + 1).padStart(2, '0')}`, i, 100, 'common', null));
    const lines = formatRngdleHistory({ name: 'Hannibal', totalEp: 2000, rolls: many }).split('\n');

    // 2 linjer overskrift + 1 streg + 15 rul + 1 afkortningslinje.
    check('lang historik skæres af', lines.length, 19);
    check('afkortningen siger hvor mange der mangler', lines.at(-1), '…and 5 more');
}

check('/roll-history står som altid-ephemeral', EPHEMERAL_COMMANDS.has('roll-history'), true);

// --- RNGdle-dagsresultat ---

function dayRoll(playerId, number, ep, tier, minute) {
    return { playerId, number, ep, tier, rolledAt: new Date(Date.UTC(2025, 8, 9, 10, minute)) };
}

// Rekorderne skal falde ud som ved selve rullet: hvert rul måles mod alt der lå
// før det. Kanalens rekord før dagen er 20.000/500; Anna har 8.000/2.000, Bo
// 3.000/1.000, Carl har aldrig rullet.
{
    const before = {
        globalMax: 20000, globalMin: 500,
        personal: new Map([
            ['anna', { max: 8000, min: 2000 }],
            ['bo', { max: 3000, min: 1000 }]
        ])
    };
    const todays = [
        dayRoll('bo', 111, 25000, 'anomaly', 30),   // slår kanalens rekord, men efter Anna
        dayRoll('anna', 222, 21000, 'epic', 10),      // slår kanalens rekord først
        dayRoll('carl', 333, 600, 'trash', 20),       // første rul nogensinde -> ingen rekord
        dayRoll('dan', 444, 4000, 'rare', 40)
    ];
    const records = recordsForDay(todays, before).map(r => `${r.roll.playerId}:${r.record.scope}:${r.record.kind}`);
    check('dagens rekorder tælles i rullerækkefølge og den globale rekord løber med',
        records, ['anna:global:high', 'bo:global:high']);

    // Rammer rullet under den løbende rekord, er det højst en personlig rekord.
    const later = recordsForDay([dayRoll('anna', 222, 21000, 'epic', 10), dayRoll('bo', 111, 20500, 'epic', 30)], before)
        .map(r => `${r.roll.playerId}:${r.record.scope}:${r.record.kind}`);
    check('et rul der slår den gamle men ikke dagens rekord er kun personlig',
        later, ['anna:global:high', 'bo:personal:high']);

    check('en tangering er ikke en rekord',
        recordsForDay([dayRoll('anna', 1, 8000, 'rare', 1), dayRoll('bo', 2, 1000, 'common', 2)], before), []);
    check('personlig bund fanges', recordsForDay([dayRoll('bo', 2, 900, 'common', 2)], before)
        .map(r => `${r.record.scope}:${r.record.kind}`), ['personal:low']);
}

// Uden rul før dagen er intet en rekord — det allerførste felt er trivielt både
// højest og lavest.
check('ingen tidligere rul giver ingen rekorder', recordsForDay([dayRoll('anna', 1, 5, 'trash', 1)], null), []);

// Podiet viser kun de tre bedste med percentil, og rekorderne står som egen sektion.
{
    const todays = [
        dayRoll('dan', 444, 4000, 'rare', 40),
        dayRoll('anna', 222, 21000, 'epic', 10),
        dayRoll('carl', 333, 100, 'trash', 20),
        dayRoll('bo', 111, 25000, 'anomaly', 30)
    ];
    const at = ep => ({ topPercent: ep >= 21000 ? 2 : 60, bottomPercent: ep >= 21000 ? 99 : 41 });
    const records = [{ roll: todays[3], record: { scope: 'global', kind: 'high' } }];
    const sections = formatRngdleDayResult(todays, at, records);
    const ep = n => n.toLocaleString();

    check('podiet er de tre bedste, bedst først, med percentil', sections[0].split('\n'), [
        '🏆 **Top rolls today**',
        `🥇 <@bo> — 🎲 **111** 🟠 **${ep(25000)} EP** (top 2.0% of all rolls)`,
        `🥈 <@anna> — 🎲 **222** 🟣 **${ep(21000)} EP** (top 2.0% of all rolls)`,
        `🥉 <@dan> — 🎲 **444** 🔵 **${ep(4000)} EP** (bottom 41% of all rolls)`
    ]);
    check('rekorderne står som egen sektion', sections[1],
        '<@bo> 👑 set a **NEW ALL-TIME HIGH** — nobody here has ever rolled better!');
    check('uden rekorder er der kun podiet', formatRngdleDayResult(todays, () => null, []).length, 1);
    check('uden percentil står linjen uden parentes',
        formatRngdleDayResult([todays[2]], () => null, [])[0].split('\n')[1], '🥇 <@carl> — 🎲 **333** 🗑️ **100 EP**');

    // Rekordlisten er ikke bundet af podiets tre, så den skal have et loft — ellers
    // kan en dag med mange personlige rekorder vælte hele beskeden over 2000 tegn.
    // Globale rekorder skal med før de personlige, og resten tælles i halelinjen.
    const many = [
        ...['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id, i) =>
            ({ roll: dayRoll(id, i, 1000 + i, 'rare', i), record: { scope: 'personal', kind: 'high' } })),
        { roll: dayRoll('g1', 7, 30000, 'anomaly', 7), record: { scope: 'global', kind: 'high' } }
    ];
    const capped = formatRngdleDayResult(todays, () => null, many)[1].split('\n');
    check('rekordsektionen skæres af med global rekord først og en halelinje', capped, [
        '<@g1> 👑 set a **NEW ALL-TIME HIGH** — nobody here has ever rolled better!',
        '<@p1> 🎉 set a **new personal record** — their best roll ever!',
        '<@p2> 🎉 set a **new personal record** — their best roll ever!',
        '<@p3> 🎉 set a **new personal record** — their best roll ever!',
        '<@p4> 🎉 set a **new personal record** — their best roll ever!',
        '…and 2 more records'
    ]);
    check('præcis ved loftet er der ingen halelinje',
        formatRngdleDayResult(todays, () => null, many.slice(0, 5))[1].split('\n').length, 5);
}

if (failures.length) {
    console.error('❌ Svarvejen opfører sig ikke som forventet:');
    for (const f of failures) console.error('   ' + f);
    process.exit(1);
}

console.log('✅ Svar leveres korrekt, pointene skrives med $inc, holdnavne er sikre at vise, og historikkens percentiler passer, og dagsresultatet kårer podiet og rekorderne');

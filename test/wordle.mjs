// Test af Wordle-ranglisten.
//
// Beskederne herunder er kopieret ord for ord fra tre rigtige dagsresultater i
// kanalen (hentet med test/wordle-probe.mjs). Det er hele pointen: appen skriver
// nogle deltagere som rigtige mentions og andre som ren tekst — samme spiller
// kan skifte form fra dag til dag — og et visningsnavn kan indeholde mellemrum.
// Rammer fortolkningen forbi, får en spiller ingen point for dagen, og det ville
// ingen kunne se i stillingen bagefter.
//
//   node test/wordle.mjs

import {
    parseWordleMessage, wordleEloUpdates, wordleStatsIncrement,
    wordleScoreLabel, WORDLE_FAILED_GUESSES, WORDLE_START_RATING
} from '../src/wordle.js';
import {
    buildWordleNameIndex, wordlePuzzleDateKey,
    formatWordleDay, formatWordleLeaderboard, fitWordleAnnouncement, wordleAverage,
    wordleSeasonSpan, formatWordleSeasonList, formatWordleSeasonEnd
} from '../src/index.js';

const failures = [];

function check(label, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) failures.push(`${label}\n     forventet ${e}\n     fik       ${a}`);
}

function ok(label, condition) {
    if (!condition) failures.push(label);
}

// Serveren som botten ser den. Nok medlemmer til at dække begge navneformer i
// beskederne, inklusive et visningsnavn med mellemrum.
const MEMBERS = [
    { nick: null, user: { id: '1411995926301638731', username: 'tobias044711', global_name: 'Tobis' } },
    { nick: null, user: { id: '1272516589010554893', username: 'tbandersen', global_name: 'Troels' } },
    { nick: 'mikkel', user: { id: '999000000000000001', username: 'mikkelsen', global_name: 'Mikkel S' } },
    { nick: null, user: { id: '1367407852553109554', username: 'chlund', global_name: 'Christian Lund' } },
    { nick: null, user: { id: '1247132117763096587', username: 'mkt_bc', global_name: 'Morten' } },
    { nick: null, user: { id: '1499707909582491750', username: 'bcpeter', global_name: 'Peter - pfrank' } },
    { nick: null, user: { id: '316655653416599553', username: 'sune_der_koder', global_name: 'SuNe_dEr_kOdEr' } },
    { nick: null, user: { id: '238650592589774848', username: 'grejbar', global_name: 'Grejbar' } },
    { nick: null, user: { id: '185100042577641473', username: 'h3xproof', global_name: null } }
];

const names = buildWordleNameIndex(MEMBERS);

const DAY_18 = "**Your group is on an 18 day streak!** 🔥 Here are yesterday's results:\n" +
    "👑 2/6: <@1411995926301638731> @Troels\n" +
    "3/6: @mikkel <@1367407852553109554> <@1247132117763096587> <@1499707909582491750>\n" +
    "4/6: <@316655653416599553>\n" +
    "X/6: <@238650592589774848>";

const DAY_17 = "**Your group is on a 17 day streak!** 🔥 Here are yesterday's results:\n" +
    "👑 3/6: <@185100042577641473>\n" +
    "4/6: @Tobis\n" +
    "5/6: <@316655653416599553>";

// --- Fortolkning ---

const day18 = parseWordleMessage(DAY_18, names.byName);

check('18: streaken læses', day18.streak, 18);
check('18: ingen ukendte navne', day18.unresolved, []);
check('18: alle otte deltagere med', day18.results.length, 8);
check('18: kronen giver ikke et forkert tal',
    day18.results.filter(r => r.guesses === 2).map(r => r.playerId).sort(),
    ['1272516589010554893', '1411995926301638731']);
check('18: tekst-mention med mellemrum bliver ikke splittet',
    day18.results.find(r => r.playerId === '1499707909582491750')?.guesses, 3);
check('18: nick bliver slået op', day18.results.find(r => r.playerId === '999000000000000001')?.guesses, 3);
check('18: X/6 tæller som ikke løst',
    day18.results.find(r => r.playerId === '238650592589774848')?.guesses, WORDLE_FAILED_GUESSES);

const day17 = parseWordleMessage(DAY_17, names.byName);
check('17: samme spiller genkendes også som ren tekst',
    day17.results.find(r => r.playerId === '1411995926301638731')?.guesses, 4);
check('17: global_name er null, men id-mention virker',
    day17.results.find(r => r.playerId === '185100042577641473')?.guesses, 3);

// Uden navneopslag er der ingen at koble teksten til — den skal registreres som
// manglende og ikke bare forsvinde.
const blind = parseWordleMessage(DAY_17, new Map());
check('uden navneindeks bliver tekst-mentions noteret som ukendte', blind.unresolved, ['Tobis']);
check('uden navneindeks får id-mentions stadig point', blind.results.length, 2);

// Alt andet end et dagsresultat skal ignoreres, ellers ville en tilfældig
// besked i kanalen kunne lave en dag i databasen.
check('en almindelig besked er ikke et dagsresultat', parseWordleMessage('7/6 er umuligt', names.byName), null);
check('tom besked', parseWordleMessage('', names.byName), null);

// Beskeden poster gårsdagens gåde, så dagen er dagen før beskeden — også når
// beskeden kommer tidligt, og også hen over et månedsskifte.
check('dagen er dagen før beskeden', wordlePuzzleDateKey('2026-09-15T05:58:48.700000+00:00'), '2026-09-14');
check('månedsskifte', wordlePuzzleDateKey('2026-10-01T06:32:19.000000+00:00'), '2026-09-30');

// --- Point ---

const flat = () => WORDLE_START_RATING;
const updates = wordleEloUpdates(day18.results, flat);

// Alle starter ens, så dagens point er et nulsumsspil. Er summen ikke nul, siver
// der point ind i eller ud af stillingen hver dag.
const sum = updates.reduce((t, u) => t + u.delta, 0);
ok(`dagens point balancerer (sum ${sum})`, Math.abs(sum) <= updates.length);

ok('den bedste vinder point', updates.find(u => u.playerId === '1411995926301638731').delta > 0);
ok('den der ikke løste ordet mister point', updates.find(u => u.playerId === '238650592589774848').delta < 0);
check('kun de bedste får kronen', updates.filter(u => u.won).map(u => u.rank), [1, 1]);
check('samme antal forsøg giver samme placering',
    updates.filter(u => u.guesses === 3).map(u => u.rank), [3, 3, 3, 3]);

// To spillere med samme resultat og samme startpoint skal flytte sig ens,
// uanset hvilken rækkefølge de stod i beskeden.
const tied = updates.filter(u => u.guesses === 3).map(u => u.delta);
check('lige resultat giver lige point', new Set(tied).size, 1);

// En dags udsving skal ikke kunne løbe løbsk, uanset hvor mange der var med.
const swing = Math.max(...updates.map(u => Math.abs(u.delta)));
ok(`en dag flytter højst ~48 point (flyttede ${swing})`, swing <= 48);

// Er man den eneste der spillede, er der ingen at vinde over. Dagen tælles, men
// point står stille — ellers kunne man samle rating ved at spille alene.
const alone = wordleEloUpdates([{ playerId: 'a', name: 'A', guesses: 4 }], flat);
check('alene: ingen point', alone.map(u => u.delta), [0]);
check('alene: dagen tælles stadig', wordleStatsIncrement(alone[0]).days, 1);

// Stærk spiller mod svag: at slå den svage giver mindre end at slå den stærke.
const rated = new Map([['strong', 1400], ['weak', 800]]);
const upset = wordleEloUpdates(
    [{ playerId: 'weak', name: 'W', guesses: 2 }, { playerId: 'strong', name: 'S', guesses: 5 }],
    playerId => rated.get(playerId)
);
ok('en overraskelse flytter mange point', upset.find(u => u.playerId === 'weak').delta > 24);

// --- Statistik ---

check('et løst ord tæller i snittet', wordleStatsIncrement({ guesses: 3, won: false }),
    { days: 1, wins: 0, solved: 1, failed: 0, solvedGuesses: 3 });
check('et X tæller ikke i snittet', wordleStatsIncrement({ guesses: WORDLE_FAILED_GUESSES, won: false }),
    { days: 1, wins: 0, solved: 0, failed: 1, solvedGuesses: 0 });
check('snit uden løste ord', wordleAverage({ solved: 0, solvedGuesses: 0 }), null);
check('snit', wordleAverage({ solved: 2, solvedGuesses: 7 }), 3.5);
check('X/6 vises som X/6', wordleScoreLabel(WORDLE_FAILED_GUESSES), 'X/6');
check('3/6 vises som 3/6', wordleScoreLabel(3), '3/6');

// --- Beskeden ---

const standings = updates
    .map((u, i) => ({
        playerId: u.playerId, name: names.byId.get(u.playerId), rating: u.rating,
        days: 18, wins: 4, solved: 17, failed: 1, solvedGuesses: 60 + i
    }))
    .sort((a, b) => b.rating - a.rating);

const dayText = formatWordleDay({ dateKey: '2026-09-14', streak: 18 }, updates, names.byId);
ok('dagsresultatet nævner dagen', dayText[0].includes('2026-09-14'));
ok('dagsresultatet viser streaken', dayText[0].includes('18 day group streak'));
ok('dagsresultatet viser navne, ikke id\'er', dayText[0].includes('Peter - pfrank'));
ok('dagsresultatet kan ikke pinge nogen', !dayText[0].includes('<@'));

check('en tom stilling giver ingen tabel', formatWordleLeaderboard([]), null);

const announcement = fitWordleAnnouncement(dayText, standings);
ok('annonceringen holder sig under Discords grænse', [...announcement].length <= 2000);
ok('annonceringen indeholder stillingen', announcement.includes('Wordle leaderboard'));

// Er der for lidt plads, er dagens resultat det der skal stå tilbage — ikke
// stillingen. Grænsen her er sat lige under dagsresultatet alene.
const squeezed = fitWordleAnnouncement(dayText, standings, [...dayText[0]].length + 10);
check('under pres står dagen tilbage', squeezed, dayText[0]);
ok('en umulig grænse giver stadig en besked', fitWordleAnnouncement(dayText, standings, 1) === dayText[0]);

// --- Sæsoner ---

check('sæsonens spænd er første og sidste dag', wordleSeasonSpan(['2026-09-14', '2026-09-12', '2026-09-13']),
    { from: '2026-09-12', to: '2026-09-14', days: 3 });
check('en sæson uden dage har intet spænd', wordleSeasonSpan([]), { from: null, to: null, days: 0 });

const seasonOne = { seasonId: 1, from: '2026-06-01', to: '2026-09-14', days: 106, standings };
const seasonTwo = { seasonId: 2, from: '2026-09-15', to: '2026-09-17', days: 3 };
const seasonList = formatWordleSeasonList([seasonOne], seasonTwo, names.byId);
ok('sæsonlisten viser den arkiverede sæsons dage', seasonList.includes('**Season 1** — 2026-06-01 → 2026-09-14 (106 days)'));
ok('sæsonlisten kroner vinderen', seasonList.includes(`👑 ${standings[0].name}`));
ok('sæsonlisten viser den igangværende sæson', seasonList.includes('**Season 2** (current) — since 2026-09-15 (3 days)'));
ok('en helt ny sæson uden dage',
    formatWordleSeasonList([], { seasonId: 1, from: null, to: null, days: 0 }, null).includes('(current) — no days yet'));

const seasonEnd = formatWordleSeasonEnd(seasonOne, names.byId);
ok('sæsonafslutningen viser den endelige stilling', seasonEnd.includes('season 1 is over') && seasonEnd.includes(standings[0].name));
ok('sæsonafslutningen annoncerer den næste', seasonEnd.includes('Season 2 starts now'));
ok('sæsonafslutningen holder sig under Discords grænse', [...seasonEnd].length <= 2000);
check('en gammel sæsons stilling får sin egen overskrift', formatWordleLeaderboard(standings, 1, 'T').split('\n')[0], 'T');

if (failures.length) {
    console.error(`❌ ${failures.length} fejl:\n  - ${failures.join('\n  - ')}`);
    process.exit(1);
}
console.log('✅ Wordle: fortolkning, point og besked er som forventet');

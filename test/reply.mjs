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

import { sendReply, buildRatingUpdate, EPHEMERAL_COMMANDS } from '../src/index.js';

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

if (failures.length) {
    console.error('❌ Svarvejen opfører sig ikke som forventet:');
    for (const f of failures) console.error('   ' + f);
    process.exit(1);
}

console.log('✅ Svar leveres korrekt, og pointene skrives med $inc');

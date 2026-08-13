// Regressionstest for RNGdle-motoren.
//
// Scoringen blev verificeret tal-for-tal mod en uafhængig implementering af
// rngdle.com's regler: alle 1.000.001 tal gav samme total EP og samme sæt af
// optjente badges. Den reference kan vi ikke checke ind, så i stedet låser vi
// resultatet fast med et fingeraftryk over hele intervallet.
//
// Ændrer du en badge-test, en EP-værdi eller en familie, så FEJLER den her — og
// det er meningen. Er ændringen bevidst, kør `node test/parity.mjs --update` og
// commit det nye fingeraftryk sammen med ændringen.
//
//   node test/parity.mjs

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { computeRoll, MAX_ROLL, cardTier, BADGES } from '../src/rngdle.js';

const SNAPSHOT = new URL('./parity-snapshot.json', import.meta.url);

function sweep() {
    const hash = createHash('sha256');
    const tiers = {};
    let min = Infinity, max = -Infinity, sum = 0;

    for (let n = 0; n <= MAX_ROLL; n++) {
        const { totalEP } = computeRoll(n);
        hash.update(`${n}:${totalEP};`);
        if (totalEP < min) min = totalEP;
        if (totalEP > max) max = totalEP;
        sum += totalEP;
        const t = cardTier(totalEP);
        tiers[t] = (tiers[t] || 0) + 1;
    }

    return {
        badges: BADGES.length,
        fingerprint: hash.digest('hex'),
        minEP: min,
        maxEP: max,
        meanEP: Math.round(sum / (MAX_ROLL + 1)),
        tiers,
    };
}

const actual = sweep();

if (process.argv.includes('--update')) {
    writeFileSync(SNAPSHOT, JSON.stringify(actual, null, 2) + '\n');
    console.log('Snapshot opdateret:', actual.fingerprint);
    process.exit(0);
}

const expected = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const failures = [];
for (const key of ['badges', 'fingerprint', 'minEP', 'maxEP', 'meanEP']) {
    if (actual[key] !== expected[key]) failures.push(`${key}: forventet ${expected[key]}, fik ${actual[key]}`);
}
for (const [tier, count] of Object.entries(expected.tiers)) {
    if (actual.tiers[tier] !== count) failures.push(`tier ${tier}: forventet ${count}, fik ${actual.tiers[tier] ?? 0}`);
}

if (failures.length) {
    console.error('❌ Scoringen har ændret sig:');
    for (const f of failures) console.error('   ' + f);
    process.exit(1);
}

console.log(`✅ ${MAX_ROLL + 1} tal scoret uændret (${actual.badges} badges, ${actual.fingerprint.slice(0, 16)}…)`);

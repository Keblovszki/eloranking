// RNGdle-motoren.
//
// Scorer et tal 0..1.000.000 og giver EP tilbage. EP er en REN funktion af tallet:
// samme tal giver altid samme point, ingen tilfældighed oveni. Det er hele pointen —
// botten ruller selv tallet, og scoren kan genberegnes og kontrolleres bagefter.
//
// Reglerne (hvilke mønstre der giver hvor meget) er spillereglerne fra rngdle.com.
// De er verificeret mod en åben genimplementering for hvert eneste tal i intervallet;
// se test/parity.mjs. Ændrer du en badge-test eller en EP-værdi, så kør den igen.

// --- Talteoretiske hjælpere ---------------------------------------------------

function ipow(b, e) { let r = 1; for (let i = 0; i < e; i++) r *= b; return r; }

// Perfekt b^exp. Både 0 og 1 tæller som perfekt potens af enhver eksponent
// (0 = 0^exp, 1 = 1^exp), så de to tal høster alle 13 potens-badges — hvoraf
// familien kun lader den dyreste tælle.
function isPerfectPower(n, exp) {
    if (n <= 1) return true;
    for (let b = 2; ; b++) {
        const v = ipow(b, exp);
        if (v > n) return false;
        if (v === n) return true;
    }
}

// k^m hvor m >= 0, dvs. 1 tæller med som k^0.
function isPowerOf(n, k) {
    if (n <= 0) return false;
    let v = 1;
    while (v < n) v *= k;
    return v === n;
}

const FACTORIALS = new Set([1, 2, 6, 24, 120, 720, 5040, 40320, 362880]); // 0!..9! i intervallet

const FIBS = (() => {
    const s = new Set([0, 1]);
    let a = 0, b = 1;
    while (b <= 1000000) { s.add(b); [a, b] = [b, a + b]; }
    return s;
})();

const PRONICS = (() => {
    const s = new Set();
    for (let k = 0; k * (k + 1) <= 1000000; k++) s.add(k * (k + 1));
    return s;
})();

function isPrime(n) {
    if (n < 2) return false;
    if (n % 2 === 0) return n === 2;
    for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
    return true;
}

// --- Cifferformer -------------------------------------------------------------

const strictInc = d => { for (let i = 1; i < d.length; i++) if (d[i] <= d[i - 1]) return false; return d.length >= 2; };
const strictDec = d => { for (let i = 1; i < d.length; i++) if (d[i] >= d[i - 1]) return false; return d.length >= 2; };
const consecInc = d => { for (let i = 1; i < d.length; i++) if (d[i] - d[i - 1] !== 1) return false; return d.length >= 2; };
const consecDec = d => { for (let i = 1; i < d.length; i++) if (d[i] - d[i - 1] !== -1) return false; return d.length >= 2; };
const arithmetic = d => { if (d.length < 3) return false; const diff = d[1] - d[0]; for (let i = 2; i < d.length; i++) if (d[i] - d[i - 1] !== diff) return false; return true; };
const absArith = d => { if (d.length < 3) return false; const a = Math.abs(d[1] - d[0]); for (let i = 2; i < d.length; i++) if (Math.abs(d[i] - d[i - 1]) !== a) return false; return true; };
const turtle = d => { if (d.length < 2) return false; for (let i = 1; i < d.length; i++) if (Math.abs(d[i] - d[i - 1]) > 1) return false; return true; };
const alternator = d => { if (d.length < 2) return false; for (let i = 1; i < d.length; i++) if (d[i] % 2 === d[i - 1] % 2) return false; return true; };
const allSameParity = d => { if (d.length < 1) return false; const p = d[0] % 2; return d.every(x => x % 2 === p); };

// Op og så ned igen (Mountain) / ned og så op igen (Valley), uden fladt stykke.
function mountain(d) {
    const n = d.length; if (n < 3) return false;
    let i = 0;
    while (i + 1 < n && d[i] < d[i + 1]) i++;
    if (i === 0 || i === n - 1) return false;
    while (i + 1 < n && d[i] > d[i + 1]) i++;
    return i === n - 1;
}
function valley(d) {
    const n = d.length; if (n < 3) return false;
    let i = 0;
    while (i + 1 < n && d[i] > d[i + 1]) i++;
    if (i === 0 || i === n - 1) return false;
    while (i + 1 < n && d[i] < d[i + 1]) i++;
    return i === n - 1;
}
// Zigzag: hvert skridt skifter retning, og ingen to nabocifre er ens.
function hills(d) {
    if (d.length < 3) return false;
    let prev = 0;
    for (let i = 1; i < d.length; i++) {
        const diff = d[i] - d[i - 1];
        if (diff === 0) return false;
        const sign = diff > 0 ? 1 : -1;
        if (prev !== 0 && sign === prev) return false;
        prev = sign;
    }
    return true;
}

// Sammenhængende løb af L cifre der stiger ELLER falder med 1 ad gangen.
function straightRun(d, L) {
    for (let i = 0; i + L <= d.length; i++) {
        let asc = true, desc = true;
        for (let k = 1; k < L; k++) {
            if (d[i + k] - d[i + k - 1] !== 1) asc = false;
            if (d[i + k] - d[i + k - 1] !== -1) desc = false;
        }
        if (asc || desc) return true;
    }
    return false;
}

// Sammenhængende løb af `len` cifre. strictAsc=false tillader begge retninger.
function hasSequence(s, len, strictAsc = true) {
    if (s.length < len || len <= 0) return false;
    for (let i = 0; i <= s.length - len; i++) {
        const a = s.charCodeAt(i);
        if (strictAsc) {
            let ok = true;
            for (let k = 1; k < len; k++) if (s.charCodeAt(i + k) !== a + k) { ok = false; break; }
            if (ok) return true;
        } else {
            const dir = s.charCodeAt(i + 1) - a;
            if (dir === 1 || dir === -1) {
                let ok = true;
                for (let k = 1; k < len; k++) if (s.charCodeAt(i + k) !== a + k * dir) { ok = false; break; }
                if (ok) return true;
            }
        }
    }
    return false;
}

function strobogrammatic(s) {
    const map = { '0': '0', '1': '1', '6': '9', '8': '8', '9': '6' };
    let out = '';
    for (let i = s.length - 1; i >= 0; i--) { const m = map[s[i]]; if (m === undefined) return false; out += m; }
    return out === s;
}

const isPalindromeStr = s => { for (let i = 0, j = s.length - 1; i < j; i++, j--) if (s[i] !== s[j]) return false; return true; };

// Cifrene i `s` danner, sorteret, et ubrudt løb af på hinanden følgende værdier.
function isScrambledSeq(s, minLen) {
    if (s.length < minLen) return false;
    const arr = [...s].map(Number).sort((a, b) => a - b);
    for (let i = 1; i < arr.length; i++) if (arr[i] !== arr[i - 1] + 1) return false;
    return true;
}

// --- "Tal i tallet": opdeling af cifferstrengen i flere hele tal ---------------
//
// Den her familie af regler leder efter fortløbende TAL gemt i cifrene ("1213" =
// 12 og 13), ikke bare fortløbende cifre. Reglerne har nogle skarpe kanter, som
// alle er bevidste: ingen indledende nul i en del, mindst én del skal være
// flercifret (ellers ville "12" trivielt tælle), og et træf der fylder HELE
// strengen hører til "exact"-badget frem for "contains"-varianten.

const hasLeadingZero = s => s.length > 1 && s[0] === '0';
const someMultiDigit = parts => parts.some(p => p.length >= 2);
const isConsecSet = nums => { const t = [...nums].sort((a, b) => a - b); for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] !== 1) return false; return true; };
const isOrdered = nums => {
    if (nums.length < 2) return true;
    let inc = true, dec = true;
    for (let i = 1; i < nums.length; i++) { if (nums[i] <= nums[i - 1]) inc = false; if (nums[i] >= nums[i - 1]) dec = false; }
    return inc || dec;
};

function digitCounts(s) { const m = new Map(); for (const ch of s) m.set(ch, (m.get(ch) ?? 0) + 1); return m; }

// To dele der er nabotal, med hele strengen brugt.
function pairExact(s) {
    for (let t = 1; t < s.length; t++) {
        const a = s.slice(0, t), b = s.slice(t);
        if (hasLeadingZero(a) || hasLeadingZero(b) || !someMultiDigit([a, b])) continue;
        if (Math.abs(parseInt(a, 10) - parseInt(b, 10)) === 1) return true;
    }
    return false;
}

// Tre/fire dele der udgør et sæt af fortløbende tal. Resultatet caches på ét slot,
// fordi hvert scan bruges af to badges (i rækkefølge + forbyttet) lige efter hinanden.
function tripleExactScan(s) {
    for (let t = 1; t < s.length - 1; t++) for (let i = t + 1; i < s.length; i++) {
        const parts = [s.slice(0, t), s.slice(t, i), s.slice(i)];
        if (parts.some(hasLeadingZero) || !someMultiDigit(parts)) continue;
        const nums = parts.map(p => parseInt(p, 10));
        if (isConsecSet(nums)) return nums;
    }
    return null;
}
function quadExactScan(s) {
    for (let t = 1; t < s.length - 2; t++) for (let i = t + 1; i < s.length - 1; i++) for (let r = i + 1; r < s.length; r++) {
        const parts = [s.slice(0, t), s.slice(t, i), s.slice(i, r), s.slice(r)];
        if (parts.some(hasLeadingZero) || !someMultiDigit(parts)) continue;
        const nums = parts.map(p => parseInt(p, 10));
        if (isConsecSet(nums)) return nums;
    }
    return null;
}
let tripleKey = null, tripleVal = null;
function tripleExact(s) {
    if (tripleKey !== s) { tripleKey = s; tripleVal = tripleExactScan(s); }
    return tripleVal;
}
let quadKey = null, quadVal = null;
function quadExact(s) {
    if (quadKey !== s) { quadKey = s; quadVal = quadExactScan(s); }
    return quadVal;
}

// Nabotal der står klods op ad hinanden et sted inde i strengen. Et træf der dækker
// hele strengen springes over — det er `pairExact`'s domæne.
function pairAdjacent(s) {
    for (let t = 0; t < s.length; t++) for (let i = 1; i <= s.length - t - 1; i++) {
        const left = s.slice(t, t + i);
        if (hasLeadingZero(left)) continue;
        const a = parseInt(left, 10);
        for (const v of [a + 1, a - 1]) {
            if (v < 0) continue;
            const vs = v.toString(), end = t + i + vs.length;
            if (end > s.length) continue;
            const seg = s.slice(t + i, end);
            if (seg === vs && someMultiDigit([left, seg])) {
                if (t === 0 && end === s.length) continue;
                return true;
            }
        }
    }
    return false;
}

// Nabotal med et hul imellem sig.
function pairNearby(s) {
    const subs = [];
    for (let i = 0; i < s.length; i++) for (let r = 1; r <= s.length - i; r++) {
        const a = s.slice(i, i + r);
        if (!hasLeadingZero(a)) subs.push({ value: parseInt(a, 10), start: i, end: i + r, str: a });
    }
    for (let e = 0; e < subs.length; e++) for (let i = e + 1; i < subs.length; i++) {
        const x = subs[e], y = subs[i];
        if (Math.abs(x.value - y.value) !== 1) continue;
        if (!someMultiDigit([x.str, y.str])) continue;
        // Må ikke overlappe og må ikke støde direkte op til hinanden.
        if ((x.end <= y.start || y.end <= x.start) && x.end !== y.start && y.end !== x.start) return true;
    }
    return false;
}

// `count` fortløbende tal skrevet i forlængelse af hinanden, op eller ned, et sted
// inde i strengen (igen: ikke hvis træffet fylder det hele).
function nAdjacentBuild(s, start, firstLen, firstVal, dir, count) {
    const parts = [s.slice(start, start + firstLen)];
    let cursor = start + firstLen;
    for (let k = 1; k < count; k++) {
        const v = firstVal + k * dir;
        if (v < 0) return null;
        const vs = v.toString();
        if (cursor + vs.length > s.length) return null;
        if (s.slice(cursor, cursor + vs.length) !== vs) return null;
        parts.push(vs);
        cursor += vs.length;
    }
    return someMultiDigit(parts) ? { start, end: cursor } : null;
}
function nAdjacent(s, count) {
    if (count < 2) return false;
    for (let i = 0; i < s.length; i++) {
        for (let len = 1; len <= s.length - i - (count - 1); len++) {
            const part = s.slice(i, i + len);
            if (hasLeadingZero(part)) continue;
            const val = parseInt(part, 10);
            const hit = nAdjacentBuild(s, i, len, val, 1, count) || nAdjacentBuild(s, i, len, val, -1, count);
            if (hit) {
                if (hit.start === 0 && hit.end === s.length) break;
                return true;
            }
        }
    }
    return false;
}

// Startpositioner for "sammenhængende par": et ciffer der optræder præcis to gange
// i hele tallet, og hvor de to står ved siden af hinanden. Contiguous Two/Three Pair
// leder derefter efter 2 eller 3 af dem med præcis 2 cifres mellemrum (ddee / ddeeff).
function contigPairStarts(s) {
    const counts = digitCounts(s);
    const starts = [];
    for (const [digit, n] of counts.entries()) {
        if (n !== 2 || !s.includes(digit + digit)) continue;
        for (let t = 0; t < s.length - 1; t++) if (s[t] === digit && s[t + 1] === digit) { starts.push(t); break; }
    }
    starts.sort((a, b) => a - b);
    return starts;
}

// Del strengen i præcis `count` dele (uden indledende nuller) og test tallene.
function splitParts(s, count, pred) {
    const nums = Array(count);
    const rec = (idx, start) => {
        if (idx === count - 1) {
            const part = s.slice(start);
            if (hasLeadingZero(part)) return false;
            nums[idx] = Number(part);
            return pred(nums);
        }
        const remaining = count - idx - 1;
        for (let end = start + 1; end <= s.length - remaining; end++) {
            const part = s.slice(start, end);
            if (hasLeadingZero(part)) continue;
            nums[idx] = Number(part);
            if (rec(idx + 1, end)) return true;
        }
        return false;
    };
    return rec(0, 0);
}

// 3+ dele i aritmetisk følge med differens |d| >= 2. Differens 0/±1 er allerede
// dækket af Homogeneous / Cascade / Waterfall, så de tæller ikke som Metronome.
function hasArithmeticSplit(s) {
    for (let count = 3; count <= s.length; count++) {
        const hit = splitParts(s, count, nums => {
            const diff = nums[1] - nums[0];
            if (diff === -1 || diff === 0 || diff === 1) return false;
            for (let i = 2; i < nums.length; i++) if (nums[i] - nums[i - 1] !== diff) return false;
            return true;
        });
        if (hit) return true;
    }
    return false;
}

// 3+ positive dele i geometrisk følge (konstant forhold, testet som b² = a·c).
function hasGeometricSplit(s) {
    for (let count = 3; count <= s.length; count++) {
        const hit = splitParts(s, count, nums => {
            if (nums.some(v => v <= 0) || nums[0] === nums[1]) return false;
            for (let t = 0; t + 2 < nums.length; t++) if (nums[t + 1] * nums[t + 1] !== nums[t] * nums[t + 2]) return false;
            return true;
        });
        if (hit) return true;
    }
    return false;
}

// Tre dele a, b, c hvor ét af + − × ÷ gør "a op b = c" sandt.
function hasEquation(s) {
    return splitParts(s, 3, ([a, b, c]) => {
        if (a === 0 || b === 0 || c === 0) return false;
        return a + b === c || a - b === c || a * b === c || (a % b === 0 && a / b === c);
    });
}

// --- Badges -------------------------------------------------------------------
//
// [id, label, emoji, ep, test(c)] hvor c er den forudberegnede cifferkontekst.
// Rarity gemmes ikke pr. badge — den udledes af EP-værdien, så der ikke er to
// tal at holde synkroniseret.

const BADGE_RARITY_THRESHOLDS = { common: 1e3, uncommon: 1e4, rare: 1e5, epic: 1e6, anomaly: 1e7 };

export function badgeRarity(ep) {
    const t = BADGE_RARITY_THRESHOLDS;
    return ep < t.common ? 'common'
        : ep < t.uncommon ? 'uncommon'
            : ep < t.rare ? 'rare'
                : ep < t.epic ? 'epic'
                    : ep < t.anomaly ? 'anomaly'
                        : 'mythic';
}

export const BADGES = [
    // --- Eksakte meme-tal ---
    ['NICE_EXACT', 'Exact Nice', '😏', 100000100, c => c.n === 69],
    ['JACKPOT_EXACT', 'Exact Jackpot', '💰', 100000100, c => c.n === 777],
    ['JACKPOT_SIX', 'Jackpot Six', '🏦', 100000100, c => c.has('777777')],
    ['BOTANIST_EXACT', 'Exact Botanist', '🌿', 100000100, c => c.n === 420],
    ['DEVIL_EXACT', 'Exact Devil', '😈', 100000100, c => c.n === 666],
    ['LEET_EXACT', 'Exact Leet', '💻', 100000100, c => c.n === 1337],
    ['EXACT_HELL', 'Exact Hell', '👹', 100000100, c => c.n === 7734],
    ['EXACT_BOOB_80085', 'Exact 80085', '💎', 100000100, c => c.n === 80085],
    ['MEANING_EXACT', 'Exact Meaning', '🌌', 100000100, c => c.n === 42],
    ['EMERGENCY_EXACT', 'Exact Emergency', '🚑', 100000100, c => c.n === 911],
    ['VERY_VERY_NICE', 'Very Very Nice', '😏', 100000100, c => c.n === 696969],
    ['HOTBOX', 'Hotbox', '🌿', 100000100, c => c.n === 420420],
    ['MAYDAY', 'Mayday', '🚑', 100000100, c => c.n === 911911],
    ['UNIVERSAL_ANSWER', 'Universal Answer', '🌌', 100000100, c => c.n === 424242],
    ['BIG_BROTHER_EXACT', 'Orwellian', '👁️', 100000100, c => c.n === 1984],
    ['DIGIT_ZERO', 'Zero', '0️⃣', 100000100, c => c.n === 0],
    ['DIGIT_ONE', 'One', '1️⃣', 100000100, c => c.n === 1],
    ['DIGIT_TWO', 'Two', '2️⃣', 100000100, c => c.n === 2],
    ['DIGIT_THREE', 'Three', '3️⃣', 100000100, c => c.n === 3],
    ['DIGIT_FOUR', 'Four', '4️⃣', 100000100, c => c.n === 4],
    ['DIGIT_FIVE', 'Five', '5️⃣', 100000100, c => c.n === 5],
    ['DIGIT_SIX', 'Six', '6️⃣', 100000100, c => c.n === 6],
    ['DIGIT_SEVEN', 'Seven', '7️⃣', 100000100, c => c.n === 7],
    ['DIGIT_EIGHT', 'Eight', '8️⃣', 100000100, c => c.n === 8],
    ['DIGIT_NINE', 'Nine', '9️⃣', 100000100, c => c.n === 9],
    ['SIXTY_SEVEN_EXACT', 'Exact Six-Seven', '🫠', 100000100, c => c.n === 67],
    ['EIGHTY_SIX_EXACT', 'Exact Eighty-Six', '🍽️', 100000100, c => c.n === 86],
    ['ORIENTATION_EXACT', 'Exact Orientation', '🧭', 100000100, c => c.n === 101],
    ['CALENDAR_EXACT', 'Exact Calendar', '📅', 100000100, c => c.n === 365],
    ['BRAINROT', 'Brainrot', '🫠', 100000100, c => c.n === 676767],
    ['GROUNDHOG_DAY', 'Groundhog Day', '📅', 100000100, c => c.n === 365365],
    ['ONE_MILLION', 'One Million', '🐐', 100000100, c => c.n === 1000000],
    ['ERROR_EXACT', 'Not Found', '🚫', 100000100, c => c.n === 404],
    ['FULL_DAY', 'Full Day', '⏳', 100000100, c => c.n === 86400],
    ['FOOTBALL_17776', '17776', '🏈', 100000100, c => c.n === 17776],
    ['INFERNAL', 'Infernal', '🔱', 100000100, c => c.n === 666666],
    ['ALWAYS', 'Always', '♾️', 50000050, c => c.s === '247365' || c.s === '365247'],
    ['ULTIMEME_EXACT', 'Funny Number', '😂', 50000050, c => c.s === '69420' || c.s === '42069'],
    ['EXACT_BOOB', 'Exact Boob', '🍈', 50000050, c => c.n === 8008 || c.n === 58008],

    // --- Potenser og konstanter ---
    ['THIRTEENTH_POWER', '13th Power', '💀', 33333367, c => isPerfectPower(c.n, 13)],
    ['SEVENTEENTH_POWER', '17th Power', '🧙', 33333367, c => isPerfectPower(c.n, 17)],
    ['NINETEENTH_POWER', '19th Power', '🌑', 33333367, c => isPerfectPower(c.n, 19)],
    ['TAU', 'Tau', '🌀', 33333367, c => c.s === '6283' || c.s === '62831' || c.s === '628318'],
    ['GOLDEN_RATIO', 'Golden Ratio', '🐚', 33333367, c => c.s === '1618' || c.s === '16180' || c.s === '161803'],
    ['TENTH_POWER', '10th Power', '🔟', 25000025, c => isPerfectPower(c.n, 10)],
    ['ELEVENTH_POWER', '11th Power', '🕚', 25000025, c => isPerfectPower(c.n, 11)],
    ['PI', 'Pi', '🥧', 25000025, c => [314, 3141, 31415, 314159].includes(c.n)],
    ['E', "Euler's Number", '📈', 25000025, c => [271, 2718, 27182, 271828].includes(c.n)],
    ['CONSEC_QUAD_EXACT', '4 Consecutive Numbers', '⛓️', 25000025, c => { const r = quadExact(c.s); return !!r && isOrdered(r); }],
    ['NINTH_POWER', '9th Power', '☁️', 20000020, c => isPerfectPower(c.n, 9)],
    ['EIGHTH_POWER', '8th Power', '🎱', 16666683, c => isPerfectPower(c.n, 8)],
    ['OUROBOROS', 'Ouroboros', '🐍', 14285729, c => [1, 4, 27, 256, 3125, 46656, 823543].includes(c.n)],
    ['SEVENTH_POWER', '7th Power', '🌈', 12500013, c => isPerfectPower(c.n, 7)],
    ['POWER_OF_SEVEN', 'Power of Seven', '7️⃣', 12500013, c => isPowerOf(c.n, 7)],
    ['FACTORIAL', 'Factorial', '❗', 11111122, c => FACTORIALS.has(c.n)],
    ['POWER_OF_FIVE', 'Power of Five', '5️⃣', 11111122, c => isPowerOf(c.n, 5)],
    ['HELLO', 'Hello', '👋', 11111122, c => c.has('07734')],
    ['SEQUENCE_6', 'Sequence (6)', '🔢', 11111122, c => hasSequence(c.s, 6, false)],
    ['CONTIGUOUS_SIXES', 'Contiguous Sixes', '➖➖➖➖', 10000010, c => /(\d)\1{5}/.test(c.s)],
    ['DEEP_VOID_FIVE', 'Deep Void (5)', '⚫', 10000010, c => c.has('00000')],
    ['ONE_DIGIT', 'Single Digit', '☝️', 10000010, c => c.len === 1],
    ['QUINT_NINE', 'Quint Nine', '🥳', 10000010, c => c.s.endsWith('99999')],
    ['EON', 'Eon', '🗿', 10000010, c => c.s.endsWith('00000')],
    ['SEMI_EON', 'Semi-Eon', '🦴', 10000010, c => c.s.endsWith('50000')],
    ['SIXTH_POWER', '6th Power', '🎲', 9090918, c => isPerfectPower(c.n, 6)],
    ['POWER_OF_THREE', 'Power of Three', '🔺', 7692315, c => isPowerOf(c.n, 3)],
    ['FIFTH_POWER', '5th Power', '🖐️', 6250006, c => isPerfectPower(c.n, 5)],
    ['JACKPOT_FIVE', 'Jackpot Five', '💰💰💰', 5263163, c => c.has('77777')],
    ['POWER_OF_TWO', 'Power of Two', '💾', 5000005, c => c.n > 0 && (c.n & (c.n - 1)) === 0],
    ['ROYAL_FLUSH', 'Royal Flush', '👑', 5000005, c => c.has('56789')],
    ['BOOB_58008', '58008', '🔠', 5000005, c => c.has('58008')],
    ['BOOB_80085', '80085', '🅱️', 5000005, c => c.has('80085')],
    ['PI_CONTAINS_5', 'Pi Slice (5)', '🥧', 5000005, c => c.has('31415')],
    ['E_CONTAINS_5', 'E Slice (5)', '📈', 5000005, c => c.has('27182')],
    ['TAU_SLICE_5', 'Tau Slice (5)', '🌀', 5000005, c => c.has('62831')],
    ['CASCADE', 'Cascade', '🌊', 3333337, c => consecInc(c.d)],
    ['FIBONACCI', 'Fibonacci Number', '🐚', 3333337, c => FIBS.has(c.n)],
    ['FOURTH_POWER', '4th Power', '📦', 3125003, c => isPerfectPower(c.n, 4)],
    ['WATERFALL', 'Waterfall', '🚿', 2857146, c => consecDec(c.d)],
    ['CONSEC_QUAD_CONTAINS', '4 Consecutive Numbers (Contains)', '🔗', 2631582, c => nAdjacent(c.s, 4)],
    ['CONSEC_QUAD_SCRAMBLED', '4 Consecutive Numbers (Scrambled)', '🔀', 2272730, c => { const r = quadExact(c.s); return !!r && !isOrdered(r); }],
    ['HOMOGENEOUS', 'Homogeneous', '🥛', 2222224, c => c.len >= 2 && c.distinct === 1],
    ['ULTIMEME', 'Funny Numbers', '😂', 1666668, c => c.has('69') && c.has('420')],
    ['BINARY_SOUL', 'Binary Soul', '🤖', 1538463, c => /^[01]+$/.test(c.s)],
    ['STRAIGHT_FLUSH', 'Straight Flush', '🃏', 1449277, c => c.has('02468') || c.has('13579') || c.has('86420') || c.has('97531')],
    ['TWO_DIGITS', 'Two Digits', '✌️', 1111112, c => c.len === 2],
    // Cifersum = cifferprodukt. 1 og 2 er trivielt sande og udelukkes — men 0 tæller
    // med (sum 0 = produkt 0), hvilket er bevidst.
    ['SPY', 'Spy Number', '🕵️', 1030929, c => c.n !== 1 && c.n !== 2 && c.sum === c.prod],
    ['QUAD_NINE', 'Quad Nine', '🎊', 1000001, c => c.s.endsWith('9999')],
    ['SEMI_EPOCH', 'Semi-Epoch', '⌛', 1000001, c => c.s.endsWith('5000')],
    ['EPOCH', 'Epoch', '🏛️', 1000001, c => c.s.endsWith('0000')],
    ['CUBE', '3rd Power', '🧊', 990100, c => isPerfectPower(c.n, 3)],
    ['EVEN_SPACING', 'Even Spacing', '📏', 862070, c => arithmetic(c.d)],

    // --- Epic ---
    ['CONSEC_TRIPLE_EXACT', '3 Consecutive Numbers', '⛓️', 555556, c => { const r = tripleExact(c.s); return !!r && isOrdered(r); }],
    ['CONTIGUOUS_FIVES', 'Contiguous Fives', '➖➖➖', 552487, c => /(\d)\1{4}/.test(c.s)],
    ['DEEP_VOID_FOUR', 'Deep Void (4)', '🌌', 552487, c => c.has('0000')],
    ['STROBOGRAMMATIC', 'Strobogrammatic', '🙃', 502513, c => strobogrammatic(c.s)],
    ['STRAIGHT', 'Straight', '📏', 454546, c => straightRun(c.d, 5)],
    ['JACKPOT_FOUR', 'Jackpot Four', '💰💰', 357143, c => c.has('7777')],
    ['VERY_NICE', 'Very Nice', '🥵', 334448, c => c.has('6969')],
    ['DEEPER_MEANING', 'Deeper Meaning', '🌌', 334448, c => c.has('4242')],
    ['SIXTY_SEVEN_DOUBLE', '6767', '🫠', 334448, c => c.has('6767')],
    ['LEET', 'Leet', '💻', 333334, c => c.has('1337')],
    ['HELL', 'Hell', '🔥', 333334, c => c.has('7734')],
    ['BOOB_8008', '8008', '🔢', 333334, c => c.has('8008')],
    ['BIG_BROTHER', 'Big Brother', '👁️', 333334, c => c.has('1984')],
    ['PI_CONTAINS_4', 'Pi Slice (4)', '🥧', 333334, c => c.has('3141')],
    ['E_CONTAINS_4', 'E Slice (4)', '📈', 333334, c => c.has('2718')],
    ['TAU_SLICE_4', 'Tau Slice (4)', '🌀', 333334, c => c.has('6283')],
    ['CONSEC_TRIPLE_SCRAMBLED', '3 Consecutive Numbers (Scrambled)', '🔀', 277778, c => { const r = tripleExact(c.s); return !!r && !isOrdered(r); }],
    ['ZIPPER', 'Zipper', '🤐', 246914, c => c.len >= 2 && c.distinct === 2 && c.d.every((x, i) => i === 0 || x !== c.d[i - 1])],
    ['ASCENSION', 'Ascension', '📈', 219298, c => strictInc(c.d)],
    ['GEOMETRIC', 'Crescendo', '🔊', 208334, c => hasGeometricSplit(c.s)],
    ['FIVE_OF_A_KIND', 'Five of a Kind', '🃏', 198020, c => c.maxCount >= 5],
    ['CONSEC_TRIPLE_CONTAINS', '3 Consecutive Numbers (Contains)', '🔗', 157978, c => nAdjacent(c.s, 3)],
    ['CONTIGUOUS_THREE_PAIR', 'Contiguous Three Pair', '👨‍👩‍👧‍👦👯', 154321, c => { const a = contigPairStarts(c.s); for (let i = 0; i < a.length - 2; i++) if (a[i] + 2 === a[i + 1] && a[i + 1] + 2 === a[i + 2]) return true; return false; }],
    ['FRAMED_PAIR', 'Framed Pair', '🖼️', 137174, c => c.len === 4 && c.d[1] === c.d[2] && c.d[0] !== c.d[1] && c.d[3] !== c.d[1]],
    ['FRAMED_TRIPLE', 'Framed Triple', '🖼️🖼️', 137174, c => c.len === 5 && c.d[1] === c.d[2] && c.d[2] === c.d[3] && c.d[0] !== c.d[1] && c.d[4] !== c.d[1]],
    ['FRAMED_QUAD', 'Framed Quad', '🪟', 137174, c => c.len === 6 && c.d[1] === c.d[2] && c.d[2] === c.d[3] && c.d[3] === c.d[4] && c.d[0] !== c.d[1] && c.d[5] !== c.d[4]],
    ['DECAY', 'Decay', '📉', 119474, c => strictDec(c.d)],
    ['THREE_DIGITS', 'Three Digits', '🤟', 111111, c => c.len === 3],
    ['ECHO', 'Echo', '📣', 100100, c => c.len >= 2 && c.len % 2 === 0 && c.s.slice(0, c.len / 2) === c.s.slice(c.len / 2)],
    ['MILLENNIUM', 'Millennium', '🗓️', 100000, c => c.s.endsWith('000')],
    ['PRONIC', 'Pronic Number', '🧮', 100000, c => PRONICS.has(c.n)],
    ['TRIPLE_NINE', 'Triple Nine', '🎉', 100000, c => c.s.endsWith('999')],
    ['SEMI_MILLENNIUM', 'Semi-Millennium', '📜', 100000, c => c.s.endsWith('500')],
    ['COLOSSAL', 'Colossal', '🪨', 100000, c => c.n > 999000],
    ['SQUARE', '2nd Power', '🟦', 99900, c => isPerfectPower(c.n, 2)],
    ['EVEN_SPACING_ABS', 'Even Spacing (Absolute)', '📐', 90992, c => absArith(c.d)],
    // Præcis to forskellige cifre, hvoraf det ene kun optræder én gang.
    ['FIREFLY', 'Firefly', '🪲', 82237, c => c.len >= 4 && c.distinct === 2 && Object.values(c.counts).some(v => v === 1)],
    ['CONSEC_PAIR_EXACT', '2 Consecutive Numbers', '🔗', 50505, c => pairExact(c.s)],
    ['PALINDROME', 'Palindrome', '🪞', 50025, c => isPalindromeStr(c.s)],

    // --- Rare ---
    ['CONTIGUOUS_QUADS', 'Contiguous Quads', '➖➖', 37023, c => /(\d)\1{3}/.test(c.s)],
    ['DEEP_VOID_THREE', 'Deep Void (3)', '🌑', 37023, c => c.has('000')],
    ['TURTLE', 'Turtle', '🐢', 36049, c => turtle(c.d)],
    ['SECRET_AGENT', 'Secret Agent', '🕶️', 34614, c => c.has('007')],
    ['HEAVY', 'Heavy', '🧱', 33300, c => c.sum > 45],
    ['CONTIGUOUS_BOAT', 'Contiguous Full House', '🏰', 30111, c => {
        const m = c.s.match(/(\d)\1\1(\d)\2/); if (m && m[1] !== m[2]) return true;
        const m2 = c.s.match(/(\d)\1(\d)\2\2/); return !!(m2 && m2[1] !== m2[2]);
    }],
    ['JACKPOT', 'Jackpot', '💰', 27027, c => c.has('777')],
    ['DEVIL', 'Devil', '😈', 27027, c => c.has('666')],
    ['SEQUENCE_4', 'Sequence (4)', '🔢', 25907, c => hasSequence(c.s, 4, false)],
    ['ERROR', 'Error 404', '🚫', 25132, c => c.has('404')],
    ['ORIENTATION', 'Orientation', '🧭', 25132, c => c.has('101')],
    ['BOTANIST', 'Botanist', '🌿', 25006, c => c.has('420')],
    ['EMERGENCY', 'Emergency', '🚑', 25006, c => c.has('911')],
    ['PI_CONTAINS_3', 'Pi Slice (3)', '🥧', 25006, c => c.has('314')],
    ['E_CONTAINS_3', 'E Slice (3)', '📈', 25006, c => c.has('271')],
    ['CALENDAR', 'Calendar', '📅', 25006, c => c.has('365')],
    ['DIVISIBLE_BY_THREE', 'Divisible by Three', '🔺', 24414, c => c.d.every(x => x % 3 === 0)],
    ['SCRAMBLE', 'Scramble', '🔀', 22722, c => c.len >= 2 && c.distinct === c.len && (Math.max(...c.d) - Math.min(...c.d)) === c.len - 1],
    ['DUALITY', 'Duality', '☯️', 21654, c => c.distinct === 2],
    ['STEPS', 'Steps', '🪜', 20202, c => { if (c.len < 2) return false; let rose = false; for (let i = 1; i < c.len; i++) { if (c.d[i] < c.d[i - 1]) return false; if (c.d[i] > c.d[i - 1]) rose = true; } return rose; }],
    ['ARITHMETIC', 'Metronome', '🎼', 17784, c => hasArithmeticSplit(c.s)],
    ['FRAMED_DOUBLE', 'Framed Double', '🖼️🖼️🖼️', 15242, c => c.len === 6 && c.d[1] === c.d[2] && c.d[3] === c.d[4] && c.d[1] !== c.d[3] && c.d[0] !== c.d[1] && c.d[5] !== c.d[4]],
    ['SLOPES', 'Slopes', '🛝', 12582, c => { if (c.len < 2) return false; let fell = false; for (let i = 1; i < c.len; i++) { if (c.d[i] > c.d[i - 1]) return false; if (c.d[i] < c.d[i - 1]) fell = true; } return fell; }],
    ['PAIRED_BOOKENDS', 'Paired Bookends', '👐', 11122, c => c.len >= 4 && c.d[0] === c.d[1] && c.d[c.len - 1] === c.d[c.len - 2] && c.d[0] !== c.d[c.len - 1]],
    ['FOUR_DIGITS', 'Four Digits', '🍀', 11111, c => c.len === 4],
    ['THREE_PAIR', 'Three Pair', '👯‍♀️👯', 10288, c => c.countExact(2) >= 3],
    ['BOOKENDS', 'Bookends', '📚', 10010, c => c.len >= 4 && c.s.slice(0, 2) === c.s.slice(-2)],
    ['MIRROR_BOOKENDS', 'Mirror Bookends', '📖', 10010, c => c.len >= 4 && c.d[0] === c.d[c.len - 1] && c.d[1] === c.d[c.len - 2]],
    ['CENTURY', 'Century', '💯', 10000, c => c.s.endsWith('00')],
    ['DOUBLE_NINE', 'Double Nine', '🎈', 10000, c => c.s.endsWith('99')],
    ['SEMI_CENTURY', 'Semi-Century', '🗓️', 10000, c => c.s.endsWith('50')],
    ['QUARTER_CENTURY', 'Quarter-Century', '🪙', 10000, c => c.s.endsWith('25')],
    ['THREE_QUARTER_CENTURY', 'Three-Quarter Century', '🕰️', 10000, c => c.s.endsWith('75')],

    // --- Uncommon ---
    ['QUADS', 'Four of a Kind', '🍀', 8436, c => c.maxCount >= 4],
    ['EQUATION', 'Equation', '🟰', 7720, c => hasEquation(c.s)],
    ['LOW_BALL', 'Low Ball', '📉', 6400, c => /^[0-4]+$/.test(c.s)],
    ['MOUNTAIN', 'Mountain', '🏔️', 5885, c => mountain(c.d)],
    ['DOUBLE_HOP', 'Double Hop', '🦘🦘', 5321, c => { if (c.len < 5 || c.distinct < 2) return false; for (let e = 0; e <= c.len - 5; e++) if (c.s[e + 2] === c.s[e] && c.s[e + 4] === c.s[e]) return true; return false; }],
    ['HIGH_ROLLER', 'High Roller', '🤑', 5120, c => /^[5-9]+$/.test(c.s)],
    ['VALLEY', 'Valley', '🏜️', 4199, c => valley(c.d)],
    // To sammenhængende par lige ved siden af hinanden (ddee), hvor de to cifre er
    // forskellige — ellers er det fire ens i træk (Contiguous Quads).
    ['CONTIGUOUS_TWO_PAIR', 'Contiguous Two Pair', '👨‍👩‍👧‍👦', 3957, c => { for (let i = 0; i + 3 < c.len; i++) if (c.s[i] === c.s[i + 1] && c.s[i + 2] === c.s[i + 3] && c.s[i] !== c.s[i + 2]) return true; return false; }],
    ['MINI_ECHO', 'Mini Echo', '🔂', 3704, c => /(\d\d)\1/.test(c.s)],
    ['ALTERNATOR', 'Alternator', '⚡', 2845, c => alternator(c.d)],
    ['FLUSH', 'Flush', '🎨', 2845, c => allSameParity(c.d)],
    ['CONTIGUOUS_TRIPS', 'Contiguous Trips', '➖', 2784, c => /(\d)\1\1/.test(c.s)],
    ['DEEP_VOID', 'Deep Void', '🕳️', 2784, c => c.has('00')],
    ['FEATHER', 'Feather', '🪶', 2667, c => c.sum < 15],
    ['BLACKJACK', 'Blackjack', '♠️', 2521, c => c.sum === 21],
    ['BOAT', 'Full House', '🏠', 2397, c => { const v = Object.values(c.counts).sort((a, b) => b - a); return v[0] >= 3 && (v[1] || 0) >= 2; }],
    ['POCKET_MIRROR', 'Pocket Mirror', '🪞', 2124, c => { for (let L = 4; L <= c.len; L++) for (let i = 0; i + L <= c.len; i++) if (isPalindromeStr(c.s.slice(i, i + L))) return true; return false; }],
    ['SNAKE_EYES', 'Snake Eyes', '🎲', 2121, c => { if ((c.counts[1] || 0) !== 2) return false; for (const k in c.counts) if (k !== '1' && c.counts[k] >= 2) return false; return true; }],
    ['NICE', 'Nice', '😏', 2024, c => c.has('69')],
    ['MEANING', 'Meaning of Life', '🌌', 2024, c => c.has('42')],
    ['SIXTY_SEVEN', 'Six-Seven', '🫠', 2024, c => c.has('67')],
    ['EIGHTY_SIX', 'Eighty-Six', '🍽️', 2024, c => c.has('86')],
    // Kun lige cifferlængder: de to halvdele skal have samme cifersum.
    ['BALANCED', 'Balanced', '⚖️', 1959, c => {
        if (c.len < 2 || c.len % 2 !== 0) return false;
        const h = c.len / 2;
        let a = 0, b = 0;
        for (let i = 0; i < h; i++) { a += c.d[i]; b += c.d[h + i]; }
        return a === b;
    }],
    // Samme delstreng på 2+ cifre optræder to gange UDEN overlap — derfor giver
    // "000" ikke Rhyme, selvom "00" findes to steder i den.
    ['RHYME', 'Rhyme', '🎶', 1872, c => {
        for (let L = 2; L <= c.len - 1; L++)
            for (let i = 0; i + L <= c.len; i++)
                if (c.s.indexOf(c.s.slice(i, i + L), i + L) !== -1) return true;
        return false;
    }],
    ['SEQUENCE_3', 'Sequence (3)', '🔢', 1716, c => hasSequence(c.s, 3, false)],
    ['CONSEC_PAIR_ADJACENT', '2 Consecutive Numbers (Contains)', '🔗', 1659, c => pairAdjacent(c.s)],
    ['CONSEC_PAIR_NEARBY', '2 Consecutive Numbers (Nearby)', '🔗', 1575, c => pairNearby(c.s)],
    ['MESA', 'Mesa', '🗻', 1568, c => { let rose = false, fell = false; for (let i = 1; i < c.len; i++) { const a = c.d[i], b = c.d[i - 1]; if (a > b) { if (fell) return false; rose = true; } else if (a < b) fell = true; } return rose && fell; }],
    ['PRIME', 'Prime Number', '💎', 1274, c => isPrime(c.n)],
    ['TRINITY', 'Trinity', '⚜️', 1265, c => c.distinct === 3],
    ['DOZEN', 'Dozen', '🍩', 1200, c => c.n > 0 && c.n % 12 === 0],
    ['CANYON', 'Canyon', '🌄', 1184, c => { let rose = false, fell = false; for (let i = 1; i < c.len; i++) { const a = c.d[i], b = c.d[i - 1]; if (a < b) { if (rose) return false; fell = true; } else if (a > b) rose = true; } return rose && fell; }],
    ['FIVE_DIGITS', 'Five Digits', '🖐️', 1111, c => c.len === 5],
    ['ELEVEN', 'Eleven', '🕚', 1100, c => c.n > 0 && c.n % 11 === 0],
    ['HARSHAD', 'Harshad Number', '🤝', 1048, c => c.sum > 0 && c.n % c.sum === 0],
    ['CLEAN', 'Clean', '🧼', 1000, c => c.s.endsWith('0')],
    ['SEMI_CLEAN', 'Semi-Clean', '🧹', 1000, c => c.s.endsWith('5')],
    ['EQUILIBRIUM', 'Equilibrium', '🧘', 1000, c => c.len >= 2 && c.d[0] === c.d[c.len - 1]],
    ['SANDWICH', 'Sandwich', '🥪', 1000, c => c.len >= 3 && c.d[0] === c.d[c.len - 1] && c.d.slice(1, -1).some(x => x !== c.d[0])],

    // --- Common ---
    ['HILLS', 'Hills', '🏞️', 733, c => c.len >= 4 && hills(c.d)],
    ['TRIPS', 'Three of a Kind', '🎰', 724, c => c.countExact(3) > 0],
    ['LUCKY_SEVEN_DIV', 'Lucky Seven (Divisible)', '🎰', 700, c => c.n > 0 && c.n % 7 === 0],
    ['HETEROGENEOUS', 'Heterogeneous', '🥗', 593, c => c.distinct === c.len],
    ['MINI_SCRAMBLE', 'Mini Scramble', '🧩', 579, c => { for (let L = 3; L <= c.len; L++) for (let i = 0; i + L <= c.len; i++) if (isScrambledSeq(c.s.slice(i, i + L), 3)) return true; return false; }],
    ['GAP_ONE', 'Gap One', '↕️', 529, c => c.len >= 2 && Math.abs(c.d[0] - c.d[c.len - 1]) === 1],
    ['TWO_PAIR', 'Two Pair', '👯‍♀️', 377, c => Object.values(c.counts).filter(v => v >= 2).length >= 2],
    ['DUNES', 'Dunes', '🐫', 364, c => { let coll = c.s[0] ?? ''; for (let i = 1; i < c.len; i++) if (c.s[i] !== c.s[i - 1]) coll += c.s[i]; if (coll.length < 4) return false; for (let i = 2; i < coll.length; i++) { const p = +coll[i - 2], q = +coll[i - 1], r = +coll[i], a = q - p, b = r - q; if (a > 0 && b > 0 || a < 0 && b < 0) return false; } return true; }],
    // Et "hop" er samme ciffer med præcis ét andet imellem. Der skal findes ét af
    // længde 2 — er der tre eller flere i træk, er det Double Hop i stedet.
    ['HOPSCOTCH', 'Hopscotch', '🦘', 312, c => {
        if (c.len < 3 || c.distinct < 2) return false;
        for (let e = 0; e <= c.len - 3; e++) {
            if (c.s[e + 2] !== c.s[e]) continue;
            const ahead = c.len > e + 4 && c.s[e + 4] === c.s[e];
            const behind = e >= 2 && c.s[e - 2] === c.s[e];
            if (!ahead && !behind) return true;
        }
        return false;
    }],
    ['GHOST', 'Ghost', '👻', 309, c => (c.counts[0] || 0) === 1],
    ['QUARTET', 'Quartet', '🎻', 290, c => c.distinct === 4],
    ['HYDROGEN', 'Hydrogen (1)', '💧', 282, c => (c.counts[1] || 0) === 1],
    ['HELIUM', 'Helium (2)', '🎈', 282, c => (c.counts[2] || 0) === 1],
    ['CARBON', 'Carbon (6)', '✏️', 282, c => (c.counts[6] || 0) === 1],
    ['OXYGEN', 'Oxygen (8)', '💨', 282, c => (c.counts[8] || 0) === 1],
    ['LITHIUM', 'Lithium (3)', '🔋', 282, c => (c.counts[3] || 0) === 1],
    ['BERYLLIUM', 'Beryllium (4)', '💎', 282, c => (c.counts[4] || 0) === 1],
    ['BORON', 'Boron (5)', '🧼', 282, c => (c.counts[5] || 0) === 1],
    ['NITROGEN', 'Nitrogen (7)', '❄️', 282, c => (c.counts[7] || 0) === 1],
    ['FLUORINE', 'Fluorine (9)', '🦷', 282, c => (c.counts[9] || 0) === 1],
    ['GROUNDED', 'Grounded', '⚓', 250, c => c.len >= 2 && c.d[0] < c.d[c.len - 1]],
    ['CONTIGUOUS_PAIR', 'Contiguous Pair', '🫂', 249, c => /(\d)\1/.test(c.s)],
    ['LUCKY_7', 'Lucky Seven', '7️⃣', 213, c => c.has('7')],
    ['EVEN', 'Even', '⚖️', 200, c => c.n % 2 === 0],
    ['ODD', 'Odd', '🦄', 200, c => c.n % 2 === 1],
    ['LIFTOFF', 'Liftoff', '🚀', 200, c => c.len >= 2 && c.d[0] > c.d[c.len - 1]],
    ['VOID', 'Void', '🕳️', 167, c => !c.has('0')],
    ['NEIGHBORS', 'Neighbors', '🏘️', 161, c => { for (let i = 0; i + 1 < c.len; i++) if (Math.abs(c.d[i] - c.d[i + 1]) === 1) return true; return false; }],
    ['PAIR', 'Pair', '👯', 120, c => c.maxCount >= 2],
    ['SIX_DIGITS', 'Six Digits', '🐝', 111, c => c.len === 6],
];

// Fortrængningsfamilier: inden for en familie tæller KUN det dyreste optjente badge.
// Resten vises stadig, men giver 0 — det højere badge indebærer allerede de lavere,
// så uden det her ville fx 777777 score Jackpot + Jackpot Four + Five + Six + Exact
// oveni hinanden. Rækkefølgen i hver liste er uden betydning; scoreren tager maks.
const FAMILIES = [
    ['THIRTEENTH_POWER', 'SEVENTEENTH_POWER', 'NINETEENTH_POWER', 'TENTH_POWER', 'ELEVENTH_POWER', 'NINTH_POWER', 'EIGHTH_POWER', 'SEVENTH_POWER', 'SIXTH_POWER', 'FIFTH_POWER', 'FOURTH_POWER', 'CUBE', 'SQUARE', 'OUROBOROS'],
    ['DIGIT_ZERO', 'DIGIT_ONE', 'DIGIT_TWO', 'DIGIT_THREE', 'DIGIT_FOUR', 'DIGIT_FIVE', 'DIGIT_SIX', 'DIGIT_SEVEN', 'DIGIT_EIGHT', 'DIGIT_NINE', 'ONE_DIGIT'],
    ['CONSEC_QUAD_EXACT', 'CONSEC_QUAD_CONTAINS', 'CONSEC_QUAD_SCRAMBLED', 'CONSEC_TRIPLE_EXACT', 'CONSEC_TRIPLE_SCRAMBLED', 'CONSEC_TRIPLE_CONTAINS', 'CONSEC_PAIR_EXACT', 'CONSEC_PAIR_ADJACENT', 'CONSEC_PAIR_NEARBY'],
    ['SEQUENCE_6', 'CASCADE', 'WATERFALL', 'EVEN_SPACING', 'EVEN_SPACING_ABS', 'TURTLE', 'SEQUENCE_4', 'SCRAMBLE', 'SEQUENCE_3', 'GEOMETRIC', 'ARITHMETIC', 'MINI_SCRAMBLE'],
    ['CONTIGUOUS_THREE_PAIR', 'FRAMED_PAIR', 'FRAMED_DOUBLE', 'THREE_PAIR', 'CONTIGUOUS_TWO_PAIR', 'TWO_PAIR', 'CONTIGUOUS_PAIR', 'PAIR'],
    ['EXACT_BOOB_80085', 'EXACT_BOOB', 'BOOB_58008', 'BOOB_80085', 'BOOB_8008'],
    ['BOTANIST_EXACT', 'MEANING_EXACT', 'HOTBOX', 'BOTANIST', 'MEANING'],
    ['JACKPOT_EXACT', 'JACKPOT_SIX', 'JACKPOT_FIVE', 'JACKPOT_FOUR', 'JACKPOT'],
    ['CONTIGUOUS_SIXES', 'CONTIGUOUS_FIVES', 'CONTIGUOUS_QUADS', 'CONTIGUOUS_TRIPS'],
    ['E', 'E_CONTAINS_5', 'E_CONTAINS_4', 'E_CONTAINS_3'],
    ['NICE_EXACT', 'VERY_VERY_NICE', 'VERY_NICE', 'NICE'],
    ['QUINT_NINE', 'QUAD_NINE', 'TRIPLE_NINE', 'DOUBLE_NINE'],
    ['PI', 'PI_CONTAINS_5', 'PI_CONTAINS_4', 'PI_CONTAINS_3'],
    ['SIXTY_SEVEN_EXACT', 'BRAINROT', 'SIXTY_SEVEN_DOUBLE', 'SIXTY_SEVEN'],
    ['DEEP_VOID_FIVE', 'DEEP_VOID_FOUR', 'DEEP_VOID_THREE', 'DEEP_VOID'],
    ['PAIRED_BOOKENDS', 'BOOKENDS', 'MIRROR_BOOKENDS'],
    ['CALENDAR_EXACT', 'GROUNDHOG_DAY', 'CALENDAR', 'ALWAYS'],
    ['EMERGENCY_EXACT', 'MAYDAY', 'EMERGENCY'],
    ['FRAMED_TRIPLE', 'FRAMED_QUAD', 'QUADS', 'FIVE_OF_A_KIND', 'TRIPS'],
    ['ROYAL_FLUSH', 'STRAIGHT_FLUSH', 'STRAIGHT'],
    ['BIG_BROTHER_EXACT', 'BIG_BROTHER'],
    ['CONTIGUOUS_BOAT', 'BOAT'],
    ['DEVIL_EXACT', 'INFERNAL', 'DEVIL'],
    ['FIREFLY', 'DUALITY'],
    ['EIGHTY_SIX_EXACT', 'EIGHTY_SIX'],
    ['EQUILIBRIUM', 'SANDWICH'],
    ['EXACT_HELL', 'HELL'],
    ['DOUBLE_HOP', 'HOPSCOTCH'],
    ['LEET_EXACT', 'LEET'],
    ['UNIVERSAL_ANSWER', 'DEEPER_MEANING'],
    ['ASCENSION', 'DECAY', 'STEPS', 'SLOPES'],
    ['ORIENTATION_EXACT', 'ORIENTATION'],
    ['MOUNTAIN', 'VALLEY', 'MESA', 'CANYON'],
    ['MINI_ECHO', 'RHYME'],
    ['ERROR_EXACT', 'ERROR'],
    ['HILLS', 'DUNES'],
    ['PALINDROME', 'POCKET_MIRROR'],
    ['TAU', 'TAU_SLICE_5', 'TAU_SLICE_4'],
    ['ULTIMEME_EXACT', 'ULTIMEME'],
];

// Familieopslag bygges én gang: badge-id -> familienummer.
const FAMILY_OF = new Map();
FAMILIES.forEach((fam, i) => { for (const id of fam) FAMILY_OF.set(id, i); });

// --- Scoring ------------------------------------------------------------------

export const MAX_ROLL = 1000000;

// Korttier for den samlede EP på ét rul. Grænserne er percentiler over alle
// 1.000.001 mulige tal, så fordelingen af tiers er den samme som i spillet.
export const CARD_TIERS = [
    [2098, 'trash'], [5761, 'common'], [9644, 'uncommon'],
    [23077, 'rare'], [35744, 'epic'], [164953, 'anomaly'],
];

export function cardTier(ep) {
    for (const [cut, name] of CARD_TIERS) if (ep < cut) return name;
    return 'mythic';
}

const TIER_EMOJI = {
    trash: '🗑️', common: '⚪', uncommon: '🟢', rare: '🔵',
    epic: '🟣', anomaly: '🟠', mythic: '🌟',
};

export function tierEmoji(tier) { return TIER_EMOJI[tier] ?? '⚪'; }

// Scorer ét tal. Returnerer totalen plus de optjente badges sorteret efter værdi,
// hvor fortrængte badges står med ep = 0.
export function computeRoll(n) {
    const s = String(n);
    const d = [...s].map(ch => ch.charCodeAt(0) - 48);
    const counts = {};
    for (const x of d) counts[x] = (counts[x] || 0) + 1;

    const c = {
        n, s, len: s.length, d, counts,
        distinct: Object.keys(counts).length,
        sum: d.reduce((a, b) => a + b, 0),
        prod: d.reduce((a, b) => a * b, 1),
        maxCount: Math.max(...Object.values(counts)),
        has: sub => s.includes(sub),
        countExact: k => Object.values(counts).filter(v => v === k).length,
    };

    const earned = [];
    for (const [id, label, emoji, ep, test] of BADGES) {
        if (test(c)) earned.push({ id, label, emoji, ep });
    }

    // Fortrængning: find det dyreste optjente badge pr. familie og nulstil resten.
    const bestInFamily = new Map();
    for (const b of earned) {
        const fam = FAMILY_OF.get(b.id);
        if (fam === undefined) continue;
        const cur = bestInFamily.get(fam);
        if (!cur || b.ep > cur.ep) bestInFamily.set(fam, b);
    }
    for (const b of earned) {
        const fam = FAMILY_OF.get(b.id);
        if (fam !== undefined && bestInFamily.get(fam) !== b) b.ep = 0;
    }

    const totalEP = earned.reduce((sum, b) => sum + b.ep, 0);
    earned.sort((a, b) => b.ep - a.ep);
    return { number: n, totalEP, tier: cardTier(totalEP), badges: earned };
}

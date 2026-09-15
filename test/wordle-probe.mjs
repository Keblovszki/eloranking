// Dumper Wordle-appens seneste dagsresultater rå til test/wordle-dump.json, så
// parseren kan bygges mod det rigtige format i stedet for mod et gæt.
//
//   node test/wordle-probe.mjs
//
// Scriptet spørger om bot-tokenet og skjuler det mens det tastes: så står det
// hverken i shell-historikken, i en fil eller i dumpen. Kør det selv i en
// terminal — svar med tokenet, tryk Enter.
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const CHANNEL_ID = process.env.CHANNEL_ID ?? "1542777817467457588";
const OUT = new URL("./wordle-dump.json", import.meta.url);

// Skjult prompt: readline skriver normalt hvert tastetryk tilbage til skærmen,
// så uden muted-flaget ville tokenet stå synligt i terminalen.
function askHidden(question) {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    return new Promise(resolve => {
        let muted = false;
        const write = rl._writeToOutput.bind(rl);
        rl._writeToOutput = s => { if (!muted) write(s); };
        rl.question(question, answer => {
            rl.close();
            process.stdout.write("\n");
            resolve(answer.trim());
        });
        muted = true;
    });
}

const BOT_TOKEN = process.env.BOT_TOKEN ?? await askHidden("Bot-token (vises ikke): ");
if (!BOT_TOKEN) {
    console.error("Intet token — stopper.");
    process.exit(1);
}

const api = async path => {
    const res = await fetch(`https://discord.com/api/v10${path}`, {
        headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });
    if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
    return res.json();
};

const hasScore = text => /\d\/6|X\/6/i.test(text);

const messages = await api(`/channels/${CHANNEL_ID}/messages?limit=50`);
const results = messages.filter(m =>
    hasScore(m.content ?? "") ||
    (m.embeds ?? []).some(e => hasScore(`${e.title ?? ""}${e.description ?? ""}`))
);

// Kun felterne parseren kan komme til at bruge. Tokenet er ikke en del af noget
// svar fra Discord, så dumpen kan deles frit.
const dump = results.slice(0, 3).map(m => ({
    id: m.id,
    timestamp: m.timestamp,
    type: m.type,
    webhook_id: m.webhook_id,
    application_id: m.application_id,
    author: m.author,
    content: m.content,
    embeds: m.embeds,
    components: m.components,
    mentions: (m.mentions ?? []).map(u => ({ id: u.id, username: u.username, global_name: u.global_name })),
    interaction_metadata: m.interaction_metadata
}));

writeFileSync(OUT, JSON.stringify({ channelId: CHANNEL_ID, fetched: messages.length, matched: results.length, messages: dump }, null, 2));
console.log(`${messages.length} beskeder hentet, ${results.length} ser ud som dagsresultater.`);
console.log(`Skrevet til ${OUT.pathname}`);

// Læser hemmeligheder fra miljøvariabler — commit ALDRIG din bot-token!
// Sæt dem før du kører scriptet, fx:
//   APP_ID=... BOT_TOKEN=... node command-setup.js   (Git Bash / Linux / macOS)
//   $env:APP_ID="..."; $env:BOT_TOKEN="..."; node command-setup.js   (PowerShell)
const APP_ID = process.env.APP_ID;
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!APP_ID || !BOT_TOKEN) {
    console.error("❌ Mangler APP_ID og/eller BOT_TOKEN som miljøvariabler. Se README.md.");
    process.exit(1);
}

const ALL_COMMANDS = [
    { name: "join-ranking", description: "Join the ranking system", type: 1 },
    { name: "play", description: "Join a random double game", type: 1 },
    { name: "blind-season-toggle", description: "Admin: Toggle blind season", type: 1 },
    { name: "force-cancel", description: "Admin: Reset all games", type: 1 },
    { name: "reset-season", description: "Admin: Start a new season", type: 1 },
    { name: "cancel", description: "Cancel your current game", type: 1 },
    { name: "rematch", description: "Propose playing the last match again with the same teams", type: 1 },
    { name: "accept-rematch", description: "Accept the proposed rematch", type: 1 },
    { name: "reject-rematch", description: "Decline the proposed rematch", type: 1 },
    { name: "accept", description: "Accept the reported result", type: 1 },
    { name: "reject", description: "Reject the reported result", type: 1 },
    { name: "help", description: "Learn how the bot works", type: 1 },
    { name: "single-ranking", description: "See the single ranking", type: 1 },
    { name: "double-ranking", description: "See the double ranking", type: 1 },
    { name: "play-single", description: "Challenge someone to a single match", type: 1 },
    { name: "matches-overview", description: "See the status of current matches", type: 1 },
    { name: "stats", description: "See statistics for the current season", type: 1 },
    {
        name: "edit-username",
        description: "Edit your displayed username",
        type: 1,
        options: [{ name: "username", description: "Your new username", type: 3, required: true }]
    },
    {
        name: "single-accepted",
        description: "Accept a single challenge",
        type: 1,
        options: [{ name: "creator", description: "The creator of the challenge", type: 6, required: true }]
    },
    {
        name: "play-double",
        description: "Create a double match with your partner",
        type: 1,
        options: [{ name: "partner", description: "Your partner", type: 6, required: true }]
    },
    {
        name: "double-accepted",
        description: "Accept a double challenge",
        type: 1,
        options: [
            { name: "partner", description: "Your partner", type: 6, required: true },
            { name: "creator", description: "The creator of the challenge", type: 6, required: true }
        ]
    },
    {
        name: "season-ranking",
        description: "See a previous season ranking",
        type: 1,
        options: [{ name: "season", description: "Which season to see (e.g. 1)", type: 4, required: true }]
    },
    {
        name: "result",
        description: "Report the match result",
        type: 1,
        options: [
            { name: "team_1_score", description: "Team 1 points", type: 4, required: true },
            { name: "team_2_score", description: "Team 2 points", type: 4, required: true }
        ]
    }
];

async function installCommands() {
    console.log("Sender kommandoer til Discord...");

    const url = `https://discord.com/api/v10/applications/${APP_ID}/commands`;

    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bot ${BOT_TOKEN}`
        },
        body: JSON.stringify(ALL_COMMANDS)
    });

    if (response.ok) {
        console.log("✅ Succes! Menuen er opdateret i Discord.");
    } else {
        console.error("❌ Fejl:", await response.text());
    }
}

installCommands();
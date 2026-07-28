import { InteractionType, InteractionResponseType, verifyKey } from "discord-interactions";
import { MongoClient } from "mongodb";

const DB_ELO_NAME = "EloRanking";
const PLAYERS_COLLECTION = "Players";
const PLAYERS_HISTORY_COLLECTION = "Seasons";
const GAMES_COLLECTION = "Games";
const SETTINGS_COLLECTION = "Settings";
const HANNIBAL_ID = "253543574342205440";
const K = 32;
// En tilskuer får 20% af det holdet han satsede på vandt eller tabte — dog
// altid mindst 1 point, så et væddemål aldrig er gratis.
const BET_SHARE = 0.2;
const BET_MINIMUM = 1;

export default {
    async fetch(request, env) {
        // 1. Verificer Discord signatur
        const signature = request.headers.get('x-signature-ed25519');
        const timestamp = request.headers.get('x-signature-timestamp');
        const body = await request.arrayBuffer();

        const isValid = await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY);
        if (!isValid) return new Response('Invalid signature', { status: 401 });

        const interaction = JSON.parse(new TextDecoder().decode(body));

        if (interaction.type === InteractionType.PING) {
            return Response.json({ type: InteractionResponseType.PONG });
        }

        if (interaction.type === InteractionType.APPLICATION_COMMAND) {
            const { name, options } = interaction.data;
            const { user, nick } = interaction.member;
            const global_name = nick || user.global_name || user.username;
            const id = user.id;
            const channel_id = interaction.channel_id;

            // 2. Forbind til MongoDB
            const client = new MongoClient(env.MONGODB_URI);
            try {
                await client.connect();
                const db = client.db(DB_ELO_NAME);

                // Hjælpefunktion til at sende svar tilbage
                const respond = (msg) => Response.json({
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: { content: msg }
                });

                // 3. Routing af kommandoer
                switch (name) {

                    // --- ADMIN COMMANDS ---

                    case "force-cancel":
                        if (id !== HANNIBAL_ID) return respond("Only admins can use this command!");
                        await db.collection(GAMES_COLLECTION).updateMany(
                            { status: { $in: ["pending", "started", "result"] }, channelId: channel_id },
                            { $set: { status: "cancelled" } }
                        );
                        return respond("You have now reset the full set of games!");

                    case "reset-season":
                        if (id !== HANNIBAL_ID) return respond("Only admins can use this command!");
                        const session = client.startSession();
                        let newSeasonId = 1;
                        try {
                            const lastSeason = await db.collection(PLAYERS_HISTORY_COLLECTION).findOne({ channelId: channel_id }, { sort: { seasonId: -1 } });
                            if (lastSeason) newSeasonId = lastSeason.seasonId + 1;

                            await session.withTransaction(async () => {
                                const playersToArchive = await db.collection(PLAYERS_COLLECTION).find({ channelId: channel_id }).toArray();
                                if (playersToArchive.length === 0) throw new Error("EMPTY");

                                const archivedPlayers = playersToArchive.map(p => ({ ...p, seasonId: newSeasonId, archivedAt: new Date() }));
                                await db.collection(PLAYERS_HISTORY_COLLECTION).insertMany(archivedPlayers, { session });
                                await db.collection(PLAYERS_COLLECTION).deleteMany({ channelId: channel_id }, { session });
                            });
                            return respond(`Successfully archived Season ${newSeasonId} and reset the ranking for Season ${newSeasonId + 1}!`);
                        } catch (e) {
                            if (e.message === "EMPTY") return respond("There are no players to archive. The ranking is already empty.");
                            return respond("An error occurred during the archive process.");
                        } finally {
                            await session.endSession();
                        }

                    case "blind-season-toggle":
                        if (id !== HANNIBAL_ID) return respond("Only admins can use this command!");
                        const currentSetting = await db.collection(SETTINGS_COLLECTION).findOne({ channelId: channel_id });
                        const isCurrentlyBlind = currentSetting?.isBlind ?? false;
                        await db.collection(SETTINGS_COLLECTION).updateOne(
                            { channelId: channel_id }, { $set: { isBlind: !isCurrentlyBlind } }, { upsert: true }
                        );
                        return respond(`Blind Season is now **${!isCurrentlyBlind ? "ACTIVATED 🙈" : "DEACTIVATED 🐵"}**!`);

                    // --- RANKING OG BRUGER COMMANDS ---

                    case "join-ranking":
                        const playerJoinCount = await db.collection(PLAYERS_COLLECTION).countDocuments({ playerId: id, channelId: channel_id });
                        if (playerJoinCount > 0) return respond("You have already joined the ranking!");

                        await db.collection(PLAYERS_COLLECTION).insertOne({
                            name: global_name, username: "", playerId: id, singleRanking: 1000, doubleRanking: 1000,
                            wins: 0, loses: 0, winningStreak: 0, losingStreak: 0, channelId: channel_id, admin: false,
                        });
                        return respond(`${global_name} has just joined the ranking! To see the ranking you can use the **/single-ranking** or **/double-ranking** commands.`);

                    case "edit-username":
                        const newUsername = options[0].value;
                        const updatedUser = await db.collection(PLAYERS_COLLECTION).findOneAndUpdate(
                            { playerId: id, channelId: channel_id },
                            { $set: { username: newUsername } },
                            { returnDocument: 'after' }
                        );
                        if (!updatedUser) return respond(`${global_name} has not joined the ranking yet. Use **/join-ranking**.`);
                        return respond(`You have changed your username to: ${newUsername}!`);

                    case "single-ranking":
                    case "double-ranking":
                        const s_settings = await db.collection(SETTINGS_COLLECTION).findOne({ channelId: channel_id });
                        if (s_settings?.isBlind) return respond("🙈 **BLIND SEASON ER AKTIV!** 🙈\nRanglisten er skjult indtil sæsonen er slut. Kæmp videre i blinde!");

                        const isSingle = name === "single-ranking";
                        const sortField = isSingle ? "singleRanking" : "doubleRanking";

                        const rows = await db.collection(PLAYERS_COLLECTION).find({ channelId: channel_id }).sort({ [sortField]: -1 }).toArray();
                        if (rows.length === 0) return respond("Ingen spillere på ranglisten endnu.");

                        let currentRank = 0;
                        let lastElo = -1;
                        let playersAtSameElo = 1;

                        const printRows = rows.map((row, index) => {
                            const currentScore = isSingle ? row.singleRanking : row.doubleRanking;
                            if (currentScore !== lastElo) {
                                currentRank += playersAtSameElo;
                                if (index === 0) currentRank = 1;
                                playersAtSameElo = 1;
                            } else {
                                playersAtSameElo++;
                            }
                            lastElo = currentScore;

                            const fire = "🔥".repeat(Math.floor(row.winningStreak / 5));
                            const poop = row.losingStreak >= 10 ? `💩` : "";

                            let rankPrefix = `${currentRank}. `;
                            if (currentRank === 1) rankPrefix = `🥇`;
                            else if (currentRank === 2) rankPrefix = `🥈`;
                            else if (currentRank === 3) rankPrefix = `🥉`;

                            const displayName = row.username ? row.username : row.name;
                            return `${rankPrefix}${displayName}: ${currentScore} ${fire}${poop}`;
                        });
                        return respond(`🏆 **${isSingle ? "Single" : "Double"} Ranking** 🏆\n--------------------------------------\n` + printRows.join('\n'));

                    case "season-ranking":
                        const seasonId = options[0].value;
                        const sRows = await db.collection(PLAYERS_HISTORY_COLLECTION).find({ channelId: channel_id, seasonId: seasonId }).sort({ doubleRanking: -1 }).toArray();
                        if (sRows.length === 0) return respond(`No ranking data found for season: **${seasonId}**`);

                        const seasonTitle = `🏆 **Ranking for Season: ${seasonId}** 🏆\n--------------------------------------`;
                        let sLastElo = -1;
                        let sCurrentRank = 0;

                        const sPrintRows = sRows.map((row, index) => {
                            if (row.doubleRanking !== sLastElo) sCurrentRank = index + 1;
                            sLastElo = row.doubleRanking;

                            const fire = "🔥".repeat(Math.floor(row.winningStreak / 5));
                            const poop = row.losingStreak >= 10 ? `💩` : "";

                            let rankPrefix = `${sCurrentRank}. `;
                            if (sCurrentRank === 1) rankPrefix = `🥇`;
                            else if (sCurrentRank === 2) rankPrefix = `🥈`;
                            else if (sCurrentRank === 3) rankPrefix = `🥉`;

                            return `${rankPrefix}${row.name}: ${row.doubleRanking} ${fire}${poop}`;
                        });
                        return respond([seasonTitle, ...sPrintRows].join('\n'));

                    case "stats":
                        const statSettings = await db.collection(SETTINGS_COLLECTION).findOne({ channelId: channel_id });
                        if (statSettings?.isBlind) return respond("🙈 **BLIND SEASON ER AKTIV!** 🙈\nStatistikker er skjult indtil sæsonen er slut!");

                        const statRows = await db.collection(PLAYERS_COLLECTION).find({ channelId: channel_id }).sort({ name: 1 }).toArray();
                        const statPrint = statRows.map(row => {
                            const matchesPlayed = row.wins + row.loses;
                            const winRate = matchesPlayed > 0 ? ((row.wins / matchesPlayed) * 100).toFixed(2) : 0;
                            let currentStreak = "-";
                            if (row.winningStreak > 0) currentStreak = `W${row.winningStreak}`;
                            else if (row.losingStreak > 0) currentStreak = `L${row.losingStreak}`;
                            return `${row.name} - MP: ${matchesPlayed}, WR: ${winRate}%, Streak: ${currentStreak}`;
                        });
                        if (statPrint.length > 0) return respond(statPrint.join('\n'));
                        return respond("There are no statistics yet!");

                    // --- MATCHMAKING COMMANDS ---

                    case "play-single":
                        const sPlayer = await db.collection(PLAYERS_COLLECTION).findOne({ playerId: id, channelId: channel_id });
                        if (!sPlayer) return respond(`${global_name} has not joined the ranking yet. Use **/join-ranking**.`);

                        const sActive = await db.collection(GAMES_COLLECTION).findOne({
                            status: { $in: ["pending", "started", "result"] }, channelId: channel_id,
                            $or: [{ playerId1: id }, { playerId2: id }, { playerId3: id }, { playerId4: id }]
                        });
                        if (sActive) return respond(`${global_name} is already in a game or has an open challenge!`);

                        await db.collection(GAMES_COLLECTION).insertOne({
                            playerName1: sPlayer.name, playerId1: id, playerName2: null, playerId2: null,
                            playerName3: null, playerId3: null, playerName4: null, playerId4: null,
                            teamElo1: sPlayer.singleRanking, teamElo2: null, status: "pending", type: "single",
                            team1Score: null, team2Score: null, channelId: channel_id,
                        });
                        return respond(`${global_name} has now created a single game. Someone has to accept the challenge!`);

                    case "single-accepted":
                        const creatorId = options[0].value;
                        if (creatorId === id) return respond("You can't accept your own challenge. Please go find some friends...");

                        const challenger = await db.collection(PLAYERS_COLLECTION).findOne({ playerId: id, channelId: channel_id });
                        if (!challenger) return respond("You have not joined the ranking yet.");

                        const cActive = await db.collection(GAMES_COLLECTION).findOne({
                            status: { $in: ["pending", "started", "result"] }, channelId: channel_id,
                            $or: [{ playerId1: id }, { playerId2: id }, { playerId3: id }, { playerId4: id }]
                        });
                        if (cActive) return respond("You are already in a game!");

                        const sGame = await db.collection(GAMES_COLLECTION).findOneAndUpdate(
                            { playerId1: creatorId, status: "pending", channelId: channel_id, type: "single" },
                            { $set: { playerName2: challenger.name, playerId2: challenger.playerId, teamElo2: challenger.singleRanking, status: "started" } },
                            { returnDocument: 'after' }
                        );
                        if (!sGame) return respond("There is no pending single game for that user.");

                        const blindSet = await db.collection(SETTINGS_COLLECTION).findOne({ channelId: channel_id });
                        return respond(`A single game is created between: \n<@${sGame.playerId1}> (elo: ${blindSet?.isBlind ? "???" : sGame.teamElo1}) \n<@${sGame.playerId2}> (elo: ${blindSet?.isBlind ? "???" : sGame.teamElo2}) \n\nHave a nice game!!`);

                    case "play-double":
                        const dPlayer = await db.collection(PLAYERS_COLLECTION).findOne({ playerId: id, channelId: channel_id });
                        if (!dPlayer) return respond("You have not joined the ranking yet.");

                        const partnerId = options[0].value;
                        if (partnerId === id) return respond("You can not play a game with yourself.");

                        const partner = await db.collection(PLAYERS_COLLECTION).findOne({ playerId: partnerId, channelId: channel_id });
                        if (!partner) return respond("Your partner has not joined the ranking yet.");

                        const dActive = await db.collection(GAMES_COLLECTION).findOne({
                            status: { $in: ["pending", "started", "result"] }, channelId: channel_id,
                            $or: [
                                { playerId1: id }, { playerId2: id }, { playerId3: id }, { playerId4: id },
                                { playerId1: partnerId }, { playerId2: partnerId }, { playerId3: partnerId }, { playerId4: partnerId }
                            ]
                        });
                        if (dActive) return respond(`Either you or your partner are already in a game!`);

                        const teamElo = (dPlayer.doubleRanking + partner.doubleRanking) / 2;
                        await db.collection(GAMES_COLLECTION).insertOne({
                            playerName1: dPlayer.name, playerId1: id, playerName2: partner.name, playerId2: partnerId,
                            playerName3: null, playerId3: null, playerName4: null, playerId4: null,
                            teamElo1: teamElo, teamElo2: null, status: "pending", type: "double", channelId: channel_id,
                        });

                        const dBlind = await db.collection(SETTINGS_COLLECTION).findOne({ channelId: channel_id });
                        return respond(`<@${dPlayer.playerId}> and <@${partner.playerId}> (elo: ${dBlind?.isBlind ? "???" : teamElo}) have created a game. Now someone else has to accept the challenge!`);

                    case "double-accepted":
                        const daPlayer = await db.collection(PLAYERS_COLLECTION).findOne({ playerId: id, channelId: channel_id });
                        if (!daPlayer) return respond("You have not joined the ranking yet.");

                        const daPartnerId = options[0].value;
                        if (daPartnerId === id) return respond("You can not play a game with yourself.");

                        const daPartner = await db.collection(PLAYERS_COLLECTION).findOne({ playerId: daPartnerId, channelId: channel_id });
                        if (!daPartner) return respond("Your partner has not joined the ranking yet.");

                        const daCreatorId = options[1].value;

                        const daActive = await db.collection(GAMES_COLLECTION).findOne({
                            status: { $in: ["pending", "started", "result"] }, channelId: channel_id,
                            $or: [
                                { playerId1: id }, { playerId2: id }, { playerId3: id }, { playerId4: id },
                                { playerId1: daPartnerId }, { playerId2: daPartnerId }, { playerId3: daPartnerId }, { playerId4: daPartnerId }
                            ]
                        });
                        if (daActive) return respond(`Either you or your partner are already in a game!`);

                        const daGame = await db.collection(GAMES_COLLECTION).findOneAndUpdate(
                            { $or: [{ playerId1: daCreatorId }, { playerId2: daCreatorId }], status: "pending", channelId: channel_id, type: "double" },
                            { $set: {
                                    playerName3: daPlayer.name, playerId3: id, playerName4: daPartner.name, playerId4: daPartnerId,
                                    teamElo2: (daPlayer.doubleRanking + daPartner.doubleRanking) / 2, status: "started"
                                }}, { returnDocument: 'after' }
                        );
                        if (!daGame) return respond("The creator has not created any game to be accepted.");

                        const daBlind = await db.collection(SETTINGS_COLLECTION).findOne({ channelId: channel_id });
                        return respond(`A game is created between: \nTeam 1: <@${daGame.playerId1}>, <@${daGame.playerId2}> (elo: ${daBlind?.isBlind ? "???" : daGame.teamElo1}) \nTeam 2: <@${daGame.playerId3}>, <@${daGame.playerId4}> (elo: ${daBlind?.isBlind ? "???" : daGame.teamElo2}) \n\nHave a nice game!`);

                    case "play":
                        // Double-random logik
                        const prPlayer = await db.collection(PLAYERS_COLLECTION).findOne({ playerId: id, channelId: channel_id });
                        if (!prPlayer) return respond("You have not joined the ranking yet.");

                        const prActive = await db.collection(GAMES_COLLECTION).findOne({
                            status: { $in: ["pending", "started", "result"] }, channelId: channel_id,
                            $or: [{ playerId1: id }, { playerId2: id }, { playerId3: id }, { playerId4: id }]
                        });
                        if (prActive) return respond("You are already in a game!");

                        let prGame = await db.collection(GAMES_COLLECTION).findOne({ type: "double-random", status: "pending", channelId: channel_id });
                        if (!prGame) {
                            await db.collection(GAMES_COLLECTION).insertOne({
                                playerName1: prPlayer.name, playerId1: id, playerName2: null, playerId2: null,
                                playerName3: null, playerId3: null, playerName4: null, playerId4: null,
                                teamElo1: null, teamElo2: null, status: "pending", type: "double-random", channelId: channel_id,
                            });
                            return respond(`${global_name} has joined the game! (1/4)\n\n`);
                        } else {
                            if (!prGame.playerId1) await db.collection(GAMES_COLLECTION).updateOne({ _id: prGame._id }, { $set: { playerId1: id, playerName1: prPlayer.name } });
                            else if (!prGame.playerId2) await db.collection(GAMES_COLLECTION).updateOne({ _id: prGame._id }, { $set: { playerId2: id, playerName2: prPlayer.name } });
                            else if (!prGame.playerId3) await db.collection(GAMES_COLLECTION).updateOne({ _id: prGame._id }, { $set: { playerId3: id, playerName3: prPlayer.name } });
                            else if (!prGame.playerId4) await db.collection(GAMES_COLLECTION).updateOne({ _id: prGame._id }, { $set: { playerId4: id, playerName4: prPlayer.name } });
                        }

                        prGame = await db.collection(GAMES_COLLECTION).findOne({ _id: prGame._id });
                        if (prGame.playerId1 && prGame.playerId2 && prGame.playerId3 && prGame.playerId4) {
                            const gamePlayers = await db.collection(PLAYERS_COLLECTION).find({
                                playerId: { $in: [prGame.playerId1, prGame.playerId2, prGame.playerId3, prGame.playerId4] }, channelId: channel_id
                            }).toArray();

                            const randomNumbers = getUniqueRandomNumbers();
                            const p1 = gamePlayers[randomNumbers[0]];
                            const p2 = gamePlayers[randomNumbers[1]];
                            const p3 = gamePlayers[randomNumbers[2]];
                            const p4 = gamePlayers[randomNumbers[3]];

                            const tElo1 = (p1.doubleRanking + p2.doubleRanking) / 2;
                            const tElo2 = (p3.doubleRanking + p4.doubleRanking) / 2;

                            await db.collection(GAMES_COLLECTION).updateOne({ _id: prGame._id }, {
                                $set: {
                                    playerName1: p1.name, playerId1: p1.playerId, playerName2: p2.name, playerId2: p2.playerId,
                                    playerName3: p3.name, playerId3: p3.playerId, playerName4: p4.name, playerId4: p4.playerId,
                                    type: "double", status: "started", teamElo1: tElo1, teamElo2: tElo2,
                                }
                            });

                            const prBlind = await db.collection(SETTINGS_COLLECTION).findOne({ channelId: channel_id });
                            return respond(`${global_name} has joined the game! (4/4)\n\nThe teams are: \nTeam 1: <@${p1.playerId}>, <@${p2.playerId}> (elo: ${prBlind?.isBlind ? "???" : tElo1}) \nTeam 2: <@${p3.playerId}>, <@${p4.playerId}> (elo: ${prBlind?.isBlind ? "???" : tElo2}) \n\nHave a nice game!`);
                        } else {
                            const count = [prGame.playerId1, prGame.playerId2, prGame.playerId3, prGame.playerId4].filter(x => x !== null).length;
                            return respond(`${global_name} has joined the game! (${count}/4)\n\n`);
                        }

                    case "bet":
                        // Væddemål gemmes på selve kampen, så de dør sammen med den hvis den
                        // bliver annulleret — og så er de allerede hentet når /accept afregner.
                        const btPlayer = await db.collection(PLAYERS_COLLECTION).findOne({ playerId: id, channelId: channel_id });
                        if (!btPlayer) return respond("You have not joined the ranking yet.");

                        const btTeam = options.find(o => o.name === "team").value;
                        const btMatchOption = options.find(o => o.name === "match");

                        // Der kan sagtens være flere kampe i gang i kanalen, så vi lader
                        // brugeren pege på én hvis der er tvivl.
                        const btStarted = await db.collection(GAMES_COLLECTION).find(
                            { status: "started", channelId: channel_id }
                        ).sort({ _id: 1 }).toArray();
                        if (btStarted.length === 0) return respond("There is no started match to bet on right now.");

                        let btGame = null;
                        if (btMatchOption) {
                            btGame = btStarted[btMatchOption.value - 1];
                            if (!btGame) return respond(`There is no match number ${btMatchOption.value}. There are ${btStarted.length} started matches.`);
                        } else if (btStarted.length === 1) {
                            btGame = btStarted[0];
                        } else {
                            const btList = btStarted.map((g, i) => `${i + 1}. ${getTeamLabel(g, 1)} - ${getTeamLabel(g, 2)}`);
                            return respond(`There are several started matches. Add the match number, for example **/bet team:1 match:2**\n\n${btList.join('\n')}`);
                        }

                        if ([btGame.playerId1, btGame.playerId2, btGame.playerId3, btGame.playerId4].includes(id)) {
                            return respond("You can't bet on a match you are playing in yourself!");
                        }
                        if (btGame.bettingClosed) return respond("The result for that match has already been reported, so betting is closed.");

                        // Filteret gentager status-tjekket, så et væddemål ikke kan snige sig ind
                        // i samme øjeblik som resultatet bliver indberettet.
                        const btGuard = { _id: btGame._id, status: "started", bettingClosed: { $ne: true } };

                        const btPlaced = await db.collection(GAMES_COLLECTION).updateOne(
                            { ...btGuard, "bets.playerId": { $ne: id } },
                            { $push: { bets: { playerId: id, playerName: global_name, team: btTeam, placedAt: new Date() } } }
                        );
                        if (btPlaced.matchedCount === 1) {
                            return respond(`💰 ${global_name} bet on **Team ${btTeam}** (${getTeamLabel(btGame, btTeam)})!`);
                        }

                        const btChanged = await db.collection(GAMES_COLLECTION).updateOne(
                            { ...btGuard, "bets.playerId": id },
                            { $set: { "bets.$.team": btTeam, "bets.$.placedAt": new Date() } }
                        );
                        if (btChanged.matchedCount === 1) {
                            return respond(`💰 ${global_name} moved the bet to **Team ${btTeam}** (${getTeamLabel(btGame, btTeam)})!`);
                        }

                        return respond("Betting just closed for that match.");

                    case "cancel":
                        const cGame = await db.collection(GAMES_COLLECTION).findOne({
                            status: { $in: ["pending", "started", "result"] }, channelId: channel_id,
                            $or: [{ playerId1: id }, { playerId2: id }, { playerId3: id }, { playerId4: id }]
                        });
                        if (!cGame) return respond("You have nothing to cancel.");

                        if (cGame.status === "pending" && cGame.type === "double-random") {
                            const pCount = [cGame.playerId1, cGame.playerId2, cGame.playerId3, cGame.playerId4].filter(x => x !== null).length;
                            if (pCount === 1) {
                                await db.collection(GAMES_COLLECTION).updateOne({ _id: cGame._id }, { $set: { status: "cancelled", playerId1: null, playerName1: null }});
                                return respond(`${global_name}'s game has been cancelled.`);
                            } else {
                                const unsetQuery = {};
                                if (cGame.playerId1 === id) { unsetQuery.playerId1 = null; unsetQuery.playerName1 = null; }
                                else if (cGame.playerId2 === id) { unsetQuery.playerId2 = null; unsetQuery.playerName2 = null; }
                                else if (cGame.playerId3 === id) { unsetQuery.playerId3 = null; unsetQuery.playerName3 = null; }
                                else if (cGame.playerId4 === id) { unsetQuery.playerId4 = null; unsetQuery.playerName4 = null; }
                                await db.collection(GAMES_COLLECTION).updateOne({ _id: cGame._id }, { $set: unsetQuery });
                                return respond(`${global_name} have been removed from the game.`);
                            }
                        } else {
                            await db.collection(GAMES_COLLECTION).updateOne({ _id: cGame._id }, { $set: { status: "cancelled" }});
                            return respond(`${global_name}'s game has been cancelled.`);
                        }

                    // --- RESULTS OG ELO BEREGNING ---

                    case "result":
                        const team1Score = options[0].value;
                        const team2Score = options[1].value;
                        let fTeam1 = team1Score > team2Score ? 1 : (team1Score === team2Score ? 0.5 : 0);
                        let fTeam2 = team1Score > team2Score ? 0 : (team1Score === team2Score ? 0.5 : 1);

                        const rGame = await db.collection(GAMES_COLLECTION).findOneAndUpdate(
                            { status: "started", channelId: channel_id, $or: [{ playerId1: id }, { playerId2: id }, { playerId3: id }, { playerId4: id }] },
                            // bettingClosed bliver aldrig sat tilbage af /reject. Ellers kunne man
                            // indberette et resultat, se det, afvise det og så vædde bagefter.
                            { $set: { team1Score: fTeam1, team2Score: fTeam2, status: "result", bettingClosed: true } },
                            { returnDocument: 'after' }
                        );
                        if (!rGame) return respond("You have not participated in any started game.");

                        if (rGame.type === "single") {
                            return respond(`Result reported by ${global_name}: \n\n${rGame.playerName1}: ${fTeam1}\n${rGame.playerName2}: ${fTeam2}\n\nTo accept the result type: **/accept**\nTo reject the result type: **/reject**`);
                        } else {
                            return respond(`Result reported by ${global_name}: \n\nTeam 1: ${rGame.playerName1}, ${rGame.playerName2}: ${fTeam1}\nTeam 2: ${rGame.playerName3}, ${rGame.playerName4}: ${fTeam2}\n\nTo accept the result type: **/accept**\nTo reject the result type: **/reject**`);
                        }

                    case "reject":
                        const rejGame = await db.collection(GAMES_COLLECTION).findOneAndUpdate(
                            { status: "result", channelId: channel_id, $or: [{ playerId1: id }, { playerId2: id }, { playerId3: id }, { playerId4: id }] },
                            { $set: { status: "started", team1Score: null, team2Score: null } }
                        );
                        if (!rejGame) return respond("You have to be part of the game to *reject* it!");
                        return respond(`${global_name} has *rejected* the result. Type in a new result to be accepted.`);

                    case "accept":
                        const accBlindSet = await db.collection(SETTINGS_COLLECTION).findOne({ channelId: channel_id });
                        const isAccBlind = accBlindSet?.isBlind ?? false;

                        const aGame = await db.collection(GAMES_COLLECTION).findOne({
                            status: "result", channelId: channel_id, $or: [{ playerId1: id }, { playerId2: id }, { playerId3: id }, { playerId4: id }]
                        });
                        if (!aGame) return respond("You have to be part of the game to *accept* it!");

                        const t1Diff = calculateEloRatingDifference(aGame.teamElo1, aGame.teamElo2, aGame.team1Score, K);
                        const t2Diff = calculateEloRatingDifference(aGame.teamElo2, aGame.teamElo1, aGame.team2Score, K);

                        let accMessage = "The result has been accepted! \n\n";
                        if (isAccBlind) accMessage += "🙈 Pointene er blevet opdateret i skyggerne... Ingen ved hvor meget I vandt eller tabte!\n";

                        if (aGame.type === "single") {
                            const p1 = await db.collection(PLAYERS_COLLECTION).findOne({ playerId: aGame.playerId1, channelId: channel_id });
                            const p2 = await db.collection(PLAYERS_COLLECTION).findOne({ playerId: aGame.playerId2, channelId: channel_id });

                            // Opdater Spiller 1
                            let updateP1 = { $set: { singleRanking: p1.singleRanking + t1Diff }};
                            if (aGame.team1Score === 1) updateP1 = { $set: { singleRanking: p1.singleRanking + t1Diff, losingStreak: 0 }, $inc: { winningStreak: 1, wins: 1 }};
                            else if (aGame.team1Score === 0) updateP1 = { $set: { singleRanking: p1.singleRanking + t1Diff, winningStreak: 0 }, $inc: { losingStreak: 1, loses: 1 }};
                            await db.collection(PLAYERS_COLLECTION).updateOne({ playerId: aGame.playerId1, channelId: channel_id }, updateP1);
                            if (!isAccBlind) accMessage += `Updated Elo for ${aGame.playerName1}: ${p1.singleRanking} -> ${p1.singleRanking + t1Diff} (${t1Diff})\n`;

                            // Opdater Spiller 2
                            let updateP2 = { $set: { singleRanking: p2.singleRanking + t2Diff }};
                            if (aGame.team2Score === 1) updateP2 = { $set: { singleRanking: p2.singleRanking + t2Diff, losingStreak: 0 }, $inc: { winningStreak: 1, wins: 1 }};
                            else if (aGame.team2Score === 0) updateP2 = { $set: { singleRanking: p2.singleRanking + t2Diff, winningStreak: 0 }, $inc: { losingStreak: 1, loses: 1 }};
                            await db.collection(PLAYERS_COLLECTION).updateOne({ playerId: aGame.playerId2, channelId: channel_id }, updateP2);
                            if (!isAccBlind) accMessage += `Updated Elo for ${aGame.playerName2}: ${p2.singleRanking} -> ${p2.singleRanking + t2Diff} (${t2Diff})\n`;

                        } else {
                            // Double opdatering logik (lidt mere kompakt end dit gamle)
                            const playerIds = [aGame.playerId1, aGame.playerId2, aGame.playerId3, aGame.playerId4];
                            const players = await db.collection(PLAYERS_COLLECTION).find({ playerId: { $in: playerIds }, channelId: channel_id }).toArray();
                            const pMap = new Map(players.map(p => [p.playerId, p]));

                            for (const pid of [aGame.playerId1, aGame.playerId2]) {
                                const p = pMap.get(pid);
                                let upd = { $set: { doubleRanking: p.doubleRanking + t1Diff }};
                                if (aGame.team1Score === 1) upd = { $set: { doubleRanking: p.doubleRanking + t1Diff, losingStreak: 0 }, $inc: { winningStreak: 1, wins: 1 }};
                                else if (aGame.team1Score === 0) upd = { $set: { doubleRanking: p.doubleRanking + t1Diff, winningStreak: 0 }, $inc: { losingStreak: 1, loses: 1 }};
                                await db.collection(PLAYERS_COLLECTION).updateOne({ playerId: pid, channelId: channel_id }, upd);
                                if (!isAccBlind) accMessage += `Updated rating for ${p.name}: ${p.doubleRanking} -> ${p.doubleRanking + t1Diff} (${t1Diff})\n`;
                            }

                            for (const pid of [aGame.playerId3, aGame.playerId4]) {
                                const p = pMap.get(pid);
                                let upd = { $set: { doubleRanking: p.doubleRanking + t2Diff }};
                                if (aGame.team2Score === 1) upd = { $set: { doubleRanking: p.doubleRanking + t2Diff, losingStreak: 0 }, $inc: { winningStreak: 1, wins: 1 }};
                                else if (aGame.team2Score === 0) upd = { $set: { doubleRanking: p.doubleRanking + t2Diff, winningStreak: 0 }, $inc: { losingStreak: 1, loses: 1 }};
                                await db.collection(PLAYERS_COLLECTION).updateOne({ playerId: pid, channelId: channel_id }, upd);
                                if (!isAccBlind) accMessage += `Updated rating for ${p.name}: ${p.doubleRanking} -> ${p.doubleRanking + t2Diff} (${t2Diff})\n`;
                            }
                        }

                        const betSummary = await settleBets(db, aGame, t1Diff, t2Diff, channel_id, isAccBlind);
                        if (betSummary) accMessage += `\n${betSummary}`;

                        await db.collection(GAMES_COLLECTION).updateOne({ _id: aGame._id }, { $set: { status: "ended" } });
                        return respond(accMessage);

                    case "matches-overview":
                        const matches = await db.collection(GAMES_COLLECTION).find({
                            status: { $in: ["pending", "started", "result"] }, channelId: channel_id
                        }).toArray();

                        if (matches.length === 0) return respond("No pending, started or resulting matches!");

                        let moMessage = "";
                        const pending = matches.filter(m => m.status === "pending");
                        if (pending.length > 0) {
                            moMessage += "**PENDING MATCHES**\n";
                            const pSingles = pending.filter(m => m.type === "single");
                            if (pSingles.length > 0) {
                                moMessage += "**SINGLES:**\n" + pSingles.map((m, i) => `${i+1}. ${m.playerName1} - ${m.playerName2 || "TBA"}`).join('\n') + "\n\n";
                            }
                            const pDoubles = pending.filter(m => m.type === "double");
                            if (pDoubles.length > 0) {
                                moMessage += "**DOUBLES:**\n" + pDoubles.map((m, i) => `${i+1}. ${m.playerName1}, ${m.playerName2} - ${m.playerName3 || "TBA"}, ${m.playerName4 || "TBA"}`).join('\n') + "\n\n";
                            }
                            const pRandom = pending.filter(m => m.type === "double-random");
                            if (pRandom.length > 0) {
                                moMessage += "**DOUBLES RANDOM:**\n";
                                const m = pRandom[0];
                                if (m.playerId1) moMessage += `${m.playerName1}\n`;
                                if (m.playerId2) moMessage += `${m.playerName2}\n`;
                                if (m.playerId3) moMessage += `${m.playerName3}\n`;
                                if (m.playerId4) moMessage += `${m.playerName4}\n`;
                                moMessage += "\n";
                            }
                        }

                        const started = matches.filter(m => m.status === "started");
                        if (started.length > 0) {
                            moMessage += "**STARTED MATCHES**\n";
                            const sSingles = started.filter(m => m.type === "single");
                            if (sSingles.length > 0) moMessage += "**SINGLES:**\n" + sSingles.map((m, i) => `${i+1}. ${m.playerName1} - ${m.playerName2}`).join('\n') + "\n\n";
                            const sDoubles = started.filter(m => m.type === "double");
                            if (sDoubles.length > 0) moMessage += "**DOUBLES:**\n" + sDoubles.map((m, i) => `${i+1}. ${m.playerName1}, ${m.playerName2} - ${m.playerName3}, ${m.playerName4}`).join('\n') + "\n\n";
                        }

                        const results = matches.filter(m => m.status === "result");
                        if (results.length > 0) {
                            moMessage += "**MISSING RESULTS (Awaiting Accept)**\n";
                            const rSingles = results.filter(m => m.type === "single");
                            if (rSingles.length > 0) moMessage += "**SINGLES:**\n" + rSingles.map((m, i) => `${i+1}. ${m.playerName1} - ${m.playerName2}`).join('\n') + "\n\n";
                            const rDoubles = results.filter(m => m.type === "double");
                            if (rDoubles.length > 0) moMessage += "**DOUBLES:**\n" + rDoubles.map((m, i) => `${i+1}. ${m.playerName1}, ${m.playerName2} - ${m.playerName3}, ${m.playerName4}`).join('\n') + "\n\n";
                        }

                        return respond(moMessage);

                    case "help":
                        return respond(
                            "**HOW TO PLAY**\n" +
                            `Before you start, you have to join the system by typing: **/join-ranking**.\n\n` +
                            "With this system you can play singles, doubles and doubles with a random partner. \n\n" +
                            "**SINGLE**\n" +
                            `To start a single type: **/play-single**.\n` +
                            `To accept type: **/single-accepted** and add the creator.\n\n` +
                            "**DOUBLE**\n" +
                            `To start a double type: **/play-double** and add your partner.\n` +
                            `To accept type: **/double-accepted** and add your partner and the creator.\n\n` +
                            "**DOUBLE RANDOM**\n" +
                            `To start a random double type: **/play**. Game starts when 4 players join.\n\n` +
                            "**GAMES**\n" +
                            `Report result: **/result**.\n` +
                            `Accept result: **/accept**.\n\n` +
                            "**BETTING**\n" +
                            `Not playing? Bet on a team with **/bet**. You win or lose ${BET_SHARE * 100}% of what that team gets (at least ${BET_MINIMUM}).\n` +
                            `Betting closes as soon as the result is reported.\n\n` +
                            "**RANKING**\n" +
                            `See rankings: **/single-ranking** or **/double-ranking**.`
                        );

                    default:
                        return respond(`Command not implemented yet: ${name}`);
                }

            } catch (error) {
                console.error("En fejl opstod i botten:", error);
                return Response.json({
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: { content: "❌ Der skete en uventet fejl i databasen. Prøv igen senere." }
                });
            } finally {
                // Databasen lukkes sikkert
                await client.close();
            }
        }
        return new Response('Unknown interaction', { status: 400 });
    }
};

// --- Væddemål ---

function getTeamLabel(game, team) {
    if (game.type === "single") return team === 1 ? game.playerName1 : game.playerName2;
    return team === 1 ? `${game.playerName1} & ${game.playerName2}` : `${game.playerName3} & ${game.playerName4}`;
}

// teamScore afgør retningen, ikke fortegnet på teamEloDiff. En stor favorit der
// vinder kan nemlig ende på 0 point efter afrunding, og så skal tilskueren
// stadig have sit minimum ud af det.
function calculateBetPayout(teamScore, teamEloDiff) {
    if (teamScore === 1) return Math.max(BET_MINIMUM, Math.round(teamEloDiff * BET_SHARE));
    if (teamScore === 0) return -Math.max(BET_MINIMUM, Math.round(Math.abs(teamEloDiff) * BET_SHARE));
    return 0; // uafgjort: væddemålet er dødt
}

async function settleBets(db, game, team1Diff, team2Diff, channelId, isBlind) {
    const bets = game.bets || [];
    if (bets.length === 0) return "";

    // To spillere kan nå at skrive /accept samtidig. Den første der sætter
    // betsSettled vinder, så ingen får udbetalt to gange.
    const claim = await db.collection(GAMES_COLLECTION).updateOne(
        { _id: game._id, betsSettled: { $ne: true } },
        { $set: { betsSettled: true } }
    );
    if (claim.matchedCount === 0) return "";

    // Et væddemål flytter kun ratingen — ikke wins, loses eller streaks.
    const ratingField = game.type === "single" ? "singleRanking" : "doubleRanking";
    const lines = [];
    let settled = 0;

    for (const bet of bets) {
        const teamScore = bet.team === 1 ? game.team1Score : game.team2Score;
        const teamEloDiff = bet.team === 1 ? team1Diff : team2Diff;
        const payout = calculateBetPayout(teamScore, teamEloDiff);

        if (payout === 0) {
            lines.push(`${bet.playerName} bet on Team ${bet.team}: draw, nothing won or lost.`);
            continue;
        }

        // $inc frem for læs-og-skriv, så to samtidige opdateringer ikke kan
        // overskrive hinandens resultat.
        const updated = await db.collection(PLAYERS_COLLECTION).findOneAndUpdate(
            { playerId: bet.playerId, channelId: channelId },
            { $inc: { [ratingField]: payout } },
            { returnDocument: 'after' }
        );
        if (!updated) continue; // spilleren er væk, fx efter /reset-season

        settled++;
        lines.push(`${bet.playerName} bet on Team ${bet.team}: ${payout > 0 ? "+" : ""}${payout} elo -> ${updated[ratingField]}`);
    }

    if (lines.length === 0) return "";
    if (isBlind) return `**BETS**\n🙈 ${settled} bet(s) were settled in the shadows.`;
    return `**BETS**\n${lines.join('\n')}`;
}

// --- Hjælpefunktioner ---
function getUniqueRandomNumbers() {
    const numbers = [0, 1, 2, 3];
    for (let i = numbers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
    }
    return numbers;
}

function calculateEloRatingDifference(playerRating, opponentRating, score, K = 32) {
    const expectedScore = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
    return Math.round(K * (score - expectedScore));
}
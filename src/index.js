import { InteractionType, InteractionResponseType, verifyKey } from "discord-interactions";
import { MongoClient } from "mongodb";

const DB_ELO_NAME = "EloRanking";
const PLAYERS_COLLECTION = "Players";
const PLAYERS_HISTORY_COLLECTION = "Seasons";
const GAMES_COLLECTION = "Games";
const SETTINGS_COLLECTION = "Settings";
const HANNIBAL_ID = "253543574342205440";
const K = 32;
// 4 spillere kan kun deles op i 3 forskellige holdkombinationer, så 2 rerolls
// er nok til at have set dem alle. Uden et loft kan man rulle til man får den
// makker man gerne vil have — og så er der ikke meget "random" tilbage.
const MAX_REROLLS = 2;

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
                                    // Typen skiftes til "double" så resten af botten (accept, matches-overview)
                                    // behandler kampen som en helt normal double. isRandom husker hvor den kom fra,
                                    // så kun /play-kampe kan rerolles — ikke dem hvor man selv har valgt makker.
                                    isRandom: true, rerollCount: 0,
                                }
                            });

                            const prBlind = await db.collection(SETTINGS_COLLECTION).findOne({ channelId: channel_id });
                            return respond(`${global_name} has joined the game! (4/4)\n\nThe teams are: \nTeam 1: <@${p1.playerId}>, <@${p2.playerId}> (elo: ${prBlind?.isBlind ? "???" : tElo1}) \nTeam 2: <@${p3.playerId}>, <@${p4.playerId}> (elo: ${prBlind?.isBlind ? "???" : tElo2}) \n\nHave a nice game!`);
                        } else {
                            const count = [prGame.playerId1, prGame.playerId2, prGame.playerId3, prGame.playerId4].filter(x => x !== null).length;
                            return respond(`${global_name} has joined the game! (${count}/4)\n\n`);
                        }

                    case "reroll":
                        // Blander de 4 spillere i en igangværende random double om til nye hold.
                        const rrGame = await db.collection(GAMES_COLLECTION).findOne({
                            status: "started", type: "double", isRandom: true, channelId: channel_id,
                            $or: [{ playerId1: id }, { playerId2: id }, { playerId3: id }, { playerId4: id }]
                        });
                        if (!rrGame) return respond("You have no teams to reroll. **/reroll** only works on a started game created with **/play**, and only before a result is reported.");

                        if (rrGame.rerollCount >= MAX_REROLLS) return respond(`The teams have already been rerolled ${MAX_REROLLS} times. Time to play!`);

                        const rrIds = [rrGame.playerId1, rrGame.playerId2, rrGame.playerId3, rrGame.playerId4];
                        const rrPlayers = await db.collection(PLAYERS_COLLECTION).find({
                            playerId: { $in: rrIds }, channelId: channel_id
                        }).toArray();

                        // Hold rækkefølgen fra kampen, så vi ved hvem der er makkere lige nu.
                        const rrMap = new Map(rrPlayers.map(p => [p.playerId, p]));
                        const rrCurrent = rrIds.map(pid => rrMap.get(pid));
                        if (rrCurrent.some(p => !p)) return respond("One of the players is no longer on the ranking. Use **/cancel** and start a new game.");

                        const [rrP1, rrP2, rrP3, rrP4] = getRerolledTeams(rrCurrent);
                        const rrElo1 = (rrP1.doubleRanking + rrP2.doubleRanking) / 2;
                        const rrElo2 = (rrP3.doubleRanking + rrP4.doubleRanking) / 2;

                        // rerollCount i filteret gør skrivningen atomisk: rammer to spillere
                        // /reroll samtidig, er der kun én der vinder.
                        const rrUpdated = await db.collection(GAMES_COLLECTION).findOneAndUpdate(
                            { _id: rrGame._id, status: "started", rerollCount: rrGame.rerollCount },
                            { $set: {
                                    playerName1: rrP1.name, playerId1: rrP1.playerId, playerName2: rrP2.name, playerId2: rrP2.playerId,
                                    playerName3: rrP3.name, playerId3: rrP3.playerId, playerName4: rrP4.name, playerId4: rrP4.playerId,
                                    teamElo1: rrElo1, teamElo2: rrElo2,
                                },
                                $inc: { rerollCount: 1 }
                            }, { returnDocument: 'after' }
                        );
                        if (!rrUpdated) return respond("The game changed while the teams were being rerolled. Try **/reroll** again.");

                        const rrBlind = await db.collection(SETTINGS_COLLECTION).findOne({ channelId: channel_id });
                        return respond(`🎲 ${global_name} has rerolled the teams! (${rrUpdated.rerollCount}/${MAX_REROLLS})\n\nThe new teams are: \nTeam 1: <@${rrP1.playerId}>, <@${rrP2.playerId}> (elo: ${rrBlind?.isBlind ? "???" : rrElo1}) \nTeam 2: <@${rrP3.playerId}>, <@${rrP4.playerId}> (elo: ${rrBlind?.isBlind ? "???" : rrElo2}) \n\nHave a nice game!`);

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
                            { $set: { team1Score: fTeam1, team2Score: fTeam2, status: "result" } },
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
                            `To start a random double type: **/play**. Game starts when 4 players join.\n` +
                            `Don't like the teams? Type: **/reroll** (max ${MAX_REROLLS} times per game).\n\n` +
                            "**GAMES**\n" +
                            `Report result: **/result**.\n` +
                            `Accept result: **/accept**.\n\n` +
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

// --- Hjælpefunktioner ---
function getUniqueRandomNumbers() {
    const numbers = [0, 1, 2, 3];
    for (let i = numbers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
    }
    return numbers;
}

// Tager de 4 spillere i deres nuværende rækkefølge ([hold1, hold1, hold2, hold2])
// og returnerer en ny opstilling. Med 4 spillere findes der kun 3 mulige
// holdkombinationer, så en almindelig shuffle ville lande på de samme hold hver
// 3. gang. Derfor beholder vi p1 og giver ham en af de to spillere han IKKE
// spiller med nu — så er holdene garanteret anderledes.
function getRerolledTeams([p1, p2, p3, p4]) {
    return Math.random() < 0.5
        ? [p1, p3, p2, p4]
        : [p1, p4, p2, p3];
}

function calculateEloRatingDifference(playerRating, opponentRating, score, K = 32) {
    const expectedScore = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
    return Math.round(K * (score - expectedScore));
}
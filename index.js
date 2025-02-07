require('dotenv').config();
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');
const translate = require('google-translate-api-x');

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log("✅ Connected to MongoDB"))
.catch(err => console.error("❌ MongoDB Connection Error:", err));

// Fixed lists with cooldown times (in milliseconds)
// Lists 5, 6, and 7 have a cooldown of 1 month; the rest have a cooldown of 1 week
const FIXED_LISTS = [
    { id: "1", name: "Crystal of Chaos", cooldown: 7 * 24 * 60 * 60 * 1000 }, // 1 week
    { id: "2", name: "Feather of Condor", cooldown: 7 * 24 * 60 * 60 * 1000 },
    { id: "3", name: "Jewel of Creation", cooldown: 7 * 24 * 60 * 60 * 1000 },
    { id: "4", name: "Condor's Flame", cooldown: 7 * 24 * 60 * 60 * 1000 },
    { id: "5", name: "Chest for 1st Place", cooldown: 30 * 24 * 60 * 60 * 1000 }, // 1 month
    { id: "6", name: "Archangel Chest", cooldown: 30 * 24 * 60 * 60 * 1000 },      // 1 month
    { id: "7", name: "Awakening Jewel", cooldown: 30 * 24 * 60 * 60 * 1000 }       // 1 month
];

// Define Schema for lists (storing the users that have joined)
const listSchema = new mongoose.Schema({
    name: String,
    users: [String] // Stores user IDs
});
const List = mongoose.model("List", listSchema);

// Schema for storing user cooldowns per list
const cooldownSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    listName: { type: String, required: true },
    expiresAt: { type: Date, required: true }
});
const Cooldown = mongoose.model("Cooldown", cooldownSchema);

// Global variables for the cooldown embed message
const cooldownChannelId = "1337519002741641306";
let cooldownEmbedMessageId = null;

// Function to get or create a list
async function getList(name) {
    let list = await List.findOne({ name });
    if (!list) {
        list = new List({ name, users: [] });
        await list.save();
    }
    return list;
}

// Function to get a user's display name (returns nickname if available, otherwise username)
async function getUserDisplayName(guild, userId) {
    try {
        const member = await guild.members.fetch(userId);
        return member.nickname || member.user.username;
    } catch (error) {
        console.error(`⚠️ Error fetching user ${userId}:`, error);
        return "Unknown User";
    }
}

// Function to build and update the cooldown embed in the target channel.
// It either sends a new message or edits an existing one.
async function updateCooldownEmbed() {
    // Get all active cooldowns (not expired)
    const activeCooldowns = await Cooldown.find({ expiresAt: { $gt: new Date() } });
    
    // Build the embed
    const embed = new EmbedBuilder()
        .setTitle("⏳ Active Cooldowns")
        .setColor(0xffa500)
        .setTimestamp()
        .setAuthor({ name: "Pork Inc.", iconURL: "https://i.imgur.com/zOHrKyL.png" })
        .setFooter({ text: "Powered by Pork Inc.", iconURL: "https://i.imgur.com/zZHSvWF.jpeg" });

    // For each fixed list, add a field with active cooldowns.
    for (const { id, name } of FIXED_LISTS) {
        const listCooldowns = activeCooldowns.filter(cd => cd.listName === name);
        if (listCooldowns.length === 0) {
            embed.addFields({ name: `${id} - ${name}`, value: "None" });
        } else {
            // For each cooldown record, get the user's display name and format the expiration time as a Discord relative timestamp.
            const lines = await Promise.all(listCooldowns.map(async (cd) => {
                // We assume the bot is in one guild; otherwise, adjust accordingly.
                const guild = client.guilds.cache.first();
                const displayName = await getUserDisplayName(guild, cd.userId);
                const timestamp = Math.floor(cd.expiresAt.getTime() / 1000);
                return `${displayName} - <t:${timestamp}:R>`;
            }));
            embed.addFields({ name: `${id} - ${name}`, value: lines.join("\n") });
        }
    }

    const channel = client.channels.cache.get(cooldownChannelId);
    if (!channel) return console.error("Cooldown channel not found");

    // If we already have the message ID, try to fetch and edit it.
    if (cooldownEmbedMessageId) {
        try {
            const message = await channel.messages.fetch(cooldownEmbedMessageId);
            if (message) {
                await message.edit({ embeds: [embed] });
                return;
            }
        } catch (err) {
            // If fetching fails (message deleted, etc.), fall through to send a new one.
        }
    }
    
    // Otherwise, search recent messages for an existing cooldown embed from our bot.
    const fetchedMessages = await channel.messages.fetch({ limit: 50 });
    const botMessage = fetchedMessages.find(msg =>
        msg.author.id === client.user.id &&
        msg.embeds.length > 0 &&
        msg.embeds[0].title === "⏳ Active Cooldowns"
    );
    if (botMessage) {
        cooldownEmbedMessageId = botMessage.id;
        await botMessage.edit({ embeds: [embed] });
    } else {
        // Send a new message if none found.
        const newMsg = await channel.send({ embeds: [embed] });
        cooldownEmbedMessageId = newMsg.id;
    }
}

// Set up the client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions
    ]
});

client.once("ready", async () => {
    console.log(`✅ Bot is online as ${client.user.tag}!`);

    // Ensure all fixed lists exist in the database
    for (const { name } of FIXED_LISTS) {
        let list = await List.findOne({ name });
        if (!list) {
            list = new List({ name, users: [] });
            await list.save();
        }
    }
    // Update the cooldown embed once on startup
    await updateCooldownEmbed();
    // Then update it every 30 seconds
    setInterval(updateCooldownEmbed, 30000);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.content.startsWith("!list")) return;

    const args = message.content.slice(6).trim().split(" ");
    const command = args.shift()?.toLowerCase();
    const userId = message.author.id;

    // **Show all lists** using an embed
    if (!command) {
        const listsData = await List.find({});
        const embed = new EmbedBuilder()
            .setTitle("📜 Available Lists")
            .setColor(0x0099ff)
            .setTimestamp()
            .setAuthor({ name: "Pork Inc.", iconURL: "https://i.imgur.com/zOHrKyL.png" })
            .setFooter({ text: "Powered by Pork Inc.", iconURL: "https://i.imgur.com/zZHSvWF.jpeg" });

        for (const { id, name } of FIXED_LISTS) {
            const list = listsData.find(l => l.name === name) || { users: [] };
            const members = list.users.length > 0
                ? (await Promise.all(list.users.map(async (uid) => {
                    // Use nickname if available, otherwise username
                    return await getUserDisplayName(message.guild, uid);
                }))).join("\n")
                : "Empty";
            embed.addFields({ name: `${id} - ${name}`, value: members });
        }
        return message.reply({ embeds: [embed] });
    }

    // **Join a list**
    if (command === "join") {
        const listId = args[0];
        const listInfo = FIXED_LISTS.find(l => l.id === listId);
        if (!listInfo)
            return message.reply("❌ Invalid list number! Use `!list` to view available lists.");

        // Check if the user is on cooldown for this list
        const existingCooldown = await Cooldown.findOne({ userId, listName: listInfo.name });
        if (existingCooldown) {
            if (existingCooldown.expiresAt > new Date()) {
                const remainingTimeMs = existingCooldown.expiresAt - Date.now();
                return message.reply(`❌ You are on cooldown for **${listInfo.name}**. Please wait until <t:${Math.floor(existingCooldown.expiresAt.getTime()/1000)}:R> before joining again.`);
            } else {
                // Remove expired cooldown
                await Cooldown.deleteOne({ _id: existingCooldown._id });
            }
        }

        const list = await getList(listInfo.name);
        if (list.users.includes(userId))
            return message.reply("⚠️ You are already in this list!");

        list.users.push(userId);
        await list.save();
        message.reply(`✅ You have joined **${listInfo.name}**!`);
        // Update the cooldown embed (in case an expired cooldown was removed)
        await updateCooldownEmbed();
        return;
    }

    // **Leave a list**
    if (command === "leave") {
        const listId = args[0];
        const listInfo = FIXED_LISTS.find(l => l.id === listId);
        if (!listInfo)
            return message.reply("❌ Invalid list number! Use `!list` to view available lists.");

        const list = await getList(listInfo.name);
        if (!list.users.includes(userId))
            return message.reply("⚠️ You are not in this list!");

        list.users = list.users.filter(u => u !== userId);
        await list.save();
        message.reply(`✅ You have left **${listInfo.name}**.`);
        return;
    }

    // **Remove a user from a list (Admins only)**
    if (command === "remove") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
            return message.reply("❌ Only administrators can remove users!");

        const targetUser = message.mentions.users.first();
        const listId = args[1];
        const listInfo = FIXED_LISTS.find(l => l.id === listId);
        if (!targetUser || !listInfo)
            return message.reply("❌ Usage: `!list remove @user <list_number>`");

        const list = await getList(listInfo.name);
        if (!list.users.includes(targetUser.id))
            return message.reply("⚠️ That user is not in the list!");

        list.users = list.users.filter(u => u !== targetUser.id);
        await list.save();
        message.reply(`✅ ${await getUserDisplayName(message.guild, targetUser.id)} has been removed from **${listInfo.name}**.`);
        return;
    }

    // **Clear a list (Admins only)**
    if (command === "clear") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
            return message.reply("❌ Only administrators can clear lists!");

        const listId = args[0];
        const listInfo = FIXED_LISTS.find(l => l.id === listId);
        if (!listInfo)
            return message.reply("❌ Invalid list number! Use `!list` to view available lists.");

        const list = await getList(listInfo.name);
        list.users = [];
        await list.save();
        message.reply(`✅ The **${listInfo.name}** list has been cleared.`);
        return;
    }

    // **Confirm a user in a list (Admins only)**
    if (command === "confirm") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
            return message.reply("❌ Only administrators can confirm users!");

        const listId = args[0];
        const listInfo = FIXED_LISTS.find(l => l.id === listId);
        if (!listInfo)
            return message.reply("❌ Invalid list number! Use `!list` to view available lists.");

        const targetUser = message.mentions.users.first();
        if (!targetUser)
            return message.reply("❌ You must mention a user! Usage: `!list confirm <list_number> @player`");

        const list = await getList(listInfo.name);
        // Remove the user from the list if present
        if (list.users.includes(targetUser.id)) {
            list.users = list.users.filter(u => u !== targetUser.id);
            await list.save();
        }

        // Set the cooldown for the user based on the list's duration
        const cooldownDuration = listInfo.cooldown;
        const expiresAt = new Date(Date.now() + cooldownDuration);
        await Cooldown.findOneAndUpdate(
            { userId: targetUser.id, listName: listInfo.name },
            { expiresAt },
            { upsert: true }
        );
        message.reply(`✅ ${await getUserDisplayName(message.guild, targetUser.id)} has been confirmed for **${listInfo.name}** and is on cooldown until ${expiresAt.toLocaleString()}.`);
        // Update the cooldown embed after adding a cooldown.
        await updateCooldownEmbed();
        return;
    }

    // **Remove a user's cooldown for a list (Admins only)**
    if (command === "removecd") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
            return message.reply("❌ Only administrators can remove cooldowns!");

        const listId = args[0];
        const listInfo = FIXED_LISTS.find(l => l.id === listId);
        if (!listInfo)
            return message.reply("❌ Invalid list number! Use `!list` to view available lists.");

        const targetUser = message.mentions.users.first();
        if (!targetUser)
            return message.reply("❌ You must mention a user! Usage: `!list removecd <list_number> @user`");

        const cooldownRecord = await Cooldown.findOne({ userId: targetUser.id, listName: listInfo.name });
        if (!cooldownRecord) {
            return message.reply(`⚠️ ${await getUserDisplayName(message.guild, targetUser.id)} does not have a cooldown for **${listInfo.name}**.`);
        }

        await Cooldown.deleteOne({ _id: cooldownRecord._id });
        message.reply(`✅ Cooldown for ${await getUserDisplayName(message.guild, targetUser.id)} in **${listInfo.name}** has been removed.`);
        // Update the cooldown embed after removal.
        await updateCooldownEmbed();
        return;
    }
});

// Event when a user reacts to a message (for translation)
client.on("messageReactionAdd", async (reaction, user) => {
    if (user.bot) return; // Ignore bot reactions

    const { message, emoji } = reaction;

    // Check if the emoji is a recognized flag
    if (flagToLang[emoji.name]) {
        const targetLang = flagToLang[emoji.name];

        try {
            const result = await translate(message.content, { to: targetLang });
            await message.reply(`🌍 **${user}, your translation (${emoji.name}):**\n${result.text}`);
        } catch (error) {
            console.error(error);
            await message.reply(`❌ ${user}, an error occurred while translating. Please try again.`);
        }
    }
});

// Log in to Discord
client.login(process.env.TOKEN);

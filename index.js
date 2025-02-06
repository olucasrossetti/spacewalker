require('dotenv').config();
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const mongoose = require('mongoose');
const translate = require('google-translate-api-x');

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

// Fixed lists with cooldown times (in milliseconds)
// Lists 5 and 6 have a cooldown of 1 month, the rest have a cooldown of 1 week
const FIXED_LISTS = [
    { id: "1", name: "Crystal of Chaos", cooldown: 7 * 24 * 60 * 60 * 1000 }, // 1 week
    { id: "2", name: "Feather of Condor", cooldown: 7 * 24 * 60 * 60 * 1000 },
    { id: "3", name: "Jewel of Creation", cooldown: 7 * 24 * 60 * 60 * 1000 },
    { id: "4", name: "Condor's Flame", cooldown: 7 * 24 * 60 * 60 * 1000 },
    { id: "5", name: "Chest for 1st Place", cooldown: 30 * 24 * 60 * 60 * 1000 }, // 1 month
    { id: "6", name: "Archangel Chest", cooldown: 30 * 24 * 60 * 60 * 1000 },  // 1 month
    { id: "7", name: "Awakening Jewel", cooldown: 30 * 24 * 60 * 60 * 1000 },    // 1 month
];

// Define Schema for lists (storing the users that have joined)
const listSchema = new mongoose.Schema({
    name: String,
    users: [String] // Stores user IDs
});
const List = mongoose.model("List", listSchema);

// New Schema for storing user cooldowns per list
const cooldownSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    listName: { type: String, required: true },
    expiresAt: { type: Date, required: true }
});
const Cooldown = mongoose.model("Cooldown", cooldownSchema);

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
});

// Function to get or create a list
async function getList(name) {
    let list = await List.findOne({ name });
    if (!list) {
        list = new List({ name, users: [] });
        await list.save();
    }
    return list;
}

// Function to get a user's display name (nickname or username)
async function getUserDisplayName(guild, userId) {
    try {
        const member = await guild.members.fetch(userId);
        return member.nickname || member.user.username;
    } catch (error) {
        console.error(`⚠️ Error fetching user ${userId}:`, error);
        return "Unknown User";
    }
}

// Function to format a duration (ms) in a human-readable format
function formatDuration(ms) {
    let seconds = Math.floor(ms / 1000);
    const days = Math.floor(seconds / (3600 * 24));
    seconds %= 3600 * 24;
    const hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    const minutes = Math.floor(seconds / 60);
    seconds %= 60;
    const parts = [];
    if (days) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
    if (hours) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
    if (minutes) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
    if (seconds) parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);
    return parts.join(', ');
}

// Mapping of flag emojis to language codes
const flagToLang = {
    "🇺🇸": "en",
    "🇬🇧": "en",
    "🇪🇸": "es",
    "🇦🇷": "es",
    "🇲🇽": "es",
    "🇨🇴": "es",
    "🇨🇱": "es",
    "🇵🇪": "es",
    "🇻🇪": "es",
    "🇪🇨": "es",
    "🇺🇾": "es",
    "🇬🇹": "es",
    "🇩🇴": "es",
    "🇵🇷": "es",
    "🇧🇴": "es",
    "🇸🇻": "es",
    "🇭🇳": "es",
    "🇳🇮": "es",
    "🇵🇦": "es",
    "🇨🇷": "es",
    "🇨🇺": "es",
    "🇵🇾": "es",
    "🇵🇹": "pt",
    "🇧🇷": "pt",
    "🇫🇷": "fr",
    "🇩🇪": "de",
    "🇮🇹": "it",
    "🇯🇵": "ja",
    "🇨🇳": "zh-cn",
    "🇷🇺": "ru"
};

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.content.startsWith("!list")) return;

    const args = message.content.slice(6).trim().split(" ");
    const command = args.shift()?.toLowerCase();
    const userId = message.author.id;

    // **Show all lists**
    if (!command) {
        const lists = await List.find({});
        let response = "📜 **Available Lists:**\n\n";

        for (const { id, name } of FIXED_LISTS) {
            const list = lists.find(l => l.name === name) || { users: [] };
            const members = list.users.length > 0 
                ? (await Promise.all(list.users.map(uid => getUserDisplayName(message.guild, uid)))).join("\n") 
                : "Empty";
            response += `**${id} - ${name}**\n\`\`\`\n${members}\n\`\`\`\n`;
        }

        return message.reply(response);
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
                return message.reply(`❌ You are on cooldown for **${listInfo.name}**. Please wait ${formatDuration(remainingTimeMs)} before joining again.`);
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
        return message.reply(`✅ You have joined **${listInfo.name}**!`);
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
        return message.reply(`✅ You have left **${listInfo.name}**.`);
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
        return message.reply(`✅ ${await getUserDisplayName(message.guild, targetUser.id)} has been removed from **${listInfo.name}**.`);
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

        return message.reply(`✅ The **${listInfo.name}** list has been cleared.`);
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

        return message.reply(`✅ ${await getUserDisplayName(message.guild, targetUser.id)} has been confirmed for **${listInfo.name}** and is on cooldown until ${expiresAt.toLocaleString()}.`);
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
        return message.reply(`✅ Cooldown for ${await getUserDisplayName(message.guild, targetUser.id)} in **${listInfo.name}** has been removed.`);
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

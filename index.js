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

// Fixed lists with IDs
const FIXED_LISTS = [
    { id: "1", name: "Crystal of Chaos" },
    { id: "2", name: "Feather of Condor" },
    { id: "3", name: "Jewel of Creation" }
];

// Define Schema FIRST
const listSchema = new mongoose.Schema({
    name: String,
    users: [String] // Stores user IDs
});

// Define Model AFTER Schema
const List = mongoose.model("List", listSchema);

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

// Function to get a user's nickname (or username if no nickname)
async function getUserDisplayName(guild, userId) {
    try {
        const member = await guild.members.fetch(userId);
        return member.nickname || member.user.username;
    } catch (error) {
        console.error(`⚠️ Error fetching user ${userId}:`, error);
        return "Unknown User"; // If the user can't be found, return a placeholder
    }
}

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
            response += `**${id}️⃣ - ${name}**\n\`\`\`\n${members}\n\`\`\`\n`;
        }

        return message.reply(response);
    }

    // **Join a list by number**
    if (command === "join") {
        const listId = args[0];
        const listInfo = FIXED_LISTS.find(l => l.id === listId);
        if (!listInfo) return message.reply("❌ Invalid list number! Use `!list` to see available lists.");

        const list = await getList(listInfo.name);
        if (list.users.includes(userId)) return message.reply("⚠️ You are already in this list!");

        list.users.push(userId);
        await list.save();
        return message.reply(`✅ You have joined **${listInfo.name}**!`);
    }

    // **Leave a list by number**
    if (command === "leave") {
        const listId = args[0];
        const listInfo = FIXED_LISTS.find(l => l.id === listId);
        if (!listInfo) return message.reply("❌ Invalid list number! Use `!list` to see available lists.");

        const list = await getList(listInfo.name);
        if (!list.users.includes(userId)) return message.reply("⚠️ You are not in this list!");

        list.users = list.users.filter(u => u !== userId);
        await list.save();
        return message.reply(`✅ You have left **${listInfo.name}**.`);
    }

    // **Remove a user from a list (Admins only)**
    if (command === "remove") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("❌ Only administrators can remove users!");

        const targetUser = message.mentions.users.first();
        const listId = args[1];
        const listInfo = FIXED_LISTS.find(l => l.id === listId);
        if (!targetUser || !listInfo) return message.reply("❌ Usage: `!list remove @user <list_number>`");

        const list = await getList(listInfo.name);
        if (!list.users.includes(targetUser.id)) return message.reply("⚠️ This user is not in the list!");

        list.users = list.users.filter(u => u !== targetUser.id);
        await list.save();
        return message.reply(`✅ ${await getUserDisplayName(message.guild, targetUser.id)} has been removed from **${listInfo.name}**.`);
    }

    // **Clear a list by number (Admins only)**
    if (command === "clear") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("❌ Only administrators can clear lists!");

        const listId = args[0];
        const listInfo = FIXED_LISTS.find(l => l.id === listId);
        if (!listInfo) return message.reply("❌ Invalid list number! Use `!list` to see available lists.");

        const list = await getList(listInfo.name);
        list.users = [];
        await list.save();

        return message.reply(`✅ The **${listInfo.name}** list has been cleared.`);
    }
});

// Mapeamento de emojis de bandeiras para códigos
const flagToLang = {
    "🇺🇸": "en", // Inglês (EUA)
    "🇬🇧": "en", // Inglês (UK)
    "🇪🇸": "es", // Espanhol (Espanha)
    "🇦🇷": "es", // Espanhol (Argentina)
    "🇲🇽": "es", // Espanhol (México)
    "🇨🇴": "es", // Espanhol (Colômbia)
    "🇨🇱": "es", // Espanhol (Chile)
    "🇵🇪": "es", // Espanhol (Peru)
    "🇻🇪": "es", // Espanhol (Venezuela)
    "🇪🇨": "es", // Espanhol (Equador)
    "🇺🇾": "es", // Espanhol (Uruguai)
    "🇬🇹": "es", // Espanhol (Guatemala)
    "🇩🇴": "es", // Espanhol (República Dominicana)
    "🇵🇷": "es", // Espanhol (Porto Rico)
    "🇧🇴": "es", // Espanhol (Bolívia)
    "🇸🇻": "es", // Espanhol (El Salvador)
    "🇭🇳": "es", // Espanhol (Honduras)
    "🇳🇮": "es", // Espanhol (Nicarágua)
    "🇵🇦": "es", // Espanhol (Panamá)
    "🇨🇷": "es", // Espanhol (Costa Rica)
    "🇨🇺": "es", // Espanhol (Cuba)
    "🇵🇾": "es", // Espanhol (Paraguai)
    "🇵🇹": "pt", // Português (Portugal)
    "🇧🇷": "pt", // Português (Brasil)
    "🇫🇷": "fr", // Francês
    "🇩🇪": "de", // Alemão.
    "🇮🇹": "it", // Italiano
    "🇯🇵": "ja", // Japonês
    "🇨🇳": "zh-cn", // Chinês simplificado
    "🇷🇺": "ru"  // Russo 
};

// Evento quando um usuário reage a uma mensagem
client.on("messageReactionAdd", async (reaction, user) => {
    if (user.bot) return; // Ignora reações de outros bots

    const { message, emoji } = reaction;

    // Verifica se o emoji é uma bandeira reconhecida
    if (flagToLang[emoji.name]) {
        const targetLang = flagToLang[emoji.name];

        try {
            const result = await translate(message.content, { to: targetLang });
            await message.reply(`🌍 **${user}, your translation request to ${emoji.name}:**\n${result.text}`);
        } catch (error) {
            console.error(error);
            await message.reply(`❌ ${user}, erro ao traduzir. Tente novamente.`);
        }
    }
});

// Log in to Discord
client.login(process.env.TOKEN);

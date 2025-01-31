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

// Fixed list names (Always visible)
const FIXED_LISTS = ["Cristal of Chaos", "Feather of Condor", "Jewel of Creation"];

// Define the Schema FIRST
const listSchema = new mongoose.Schema({
    name: String,
    users: [String] // Store user IDs
});

// Now define the Model AFTER the Schema
const List = mongoose.model("List", listSchema);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once("ready", async () => {
    console.log(`✅ Bot is online as ${client.user.tag}!`);

    // Ensure all fixed lists exist in the database
    for (const listName of FIXED_LISTS) {
        let list = await List.findOne({ name: listName });
        if (!list) {
            list = new List({ name: listName, users: [] });
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

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.content.startsWith("!list")) return;

    const args = message.content.slice(6).trim().split(" ");
    const command = args.shift()?.toLowerCase();
    const userId = message.author.id;

    // **Show all lists**
    if (!command) {
        const lists = await List.find({});
        let response = "📜 **Available Lists:**\n\n";

        for (const listName of FIXED_LISTS) {
            const list = lists.find(l => l.name === listName) || { users: [] };
            const members = list.users.length > 0 ? list.users.map(id => `- ${id}`).join("\n") : "Empty";
            response += `**${listName}**\n\`\`\`\n${members}\n\`\`\`\n`;
        }

        return message.reply(response);
    }

    // **Join a list**
    if (command === "join") {
        const listName = args.join(" ");
        if (!FIXED_LISTS.includes(listName)) return message.reply("❌ List not found! Use one of the available lists.");

        const list = await getList(listName);
        if (list.users.includes(userId)) return message.reply("⚠️ You are already in this list!");

        list.users.push(userId);
        await list.save();
        return message.reply(`✅ You have joined **${listName}**!`);
    }

    // **Leave a list**
    if (command === "leave") {
        const listName = args.join(" ");
        if (!FIXED_LISTS.includes(listName)) return message.reply("❌ List not found!");

        const list = await getList(listName);
        if (!list.users.includes(userId)) return message.reply("⚠️ You are not in this list!");

        list.users = list.users.filter(u => u !== userId);
        await list.save();
        return message.reply(`✅ You have left **${listName}**.`);
    }

    // **Remove a user (Admins only)**
    if (command === "remove") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("❌ Only administrators can remove users!");

        const targetUser = message.mentions.users.first();
        const listName = args.slice(1).join(" ");
        if (!targetUser || !FIXED_LISTS.includes(listName)) return message.reply("❌ Usage: `!list remove @user <list>`");

        const list = await getList(listName);
        if (!list.users.includes(targetUser.id)) return message.reply("⚠️ This user is not in the list!");

        list.users = list.users.filter(u => u !== targetUser.id);
        await list.save();
        return message.reply(`✅ <@${targetUser.id}> has been removed from **${listName}**.`);
    }

    // **Clear a list (Admins only)**
    if (command === "clear") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("❌ Only administrators can clear lists!");

        const listName = args.join(" ");
        if (!FIXED_LISTS.includes(listName)) return message.reply("❌ List not found!");

        const list = await getList(listName);
        list.users = [];
        await list.save();

        return message.reply(`✅ The **${listName}** list has been cleared.`);
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

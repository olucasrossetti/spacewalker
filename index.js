require('dotenv').config();
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const mongoose = require('mongoose');
const translate = require('google-translate-api-x');

// Conecta ao MongoDB
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

// Atualizamos a lista fixa para incluir a duração do cooldown (em milissegundos)
const FIXED_LISTS = [
    { id: "1", name: "Crystal of Chaos", cooldown: 7 * 24 * 60 * 60 * 1000 }, // 1 semana
    { id: "2", name: "Feather of Condor", cooldown: 7 * 24 * 60 * 60 * 1000 },
    { id: "3", name: "Jewel of Creation", cooldown: 7 * 24 * 60 * 60 * 1000 },
    { id: "4", name: "Condor's Flame", cooldown: 7 * 24 * 60 * 60 * 1000 },
    { id: "5", name: "Chest for 1st Place", cooldown: 30 * 24 * 60 * 60 * 1000 }, // 1 mês
    { id: "6", name: "Archangel Chest", cooldown: 30 * 24 * 60 * 60 * 1000 },      // 1 mês
];

// Schema para as listas (armazenando os usuários que entraram)
const listSchema = new mongoose.Schema({
    name: String,
    users: [String] // Armazena IDs de usuários
});
const List = mongoose.model("List", listSchema);

// Novo Schema para armazenar o cooldown de cada usuário por lista
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

    // Garante que todas as listas fixas existam no banco de dados
    for (const { name } of FIXED_LISTS) {
        let list = await List.findOne({ name });
        if (!list) {
            list = new List({ name, users: [] });
            await list.save();
        }
    }
});

// Função para obter ou criar uma lista
async function getList(name) {
    let list = await List.findOne({ name });
    if (!list) {
        list = new List({ name, users: [] });
        await list.save();
    }
    return list;
}

// Função para obter o nome de exibição do usuário (nickname ou username)
async function getUserDisplayName(guild, userId) {
    try {
        const member = await guild.members.fetch(userId);
        return member.nickname || member.user.username;
    } catch (error) {
        console.error(`⚠️ Error fetching user ${userId}:`, error);
        return "Unknown User";
    }
}

// Função para formatar duração (ms) em um formato legível
function formatDuration(ms) {
    let seconds = Math.floor(ms / 1000);
    const days = Math.floor(seconds / (3600 * 24));
    seconds %= 3600 * 24;
    const hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    const minutes = Math.floor(seconds / 60);
    seconds %= 60;
    const parts = [];
    if (days) parts.push(`${days} dia${days !== 1 ? 's' : ''}`);
    if (hours) parts.push(`${hours} hora${hours !== 1 ? 's' : ''}`);
    if (minutes) parts.push(`${minutes} minuto${minutes !== 1 ? 's' : ''}`);
    if (seconds) parts.push(`${seconds} segundo${seconds !== 1 ? 's' : ''}`);
    return parts.join(', ');
}

// Mapeamento de emojis de bandeiras para códigos de idiomas
const flagToLang = {
    "🇺🇸": "en", // Inglês (EUA)
    "🇬🇧": "en", // Inglês (UK)
    "🇪🇸": "es", // Espanhol
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

    // **Exibir todas as listas**
    if (!command) {
        const lists = await List.find({});
        let response = "📜 **Listas Disponíveis:**\n\n";

        for (const { id, name } of FIXED_LISTS) {
            const list = lists.find(l => l.name === name) || { users: [] };
            const members = list.users.length > 0 
                ? (await Promise.all(list.users.map(uid => getUserDisplayName(message.guild, uid)))).join("\n") 
                : "Empty";
            response += `**${id}️⃣ - ${name}**\n\`\`\`\n${members}\n\`\`\`\n`;
        }

        return message.reply(response);
    }

    // **Entrar em uma lista**
    if (command === "join") {
        const listId = args[0];
        const listInfo = FIXED_LISTS.find(l => l.id === listId);
        if (!listInfo) 
            return message.reply("❌ Número de lista inválido! Use `!list` para ver as listas disponíveis.");

        // Verifica se o usuário está em cooldown para essa lista
        const existingCooldown = await Cooldown.findOne({ userId, listName: listInfo.name });
        if (existingCooldown) {
            if (existingCooldown.expiresAt > new Date()) {
                const remainingTimeMs = existingCooldown.expiresAt - Date.now();
                return message.reply(`❌ Você está em cooldown para **${listInfo.name}**. Aguarde ${formatDuration(remainingTimeMs)} antes de entrar novamente.`);
            } else {
                // Se o cooldown já expirou, remove-o
                await Cooldown.deleteOne({ _id: existingCooldown._id });
            }
        }

        const list = await getList(listInfo.name);
        if (list.users.includes(userId)) 
            return message.reply("⚠️ Você já está nessa lista!");

        list.users.push(userId);
        await list.save();
        return message.reply(`✅ Você entrou na **${listInfo.name}**!`);
    }

    // **Sair de uma lista**
    if (command === "leave") {
        const listId = args[0];
        const listInfo = FIXED_LISTS.find(l => l.id === listId);
        if (!listInfo) 
            return message.reply("❌ Número de lista inválido! Use `!list` para ver as listas disponíveis.");

        const list = await getList(listInfo.name);
        if (!list.users.includes(userId)) 
            return message.reply("⚠️ Você não está nessa lista!");

        list.users = list.users.filter(u => u !== userId);
        await list.save();
        return message.reply(`✅ Você saiu da **${listInfo.name}**.`);
    }

    // **Remover um usuário de uma lista (Apenas Admins)**
    if (command === "remove") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) 
            return message.reply("❌ Apenas administradores podem remover usuários!");

        const targetUser = message.mentions.users.first();
        const listId = args[1];
        const listInfo = FIXED_LISTS.find(l => l.id === listId);
        if (!targetUser || !listInfo) 
            return message.reply("❌ Uso: `!list remove @user <número_da_lista>`");

        const list = await getList(listInfo.name);
        if (!list.users.includes(targetUser.id)) 
            return message.reply("⚠️ Esse usuário não está na lista!");

        list.users = list.users.filter(u => u !== targetUser.id);
        await list.save();
        return message.reply(`✅ ${await getUserDisplayName(message.guild, targetUser.id)} foi removido(a) da **${listInfo.name}**.`);
    }

    // **Limpar uma lista (Apenas Admins)**
    if (command === "clear") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) 
            return message.reply("❌ Apenas administradores podem limpar as listas!");

        const listId = args[0];
        const listInfo = FIXED_LISTS.find(l => l.id === listId);
        if (!listInfo) 
            return message.reply("❌ Número de lista inválido! Use `!list` para ver as listas disponíveis.");

        const list = await getList(listInfo.name);
        list.users = [];
        await list.save();

        return message.reply(`✅ A lista **${listInfo.name}** foi limpa.`);
    }

    // **Confirmar um usuário na lista (Apenas Admins)**
    if (command === "confirm") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) 
            return message.reply("❌ Apenas administradores podem confirmar usuários!");

        const listId = args[0];
        const listInfo = FIXED_LISTS.find(l => l.id === listId);
        if (!listInfo) 
            return message.reply("❌ Número de lista inválido! Use `!list` para ver as listas disponíveis.");

        const targetUser = message.mentions.users.first();
        if (!targetUser) 
            return message.reply("❌ Você precisa mencionar um usuário! Uso: `!list confirm <número_da_lista> @player`");

        const list = await getList(listInfo.name);
        // Remove o usuário da lista, se estiver presente
        if (list.users.includes(targetUser.id)) {
            list.users = list.users.filter(u => u !== targetUser.id);
            await list.save();
        }

        // Define o cooldown para o usuário conforme a duração especificada na lista
        const cooldownDuration = listInfo.cooldown;
        const expiresAt = new Date(Date.now() + cooldownDuration);

        await Cooldown.findOneAndUpdate(
            { userId: targetUser.id, listName: listInfo.name },
            { expiresAt },
            { upsert: true }
        );

        return message.reply(`✅ ${await getUserDisplayName(message.guild, targetUser.id)} foi confirmado(a) para **${listInfo.name}** e ficará em cooldown até ${expiresAt.toLocaleString()}.`);
    }
});

// Evento quando um usuário reage a uma mensagem (para tradução)
client.on("messageReactionAdd", async (reaction, user) => {
    if (user.bot) return; // Ignora reações de bots

    const { message, emoji } = reaction;

    // Verifica se o emoji é uma bandeira reconhecida
    if (flagToLang[emoji.name]) {
        const targetLang = flagToLang[emoji.name];

        try {
            const result = await translate(message.content, { to: targetLang });
            await message.reply(`🌍 **${user}, sua tradução para ${emoji.name}:**\n${result.text}`);
        } catch (error) {
            console.error(error);
            await message.reply(`❌ ${user}, erro ao traduzir. Tente novamente.`);
        }
    }
});

// Loga o bot no Discord
client.login(process.env.TOKEN);

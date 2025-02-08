require('dotenv').config();
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');
const translate = require('google-translate-api-x');

// Conecta ao MongoDB
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log("✅ Connected to MongoDB"))
.catch(err => console.error("❌ MongoDB Connection Error:", err));

// Listas fixas com cooldown (em milissegundos)
// As listas 5, 6 e 7 têm cooldown de 1 mês; as demais, de 1 semana
const FIXED_LISTS = [
    { id: "1", name: "Crystal of Chaos", cooldown: 7 * 24 * 60 * 60 * 1000 },
    { id: "2", name: "Feather of Condor", cooldown: 7 * 24 * 60 * 60 * 1000 },
    { id: "3", name: "Jewel of Creation", cooldown: 7 * 24 * 60 * 60 * 1000 },
    { id: "4", name: "Condor's Flame", cooldown: 7 * 24 * 60 * 60 * 1000 },
    { id: "5", name: "Chest for 1st Place", cooldown: 30 * 24 * 60 * 60 * 1000 },
    { id: "6", name: "Archangel Chest", cooldown: 30 * 24 * 60 * 60 * 1000 },
    { id: "7", name: "Awakening Jewel", cooldown: 30 * 24 * 60 * 60 * 1000 }
];

// Schema para as listas (armazenando os usuários que se juntaram)
const listSchema = new mongoose.Schema({
    name: String,
    users: [String] // Armazena IDs dos usuários
});
const List = mongoose.model("List", listSchema);

// Schema para armazenar os cooldowns por usuário em cada lista
const cooldownSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    listName: { type: String, required: true },
    expiresAt: { type: Date, required: true }
});
const Cooldown = mongoose.model("Cooldown", cooldownSchema);

// Variáveis globais para o embed de cooldown no canal fixo
const cooldownChannelId = "1337519002741641306";
let cooldownEmbedMessageId = null;

// Função para obter ou criar uma lista
async function getList(name) {
    let list = await List.findOne({ name });
    if (!list) {
        list = new List({ name, users: [] });
        await list.save();
    }
    return list;
}

// Função para obter o nome de exibição do usuário (nickname se disponível, senão username)
async function getUserDisplayName(guild, userId) {
    try {
        const member = await guild.members.fetch(userId);
        return member.nickname || member.user.username;
    } catch (error) {
        console.error(`⚠️ Error fetching user ${userId}:`, error);
        return "Unknown User";
    }
}

// Atualiza o embed de cooldowns no canal fixo
async function updateCooldownEmbed() {
    const activeCooldowns = await Cooldown.find({ expiresAt: { $gt: new Date() } });

    const embed = new EmbedBuilder()
        .setTitle("⏳ Active Cooldowns")
        .setColor(0xffa500)
        .setTimestamp()
        .setFooter({ text: "Powered by Pork Inc.", iconURL: "https://i.imgur.com/zZHSvWF.jpeg" });

    for (const { id, name } of FIXED_LISTS) {
        const listCooldowns = activeCooldowns.filter(cd => cd.listName === name);
        if (listCooldowns.length === 0) {
            embed.addFields({ name: `${id} - ${name}`, value: "None" });
        } else {
            const lines = listCooldowns.map(cd => `<@${cd.userId}> - <t:${Math.floor(cd.expiresAt.getTime() / 1000)}:R>`);
            embed.addFields({ name: `${id} - ${name}`, value: lines.join("\n") });
        }
    }

    const channel = client.channels.cache.get(cooldownChannelId);
    if (!channel) return console.error("Cooldown channel not found");

    if (cooldownEmbedMessageId) {
        try {
            const message = await channel.messages.fetch(cooldownEmbedMessageId);
            if (message) {
                await message.edit({ embeds: [embed] });
                return;
            }
        } catch (err) {
            console.error("Error fetching/editing cooldown embed message:", err);
        }
    }

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
        const newMsg = await channel.send({ embeds: [embed] });
        cooldownEmbedMessageId = newMsg.id;
    }
}

// Verifica os cooldowns ativos e remove o usuário da lista, se necessário
async function enforceCooldowns() {
    console.log("🔄 Verificando cooldowns ativos...");
    const activeCooldowns = await Cooldown.find({ expiresAt: { $gt: new Date() } });
    for (const cooldown of activeCooldowns) {
        // Remove o usuário da lista, se presente
        await List.findOneAndUpdate(
            { name: cooldown.listName },
            { $pull: { users: cooldown.userId } }
        );
        console.log(`🚨 Usuário ${cooldown.userId} removido da lista ${cooldown.listName} (cooldown ativo)`);
    }
    await updateCooldownEmbed();
}

// Configura o client do Discord
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
    
    // Atualiza imediatamente os cooldowns e o embed na inicialização
    await enforceCooldowns();
    
    // Atualiza o embed de cooldown a cada 30 segundos
    setInterval(updateCooldownEmbed, 30000);
    // Verifica os cooldowns e remove usuários a cada 1 minuto
    setInterval(enforceCooldowns, 60000);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.content.startsWith("!list")) return;

    const args = message.content.slice(6).trim().split(" ");
    const command = args.shift()?.toLowerCase();
    const userId = message.author.id;

    // Comando para mostrar todas as listas em um embed
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
                ? (await Promise.all(list.users.map(async (uid) => await getUserDisplayName(message.guild, uid)))).join("\n")
                : "Empty";
            embed.addFields({ name: `${id} - ${name}`, value: members });
        }
        return message.reply({ embeds: [embed] });
    }

    // Comando para juntar-se a uma lista
    if (command === "join") {
        const listId = args[0];
        const listInfo = FIXED_LISTS.find(l => l.id === listId);
        if (!listInfo)
            return message.reply("❌ Invalid list number! Use `!list` to see available lists.");

        // Verifica se o usuário está com cooldown para essa lista
        const existingCooldown = await Cooldown.findOne({ userId, listName: listInfo.name });
        if (existingCooldown) {
            if (existingCooldown.expiresAt > new Date()) {
                return message.reply(`❌ You are on cooldown for **${listInfo.name}**. Wait until <t:${Math.floor(existingCooldown.expiresAt.getTime()/1000)}:R> to join again.`);
            } else {
                // Remove o cooldown expirado
                await Cooldown.deleteOne({ _id: existingCooldown._id });
            }
        }

        const list = await getList(listInfo.name);
        if (list.users.includes(userId))
            return message.reply("⚠️ You are already on this list!");

        list.users.push(userId);
        await list.save();
        message.reply(`✅ You have entered **${listInfo.name}**!`);
        await updateCooldownEmbed();
        return;
    }

    // Comando para sair de uma lista
    if (command === "leave") {
        const listId = args[0];
        const listInfo = FIXED_LISTS.find(l => l.id === listId);
        if (!listInfo)
            return message.reply("❌ Invalid list number! Use `!list` to see available lists.");

        const list = await getList(listInfo.name);
        if (!list.users.includes(userId))
            return message.reply("⚠️ You are not on this list!");

        list.users = list.users.filter(u => u !== userId);
        await list.save();
        message.reply(`✅ You left **${listInfo.name}**.`);
        return;
    }

    // Comando para remover um usuário de uma lista (Apenas Admins)
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
            return message.reply("⚠️ This user is not on the list!");

        list.users = list.users.filter(u => u !== targetUser.id);
        await list.save();
        message.reply(`✅ ${await getUserDisplayName(message.guild, targetUser.id)} has been removed from **${listInfo.name}**.`);
        return;
    }

    // Comando para limpar uma lista (Apenas Admins)
    if (command === "clear") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
            return message.reply("❌ Only administrators can clear lists!");

        const listId = args[0];
        const listInfo = FIXED_LISTS.find(l => l.id === listId);
        if (!listInfo)
            return message.reply("❌ Invalid list number! Use `!list` to see available lists.");

        const list = await getList(listInfo.name);
        list.users = [];
        await list.save();
        message.reply(`✅ The list **${listInfo.name}** has been cleaned.`);
        return;
    }

    // Comando para confirmar um usuário (Apenas Admins)
    if (command === "confirm") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
            return message.reply("❌ Only administrators can confirm users!");

        const listId = args[0];
        const listInfo = FIXED_LISTS.find(l => l.id === listId);
        if (!listInfo)
            return message.reply("❌ Invalid list number! Use `!list` to see available lists.");

        const targetUser = message.mentions.users.first();
        if (!targetUser)
            return message.reply("❌ You must mention a user! Usage: `!list confirm <list_number> @player`");

        // Remove o usuário da lista utilizando $pull
        await List.findOneAndUpdate(
            { name: listInfo.name },
            { $pull: { users: targetUser.id } }
        );
        
        // Define o cooldown para o usuário conforme a duração da lista
        const cooldownDuration = listInfo.cooldown;
        const expiresAt = new Date(Date.now() + cooldownDuration);
        await Cooldown.findOneAndUpdate(
            { userId: targetUser.id, listName: listInfo.name },
            { expiresAt },
            { upsert: true }
        );
        message.reply(`✅ ${await getUserDisplayName(message.guild, targetUser.id)} has been committed to **${listInfo.name}** and is on cooldown until ${expiresAt.toLocaleString()}.`);
        // Chama enforceCooldowns para atualizar imediatamente a remoção do usuário da lista e o embed
        await enforceCooldowns();
        return;
    }

    // Comando para remover o cooldown de um usuário (Apenas Admins)
    if (command === "removecd") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
            return message.reply("❌ Only administrators can remove cooldowns!");

        const listId = args[0];
        const listInfo = FIXED_LISTS.find(l => l.id === listId);
        if (!listInfo)
            return message.reply("❌ Invalid list number! Use `!list` to see available lists.");

        const targetUser = message.mentions.users.first();
        if (!targetUser)
            return message.reply("❌ You must mention a user! Usage: `!list removecd <list_number> @user`");

        const cooldownRecord = await Cooldown.findOne({ userId: targetUser.id, listName: listInfo.name });
        if (!cooldownRecord)
            return message.reply(`⚠️ ${await getUserDisplayName(message.guild, targetUser.id)} has no cooldown on **${listInfo.name}**.`);

        await Cooldown.deleteOne({ _id: cooldownRecord._id });
        message.reply(`✅ The cooldown of ${await getUserDisplayName(message.guild, targetUser.id)} on **${listInfo.name}** has been removed.`);
        await updateCooldownEmbed();
        return;
    }
});

// Mapeamento de emojis de bandeira para códigos de idioma (para tradução)
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
    "🇷🇺": "ru",
    "🇺🇲": "en"
};

// Evento para tradução ao reagir com uma bandeira
client.on("messageReactionAdd", async (reaction, user) => {
    if (user.bot) return;

    const { message, emoji } = reaction;

    if (flagToLang[emoji.name]) {
        const targetLang = flagToLang[emoji.name];
        try {
            const result = await translate(message.content, { to: targetLang });
            await message.reply(`🌍 **${user}, its translation (${emoji.name}):**\n${result.text}`);
        } catch (error) {
            console.error(error);
            await message.reply(`❌ ${user}, a translation error occurred. Please try again.`);
        }
    }
});

// Loga no Discord
client.login(process.env.TOKEN);

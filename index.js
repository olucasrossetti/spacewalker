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
// Listas 5, 6 e 7 têm cooldown de 1 mês; as demais, de 1 semana
const FIXED_LISTS = [
    { id: "1", name: "Crystal of Chaos", cooldown: 7 * 24 * 60 * 60 * 1000 }, // 1 semana
    { id: "2", name: "Feather of Condor", cooldown: 7 * 24 * 60 * 60 * 1000 },
    { id: "3", name: "Jewel of Creation", cooldown: 7 * 24 * 60 * 60 * 1000 },
    { id: "4", name: "Condor's Flame", cooldown: 7 * 24 * 60 * 60 * 1000 },
    { id: "5", name: "Chest for 1st Place", cooldown: 30 * 24 * 60 * 60 * 1000 }, // 1 mês
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

// Remove usuários das listas caso estejam com cooldown ativo
async function enforceCooldowns() {
    console.log("🔄 Verificando cooldowns ativos...");

    const activeCooldowns = await Cooldown.find({ expiresAt: { $gt: new Date() } });

    for (const cooldown of activeCooldowns) {
        // Usando $pull para remover o usuário da lista, se presente
        await List.findOneAndUpdate(
            { name: cooldown.listName },
            { $pull: { users: cooldown.userId } }
        );
        console.log(`🚨 Verificado cooldown para usuário ${cooldown.userId} na lista ${cooldown.listName}`);
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
    // Atualiza o embed de cooldown uma vez no startup
    await updateCooldownEmbed();
    // Agenda a atualização do embed a cada 30 segundos
    setInterval(updateCooldownEmbed, 30000);
    // Agenda a verificação dos cooldowns (e remoção dos usuários) a cada 1 minuto
    setInterval(enforceCooldowns, 60000);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.content.startsWith("!list")) return;

    const args = message.content.slice(6).trim().split(" ");
    const command = args.shift()?.toLowerCase();
    const userId = message.author.id;

    // **Mostrar todas as listas** usando um embed
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

        // Verifica se o usuário está com cooldown para essa lista
        const existingCooldown = await Cooldown.findOne({ userId, listName: listInfo.name });
        if (existingCooldown) {
            if (existingCooldown.expiresAt > new Date()) {
                return message.reply(`❌ You are on cooldown for **${listInfo.name}**. Please wait until <t:${Math.floor(existingCooldown.expiresAt.getTime()/1000)}:R> before joining again.`);
            } else {
                // Remove o cooldown expirado
                await Cooldown.deleteOne({ _id: existingCooldown._id });
            }
        }

        const list = await getList(listInfo.name);
        if (list.users.includes(userId))
            return message.reply("⚠️ You are already in this list!");

        list.users.push(userId);
        await list.save();
        message.reply(`✅ You have joined **${listInfo.name}**!`);
        // Atualiza o embed de cooldown (caso algum cooldown expirado tenha sido removido)
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

        // Remove o usuário da lista usando $pull
        await List.findOneAndUpdate(
            { name: listInfo.name },
            { $pull: { users: targetUser.id } }
        );
        
        // Define o cooldown para o usuário baseado na duração da lista
        const cooldownDuration = listInfo.cooldown;
        const expiresAt = new Date(Date.now() + cooldownDuration);
        await Cooldown.findOneAndUpdate(
            { userId: targetUser.id, listName: listInfo.name },
            { expiresAt },
            { upsert: true }
        );
        message.reply(`✅ ${await getUserDisplayName(message.guild, targetUser.id)} has been confirmed for **${listInfo.name}** and is on cooldown until ${expiresAt.toLocaleString()}.`);
        // Atualiza o embed de cooldown após adicionar o cooldown.
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
        // Atualiza o embed de cooldown após a remoção.
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

// Evento quando um usuário reage a uma mensagem (para tradução)
client.on("messageReactionAdd", async (reaction, user) => {
    if (user.bot) return; // Ignora reações de bots

    const { message, emoji } = reaction;

    // Verifica se o emoji é uma bandeira reconhecida
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

// Loga no Discord
client.login(process.env.TOKEN);

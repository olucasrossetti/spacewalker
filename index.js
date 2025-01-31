require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const translate = require('google-translate-api-x');

// Mapeamento de emojis de bandeiras para códigos de idioma
const flagToLang = {
    "🇺🇸": "en", // Inglês
    "🇬🇧": "en", // Inglês (UK)
    "🇪🇸": "es", // Espanhol
    "🇵🇹": "pt", // Português (Portugal)
    "🇧🇷": "pt", // Português (Brasil)
    "🇫🇷": "fr", // Francês
    "🇩🇪": "de", // Alemão
    "🇮🇹": "it", // Italiano
    "🇯🇵": "ja", // Japonês
    "🇨🇳": "zh-cn", // Chinês simplificado
    "🇷🇺": "ru"  // Russo
};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});

client.once("ready", () => {
    console.log(`Bot está online como ${client.user.tag}!`);
});

// Evento quando um usuário reage a uma mensagem
client.on("messageReactionAdd", async (reaction, user) => {
    if (user.bot) return; // Ignora reações de outros bots

    const { message, emoji } = reaction;

    // Verifica se o emoji é uma bandeira reconhecida
    if (flagToLang[emoji.name]) {
        const targetLang = flagToLang[emoji.name];

        try {
            const result = await translate(message.content, { to: targetLang });
            await message.reply(`🌍 **Translation to ${emoji.name}:**\n${result.text}`);
        } catch (error) {
            console.error(error);
            await message.reply("❌ Erro ao traduzir. Tente novamente.");
        }
    }
});

client.login(process.env.TOKEN);

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
    console.log("✅ Bot is online as " + client.user.tag);
});

client.login(process.env.TOKEN).catch(err => {
    console.error("Erro no login do Discord:", err);
});

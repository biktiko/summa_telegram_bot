const { Telegraf } = require('telegraf');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

async function check() {
    try {
        console.log("Checking webhook info...");
        const webhookInfo = await bot.telegram.getWebhookInfo();
        console.log("Webhook Info:", JSON.stringify(webhookInfo, null, 2));
    } catch (e) {
        console.error("Error during check:", e);
    }
}

check();

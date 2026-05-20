const { Telegraf } = require('telegraf');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const url = process.argv[2];

if (!url) {
    console.error("❌ Пожалуйста, укажите URL вебхука.\nПример: node set_webhook.js https://your-vercel-app.vercel.app/api/webhook");
    process.exit(1);
}

async function setWebhook() {
    try {
        console.log(`Установка вебхука на URL: ${url}...`);
        await bot.telegram.setWebhook(url);
        console.log("✅ Вебхук успешно установлен!");
        const info = await bot.telegram.getWebhookInfo();
        console.log("Статус вебхука:", info);
    } catch (e) {
        console.error("❌ Ошибка при установке вебхука:", e);
    }
}

setWebhook();

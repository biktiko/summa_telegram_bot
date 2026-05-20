require('dotenv').config();
const bot = require('./src/bot');

console.log('Удаляем вебхук (если есть) и запускаем бот в режиме long-polling...');

bot.telegram.deleteWebhook()
    .then(() => {
        return bot.launch();
    })
    .then(() => {
        console.log('🚀 Бот успешно запущен в режиме long-polling!');
        console.log('Для остановки и восстановления вебхука нажмите Ctrl+C');
    })
    .catch((err) => {
        console.error('❌ Ошибка при запуске бота:', err);
    });

// Graceful stop with webhook restoration
async function gracefulStop(signal) {
    console.log(`\n[${signal}] Получен сигнал остановки. Останавливаем локального бота...`);
    
    try {
        bot.stop(signal);
        console.log('Локальный бот успешно остановлен.');
    } catch (e) {
        console.error('Ошибка при остановке Telegraf:', e);
    }

    if (process.env.WEBHOOK_URL) {
        console.log(`\n🔄 Восстанавливаем вебхук на Vercel: ${process.env.WEBHOOK_URL}...`);
        try {
            await bot.telegram.setWebhook(process.env.WEBHOOK_URL);
            console.log('✅ Вебхук успешно восстановлен! Теперь бот будет работать через Vercel.');
            const info = await bot.telegram.getWebhookInfo();
            console.log('Статус вебхука:', info);
        } catch (err) {
            console.error('❌ Ошибка при восстановлении вебхука:', err);
        }
    } else {
        console.log('⚠️ WEBHOOK_URL не настроен в .env, вебхук не будет восстановлен.');
    }
    
    process.exit(0);
}

process.once('SIGINT', () => gracefulStop('SIGINT'));
process.once('SIGTERM', () => gracefulStop('SIGTERM'));

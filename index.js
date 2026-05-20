require('dotenv').config();
const bot = require('./src/bot');

console.log('Удаляем вебхук (если есть) и запускаем бот в режиме long-polling...');

bot.telegram.deleteWebhook()
    .then(() => {
        return bot.launch();
    })
    .then(() => {
        console.log('Бот успешно запущен!');
    })
    .catch((err) => {
        console.error('Ошибка при запуске бота:', err);
    });

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

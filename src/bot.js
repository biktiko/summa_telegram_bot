const { Telegraf } = require('telegraf');
require('dotenv').config();

const { parseTransactionMessage } = require('./parser');
const { 
    getUserIdByTelegramId, 
    linkTelegramToFirebase, 
    getBalance, 
    getCategories, 
    createTransaction 
} = require('./firebase');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Middleware для проверки авторизации
const authMiddleware = async (ctx, next) => {
    // Пропускаем команду /start
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/start')) {
        return next();
    }
    
    const telegramId = ctx.from.id;
    const userId = await getUserIdByTelegramId(telegramId);
    
    if (!userId) {
        return ctx.reply('Вы не авторизованы. Пожалуйста, введите ваш код из приложения Summa: /start <Ваш_Код_Или_Firebase_UID>');
    }
    
    // Сохраняем userId в контексте, чтобы не запрашивать базу снова
    ctx.state.userId = userId;
    return next();
};

bot.use(authMiddleware);

bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const args = ctx.message.text.split(' ').slice(1);
    
    if (args.length > 0) {
        const firebaseUid = args[0];
        try {
            await linkTelegramToFirebase(telegramId, firebaseUid);
            ctx.reply('✅ Ваш Telegram успешно привязан к аккаунту Summa!\n\nИспользуйте команду /help для просмотра возможностей бота.');
        } catch (e) {
            ctx.reply(`❌ Ошибка при привязке аккаунта: ${e.message}`);
        }
    } else {
        const userId = await getUserIdByTelegramId(telegramId);
        if (userId) {
            ctx.reply('Вы уже авторизованы. Можете отправлять транзакции!\nФормат: <Сумма> <Категория> <Название>');
        } else {
            ctx.reply(
                `Привет! Я бот для быстрого добавления транзакций в Summa.\n\n` +
                `Ваш Telegram ID: \`${telegramId}\`\n\n` +
                `Чтобы авторизоваться, отправьте мне команду:\n` +
                `/start <Ваш_Firebase_UID_или_Код>\n\n` +
                `(В будущем вы сможете ввести ваш Telegram ID в настройках Summa).`, 
                { parse_mode: 'Markdown' }
            );
        }
    }
});

bot.help((ctx) => {
    ctx.reply(
        `📌 *Как использовать бота:*\n\n` +
        `Просто отправьте сообщение в формате:\n` +
        `\`<Сумма> <Категория> <Название>\`\n\n` +
        `*Примеры:*\n` +
        `\`150 Еда Кофе\`\n` +
        `\`5000 Продукты Супермаркет\`\n\n` +
        `*Доступные команды:*\n` +
        `/balance - Посмотреть баланс счетов\n` +
        `/categories - Посмотреть список ваших категорий\n` +
        `/help - Показать эту справку`,
        { parse_mode: 'Markdown' }
    );
});

bot.command('balance', async (ctx) => {
    try {
        const userId = ctx.state.userId;
        const balanceText = await getBalance(userId);
        ctx.reply(balanceText);
    } catch (e) {
        ctx.reply(`❌ Ошибка получения баланса: ${e.message}`);
    }
});

bot.command('categories', async (ctx) => {
    try {
        const userId = ctx.state.userId;
        const catText = await getCategories(userId);
        ctx.reply(catText);
    } catch (e) {
        ctx.reply(`❌ Ошибка получения категорий: ${e.message}`);
    }
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const userId = ctx.state.userId;

    try {
        const parsed = parseTransactionMessage(text);
        const resultMsg = await createTransaction(userId, parsed);
        ctx.reply(resultMsg);
    } catch (e) {
        ctx.reply(`❌ Ошибка: ${e.message}\n\nФормат: <Сумма> <Категория> <Название>`);
    }
});

// Глобальный обработчик ошибок
bot.catch((err, ctx) => {
    console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
    ctx.reply('❌ Произошла непредвиденная ошибка на сервере бота.');
});

// Экспорт бота для использования в локальном сервере или в Vercel Webhook
module.exports = bot;

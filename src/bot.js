const { Telegraf, Markup } = require('telegraf');
require('dotenv').config();

const { parseTransactionMessage } = require('./parser');
const { 
    getUserIdByTelegramId, 
    linkTelegramToFirebase, 
    getBalance, 
    getCategories, 
    createTransaction,
    commitTransaction,
    deleteTransaction,
    getRecentTransactions
} = require('./firebase');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Главное меню
const mainMenu = Markup.keyboard([
    ['💰 Добавить', '📊 Баланс'],
    ['📜 Последние', '📂 Категории']
]).resize();

const authMiddleware = async (ctx, next) => {
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/start')) {
        return next();
    }
    
    // Callback query also has ctx.from.id
    const telegramId = ctx.from.id;
    const userId = await getUserIdByTelegramId(telegramId);
    
    if (!userId) {
        if (ctx.callbackQuery) {
            return ctx.answerCbQuery('Вы не авторизованы. Отправьте /start <код>', { show_alert: true });
        }
        return ctx.reply('Вы не авторизованы. Пожалуйста, введите ваш код из приложения Summa: /start <Ваш_Код>', Markup.removeKeyboard());
    }
    
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
            ctx.reply('✅ Ваш Telegram успешно привязан!\n\nИспользуйте меню ниже для работы.', mainMenu);
        } catch (e) {
            ctx.reply(`❌ Ошибка при привязке аккаунта: ${e.message}`);
        }
    } else {
        const userId = await getUserIdByTelegramId(telegramId);
        if (userId) {
            ctx.reply('Вы авторизованы и можете отправлять транзакции!\nФормат: 1500 Кофе', mainMenu);
        } else {
            ctx.reply(
                `Привет! Я бот Summa.\n\n` +
                `Чтобы авторизоваться, отправьте мне команду:\n` +
                `/start <Ваш_Код_Из_Приложения>`, 
                Markup.removeKeyboard()
            );
        }
    }
});

bot.help((ctx) => {
    ctx.reply(
        `📌 *Как добавить транзакцию:*\n\n` +
        `1. Просто отправьте сумму и описание: \`1500 Супермаркет\`\n` +
        `Бот сам предложит выбрать категорию.\n\n` +
        `2. Или укажите категорию сразу: \`1500 Продукты Супермаркет\`\n\n` +
        `Используйте меню ниже для быстрого доступа к функциям.`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

// Обработчики кнопок меню
bot.hears('💰 Добавить', (ctx) => {
    ctx.reply(
        'Вы можете добавить транзакцию двумя способами:\n' +
        '1️⃣ Просто отправьте сумму и описание (например: `1500 Кофе`). Бот сам предложит выбрать категорию.\n' +
        '2️⃣ Укажите категорию сразу (например: `1500 Продукты Супермаркет`).',
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

bot.hears('📊 Баланс', async (ctx) => {
    try {
        const balanceText = await getBalance(ctx.state.userId);
        ctx.reply(balanceText, mainMenu);
    } catch (e) {
        ctx.reply(`❌ Ошибка: ${e.message}`);
    }
});

bot.hears('📂 Категории', async (ctx) => {
    try {
        const catText = await getCategories(ctx.state.userId);
        ctx.reply(catText, mainMenu);
    } catch (e) {
        ctx.reply(`❌ Ошибка: ${e.message}`);
    }
});

bot.hears('📜 Последние', async (ctx) => {
    try {
        const transactions = await getRecentTransactions(ctx.state.userId);
        if (transactions.length === 0) {
            return ctx.reply('У вас пока нет транзакций.', mainMenu);
        }
        
        await ctx.reply('Ваши последние транзакции:', mainMenu);
        for (const tx of transactions) {
            const sign = tx.type === 'income' ? '+' : '-';
            const text = `${sign}${tx.amount} (${tx.description || 'Без описания'})\n📅 ${tx.date}`;
            
            const keyboard = Markup.inlineKeyboard([
                Markup.button.callback('🗑 Удалить', `del_${tx.id}`)
            ]);
            await ctx.reply(text, keyboard);
        }
    } catch (e) {
        ctx.reply(`❌ Ошибка: ${e.message}`);
    }
});

// Обработка текстовых сообщений (Добавление транзакции)
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const userId = ctx.state.userId;

    try {
        const parsed = parseTransactionMessage(text);
        const response = await createTransaction(userId, parsed);
        
        if (response.needsCategorySelection) {
            // Формируем Inline клавиатуру с категориями
            const buttons = response.categories.map(cat => {
                const prefix = cat.type === 'income' ? '🟢' : '🔴';
                return Markup.button.callback(`${prefix} ${cat.label}`, `cat_${response.draftId}_${cat.id}`);
            });
            
            // Разбиваем кнопки по 2 в ряд
            const rows = [];
            for (let i = 0; i < buttons.length; i += 2) {
                rows.push(buttons.slice(i, i + 2));
            }
            
            await ctx.reply(`Выберите категорию для суммы ${parsed.amount} (${parsed.fullText || 'Без описания'}):`, Markup.inlineKeyboard(rows));
        } else {
            // Транзакция сразу сохранена
            const { message, transactionId } = response.result;
            const keyboard = Markup.inlineKeyboard([
                Markup.button.callback('❌ Отменить', `undo_${transactionId}`)
            ]);
            await ctx.reply(message, keyboard);
        }
    } catch (e) {
        ctx.reply(`❌ Ошибка: ${e.message}\n\nПопробуйте просто: 1500 Кофе`);
    }
});

// Обработка выбора категории (Inline Keyboard)
bot.action(/^cat_(.+)_(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const categoryId = ctx.match[2];
    const userId = ctx.state.userId;

    try {
        const result = await commitTransaction(userId, draftId, categoryId);
        
        const keyboard = Markup.inlineKeyboard([
            Markup.button.callback('❌ Отменить', `undo_${result.transactionId}`)
        ]);
        await ctx.editMessageText(result.message, keyboard);
    } catch (e) {
        await ctx.answerCbQuery(e.message.substring(0, 150), { show_alert: true });
        await ctx.editMessageText(`❌ Ошибка: ${e.message}`);
    }
});

// Обработка кнопки Отменить (сразу после добавления)
bot.action(/^undo_(.+)$/, async (ctx) => {
    const transactionId = ctx.match[1];
    const userId = ctx.state.userId;

    try {
        const msg = await deleteTransaction(userId, transactionId);
        await ctx.editMessageText(msg); 
    } catch (e) {
        await ctx.answerCbQuery(e.message, { show_alert: true });
    }
});

// Обработка кнопки Удалить (из списка последних)
bot.action(/^del_(.+)$/, async (ctx) => {
    const transactionId = ctx.match[1];
    const userId = ctx.state.userId;

    try {
        const msg = await deleteTransaction(userId, transactionId);
        await ctx.editMessageText(msg);
    } catch (e) {
        await ctx.answerCbQuery(e.message, { show_alert: true });
    }
});

bot.catch((err, ctx) => {
    console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
    ctx.reply('❌ Произошла непредвиденная ошибка на сервере бота.');
});

module.exports = bot;

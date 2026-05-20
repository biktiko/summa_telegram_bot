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
    getRecentTransactions,
    addNewCategoryAndCommit,
    getUserAccounts,
    selectUserAccount
} = require('./firebase');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Главное меню
const mainMenu = Markup.keyboard([
    ['💰 Добавить', '📊 Баланс'],
    ['📜 Последние', '📂 Категории'],
    ['💳 Выбрать счет']
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

bot.hears('💳 Выбрать счет', async (ctx) => {
    try {
        const userId = ctx.state.userId;
        const { accounts, selectedAccountId } = await getUserAccounts(userId);
        
        if (accounts.length === 0) {
            return ctx.reply('У вас нет счетов в приложении Summa. Пожалуйста, добавьте счет в приложении.', mainMenu);
        }
        
        const activeAccount = accounts.find(a => a.id === selectedAccountId) || accounts[0];
        const activeName = activeAccount ? (activeAccount.name || activeAccount.label) : 'Не выбран';
        
        const buttons = accounts.map(acc => {
            const isSelected = acc.id === selectedAccountId;
            const prefix = isSelected ? '⭐️' : '💳';
            return Markup.button.callback(`${prefix} ${acc.name || acc.label} (${acc.balance || 0} ${acc.currency || ''})`, `selectacc_${acc.id}`);
        });
        
        const rows = buttons.map(btn => [btn]);
        
        await ctx.reply(
            `💳 *Ваши счета*\n\n` +
            `Активный счет для записи транзакций: *${activeName}*\n\n` +
            `Выберите счет ниже, чтобы сделать его активным:`,
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) }
        );
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
        
        if (response.status === 'success') {
            // Транзакция сразу сохранена
            const { message, transactionId } = response.result;
            const keyboard = Markup.inlineKeyboard([
                Markup.button.callback('❌ Отменить', `undo_${transactionId}`)
            ]);
            await ctx.reply(message, keyboard);
        } else if (response.status === 'ask_create_category') {
            // Категория указана, но не найдена
            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('✅ Да', `createcat_yes_${response.draftId}`),
                    Markup.button.callback('❌ Нет', `createcat_no_${response.draftId}`)
                ]
            ]);
            await ctx.reply(`⚠️ Категория "${response.categoryName}" не найдена. Создать её?`, keyboard);
        } else if (response.status === 'needs_category') {
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
            
            const descText = parsed.possibleDescription ? ` (${parsed.possibleDescription})` : '';
            await ctx.reply(`Выберите категорию для суммы ${parsed.amount}${descText}:`, Markup.inlineKeyboard(rows));
        }
    } catch (e) {
        ctx.reply(`❌ Ошибка: ${e.message}\n\nПопробуйте просто: 1500 Кофе`);
    }
});

// Обработка выбора создания новой категории (Да)
bot.action(/^createcat_yes_(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const userId = ctx.state.userId;

    try {
        const result = await addNewCategoryAndCommit(userId, draftId);
        const keyboard = Markup.inlineKeyboard([
            Markup.button.callback('❌ Отменить', `undo_${result.transactionId}`)
        ]);
        await ctx.editMessageText(result.message, keyboard);
    } catch (e) {
        await ctx.answerCbQuery(e.message.substring(0, 150), { show_alert: true });
        await ctx.editMessageText(`❌ Ошибка: ${e.message}`);
    }
});

// Обработка выбора создания новой категории (Нет - показать список)
bot.action(/^createcat_no_(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const userId = ctx.state.userId;

    try {
        const { getUserCategoriesList } = require('./firebase');
        const categories = await getUserCategoriesList(userId);
        
        const buttons = categories.map(cat => {
            const prefix = cat.type === 'income' ? '🟢' : '🔴';
            return Markup.button.callback(`${prefix} ${cat.label}`, `cat_${draftId}_${cat.id}`);
        });
        
        const rows = [];
        for (let i = 0; i < buttons.length; i += 2) {
            rows.push(buttons.slice(i, i + 2));
        }

        await ctx.editMessageText('Хорошо, выберите категорию вручную из списка ниже:', Markup.inlineKeyboard(rows));
    } catch (e) {
        await ctx.answerCbQuery(e.message.substring(0, 150), { show_alert: true });
        await ctx.editMessageText(`❌ Ошибка: ${e.message}`);
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

// Обработка выбора активного аккаунта
bot.action(/^selectacc_(.+)$/, async (ctx) => {
    const accountId = ctx.match[1];
    const userId = ctx.state.userId;

    try {
        const accountName = await selectUserAccount(userId, accountId);
        await ctx.answerCbQuery(`Активный счет изменен на: ${accountName}`);
        
        const { accounts, selectedAccountId } = await getUserAccounts(userId);
        const buttons = accounts.map(acc => {
            const isSelected = acc.id === selectedAccountId;
            const prefix = isSelected ? '⭐️' : '💳';
            return Markup.button.callback(`${prefix} ${acc.name || acc.label} (${acc.balance || 0} ${acc.currency || ''})`, `selectacc_${acc.id}`);
        });
        
        const rows = buttons.map(btn => [btn]);
        
        await ctx.editMessageText(
            `💳 *Ваши счета*\n\n` +
            `✅ Активный счет для записи транзакций изменен на: *${accountName}*\n\n` +
            `Выберите счет ниже, чтобы сделать его активным:`,
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) }
        );
    } catch (e) {
        await ctx.answerCbQuery(e.message.substring(0, 150), { show_alert: true });
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

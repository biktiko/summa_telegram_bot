const bot = require('../src/bot');

module.exports = async (request, response) => {
    try {
        console.log('Получен webhook от Telegram');
        
        // Передаем запрос от Vercel в обработчик Telegraf
        await bot.handleUpdate(request.body, response);
        
        // Если Telegraf не закрыл соединение, возвращаем 200 OK
        if (!response.headersSent) {
            response.status(200).send('OK');
        }
    } catch (e) {
        console.error('Ошибка в webhook:', e);
        response.status(500).send('Internal Server Error');
    }
};

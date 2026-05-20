/**
 * Парсер для телеграм-бота Summa.
 * 
 * Ожидаемый формат: "<Сумма> <Категория> <Название>"
 * Пример: "1000 Еда Вкусный бургер"
 */

function parseTransactionMessage(message) {
    // Убираем лишние пробелы
    const parts = message.trim().split(/\s+/);

    if (parts.length < 2) {
        throw new Error("Сообщение слишком короткое. Формат: <Сумма> <Категория> [Название]");
    }

    // 1. Извлекаем сумму (первое слово)
    const amountRaw = parts[0];
    const amount = parseFloat(amountRaw);
    if (isNaN(amount)) {
        throw new Error(`Не удалось распознать сумму: ${amountRaw}`);
    }

    // 2. Извлекаем категорию и название
    let categoryName = "";
    let description = "";

    if (parts.length === 2) {
        // "1000 Еда" -> Сумма и категория, без названия
        categoryName = parts[1];
        description = categoryName; // Если нет названия, используем категорию как название
    } else {
        // "1000 Еда Бургер Кинг"
        categoryName = parts[1];
        description = parts.slice(2).join(" ");
    }

    return {
        amount,
        categoryName,
        description,
        type: 'expense' // По умолчанию считаем расходом. Если нужно, можно добавить проверку на знак "-" или "+"
    };
}

module.exports = {
    parseTransactionMessage
};

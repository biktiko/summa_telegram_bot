/**
 * Парсер для телеграм-бота Summa.
 * 
 * Ожидаемый формат: "<Сумма> <Категория> <Название>"
 * Пример: "1000 Еда Вкусный бургер"
 */

function parseTransactionMessage(message) {
    // Убираем лишние пробелы
    const parts = message.trim().split(/\s+/);

    if (parts.length === 0 || parts[0] === '') {
        throw new Error("Введите сумму. Например: 1500");
    }

    // 1. Извлекаем сумму (первое слово)
    const amountRaw = parts[0];
    const amount = parseFloat(amountRaw);
    if (isNaN(amount)) {
        throw new Error(`Не удалось распознать сумму: ${amountRaw}`);
    }

    if (parts.length === 1) {
        // Только сумма, без категории или описания
        return {
            amount,
            possibleCategory: null,
            possibleDescription: "",
            fullText: "",
            type: 'expense' // По умолчанию считаем расходом.
        };
    }

    const possibleCategory = parts[1];
    const possibleDescription = parts.slice(2).join(" ") || possibleCategory;
    const fullText = parts.slice(1).join(" ");

    return {
        amount,
        possibleCategory,
        possibleDescription,
        fullText,
        type: 'expense' // По умолчанию считаем расходом.
    };
}

module.exports = {
    parseTransactionMessage
};

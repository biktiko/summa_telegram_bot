const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config();

// Инициализация Firebase
let credential;
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
        const serviceAccountJson = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        credential = admin.credential.cert(serviceAccountJson);
    } catch (e) {
        console.error("Ошибка при парсинге FIREBASE_SERVICE_ACCOUNT_JSON:", e);
    }
}

if (!credential) {
    const serviceAccountPath = path.resolve(__dirname, '..', process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './service-account.json');
    const serviceAccount = require(serviceAccountPath);
    credential = admin.credential.cert(serviceAccount);
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential
    });
}

const db = admin.firestore();

/**
 * Ищет Firebase UID по Telegram ID
 */
async function getUserIdByTelegramId(telegramId) {
    const snapshot = await db.collection('telegram_users').where('telegram_id', '==', telegramId.toString()).get();
    if (snapshot.empty) {
        return null;
    }
    return snapshot.docs[0].data().firebase_uid;
}

/**
 * Привязывает Telegram ID к Firebase UID
 */
async function linkTelegramToFirebase(telegramId, firebaseUid) {
    // Проверяем, нет ли уже такой привязки
    const snapshot = await db.collection('telegram_users').where('telegram_id', '==', telegramId.toString()).get();
    if (!snapshot.empty) {
        // Обновляем
        await db.collection('telegram_users').doc(snapshot.docs[0].id).update({
            firebase_uid: firebaseUid,
            updatedAt: new Date().toISOString()
        });
    } else {
        // Создаем
        await db.collection('telegram_users').add({
            telegram_id: telegramId.toString(),
            firebase_uid: firebaseUid,
            createdAt: new Date().toISOString()
        });
    }
}

/**
 * Получает баланс счетов пользователя
 */
async function getBalance(userId) {
    const snapshot = await db.collection('accounts').where('userId', '==', userId).get();
    if (snapshot.empty) {
        return 'У вас нет добавленных счетов.';
    }
    let balanceText = 'Ваши счета:\n';
    let total = 0;
    snapshot.forEach(doc => {
        const data = doc.data();
        balanceText += `- ${data.name}: ${data.balance} ${data.currency || ''}\n`;
        total += (data.balance || 0);
    });
    balanceText += `\nОбщий баланс: ${total}`;
    return balanceText;
}

/**
 * Получает список категорий пользователя
 */
async function getCategories(userId) {
    const snapshot = await db.collection('categories').where('userId', '==', userId).get();
    if (snapshot.empty) {
        return 'У вас нет добавленных категорий.';
    }
    let catText = 'Ваши категории:\n';
    snapshot.forEach(doc => {
        const data = doc.data();
        catText += `- ${data.label} (${data.type === 'income' ? 'Доход' : 'Расход'})\n`;
    });
    return catText;
}

/**
 * Обрабатывает транзакцию и сохраняет в БД
 */
async function createTransaction(userId, parsedData) {
    let categoryId = "";
    let accountId = "";

    // 1. Ищем категорию (по label)
    if (parsedData.categoryName) {
        const categoriesRef = db.collection('categories');
        const snapshot = await categoriesRef.where('userId', '==', userId).get();
        
        // Firestore не умеет делать case-insensitive where, поэтому фильтруем локально
        const category = snapshot.docs.map(d => ({id: d.id, ...d.data()}))
            .find(c => c.label && c.label.toLowerCase() === parsedData.categoryName.toLowerCase());
        
        if (category) {
            categoryId = category.id;
            parsedData.type = category.type || parsedData.type;
        } else {
            throw new Error(`Категория "${parsedData.categoryName}" не найдена. Создайте её в приложении Summa или проверьте написание.`);
        }
    }

    // 2. Ищем счет по умолчанию
    const accountsRef = db.collection('accounts');
    const accSnapshot = await accountsRef.where('userId', '==', userId).get();
    if (!accSnapshot.empty) {
        // Берем первый попавшийся счет (можно доработать логику дефолтного счета)
        const accountDoc = accSnapshot.docs[0];
        accountId = accountDoc.id; 
        
        // Обновляем баланс счета
        const currentBalance = accountDoc.data().balance || 0;
        const newBalance = parsedData.type === 'expense' 
            ? currentBalance - parsedData.amount 
            : currentBalance + parsedData.amount;
        
        await accountsRef.doc(accountId).update({ balance: newBalance });
    } else {
        throw new Error('У вас нет счетов в приложении Summa. Пожалуйста, создайте счет.');
    }

    const now = new Date();
    const localDate = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

    const transactionData = {
        userId,
        amount: parsedData.amount,
        type: parsedData.type,
        description: parsedData.description,
        categoryId,
        accountId,
        date: localDate,
        createdAt: now.toISOString()
    };

    // Сохраняем транзакцию
    const docRef = await db.collection('transactions').add(transactionData);
    await docRef.update({ id: docRef.id });
    
    return `Транзакция успешно добавлена:\n${parsedData.type === 'income' ? '+' : '-'}${parsedData.amount} (${parsedData.description}) в категорию "${parsedData.categoryName}"`;
}

module.exports = {
    getUserIdByTelegramId,
    linkTelegramToFirebase,
    getBalance,
    getCategories,
    createTransaction
};

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

async function getUserIdByTelegramId(telegramId) {
    const snapshot = await db.collection('telegram_users').where('telegram_id', '==', telegramId.toString()).get();
    if (snapshot.empty) return null;
    return snapshot.docs[0].data().firebase_uid;
}

async function linkTelegramToFirebase(telegramId, firebaseUid) {
    const snapshot = await db.collection('telegram_users').where('telegram_id', '==', telegramId.toString()).get();
    if (!snapshot.empty) {
        await db.collection('telegram_users').doc(snapshot.docs[0].id).update({
            firebase_uid: firebaseUid,
            updatedAt: new Date().toISOString()
        });
    } else {
        await db.collection('telegram_users').add({
            telegram_id: telegramId.toString(),
            firebase_uid: firebaseUid,
            createdAt: new Date().toISOString()
        });
    }
}

async function getBalance(userId) {
    const snapshot = await db.collection('accounts').where('userId', '==', userId).get();
    if (snapshot.empty) return 'У вас нет добавленных счетов.';
    let balanceText = 'Ваши счета:\n';
    let total = 0;
    snapshot.forEach(doc => {
        const data = doc.data();
        balanceText += `- ${data.name || data.label}: ${data.balance} ${data.currency || ''}\n`;
        total += (data.balance || 0);
    });
    balanceText += `\nОбщий баланс: ${total}`;
    return balanceText;
}

async function getCategories(userId) {
    const snapshot = await db.collection('categories').where('userId', '==', userId).get();
    if (snapshot.empty) return 'У вас нет добавленных категорий.';
    let catText = 'Ваши категории:\n';
    snapshot.forEach(doc => {
        const data = doc.data();
        catText += `- ${data.label} (${data.type === 'income' ? 'Доход' : 'Расход'})\n`;
    });
    return catText;
}

async function getUserCategoriesList(userId) {
    const snapshot = await db.collection('categories').where('userId', '==', userId).get();
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getBudgetProgress(userId, categoryId) {
    const catDoc = await db.collection('categories').doc(categoryId).get();
    if (!catDoc.exists) return null;
    const cat = catDoc.data();
    
    if (cat.type === 'income') return null;

    const amount = Number(cat.amount) || 0;
    const period = Number(cat.period) || 30;
    const budgetLimit = (amount * 30) / period;
    
    if (budgetLimit === 0) return null;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const txSnapshot = await db.collection('transactions')
        .where('userId', '==', userId)
        .where('categoryId', '==', categoryId)
        .where('type', '==', 'expense')
        .where('createdAt', '>=', startOfMonth.toISOString())
        .where('createdAt', '<=', endOfMonth.toISOString())
        .get();

    let sum = 0;
    txSnapshot.forEach(doc => {
        sum += Number(doc.data().amount) || 0;
    });

    const percent = (sum / budgetLimit) * 100;
    const excess = sum - budgetLimit;

    let text = `📊 Бюджет: Потрачено ${sum} из ${budgetLimit.toFixed(0)} (${percent.toFixed(0)}%)`;
    if (excess > 0) {
        text = `⚠️ Бюджет: Потрачено ${sum} из ${budgetLimit.toFixed(0)} (${percent.toFixed(0)}%). Превышение на ${excess}!`;
    }
    return text;
}

async function createDraftTransaction(userId, amount, description) {
    const docRef = await db.collection('transaction_drafts').add({
        userId,
        amount,
        description,
        createdAt: new Date().toISOString()
    });
    return docRef.id;
}

async function _finalizeTransaction(userId, amount, description, categoryId) {
    const categoryDoc = await db.collection('categories').doc(categoryId).get();
    if (!categoryDoc.exists) throw new Error("Категория не найдена");
    const category = categoryDoc.data();

    const accountsRef = db.collection('accounts');
    const accSnapshot = await accountsRef.where('userId', '==', userId).get();
    if (accSnapshot.empty) throw new Error('У вас нет счетов в приложении Summa.');
    
    const accountDoc = accSnapshot.docs[0];
    const accountId = accountDoc.id; 
    const currentBalance = accountDoc.data().balance || 0;
    
    const type = category.type || 'expense';
    const newBalance = type === 'expense' 
        ? currentBalance - amount 
        : currentBalance + amount;
    
    await accountsRef.doc(accountId).update({ balance: newBalance });

    const now = new Date();
    const localDate = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

    const transactionData = {
        userId,
        amount,
        type,
        description: description || category.label,
        categoryId,
        accountId,
        date: localDate,
        createdAt: now.toISOString()
    };

    const docRef = await db.collection('transactions').add(transactionData);
    await docRef.update({ id: docRef.id });

    let msg = `Транзакция успешно добавлена:\n${type === 'income' ? '+' : '-'}${amount} (${description || category.label}) в категорию "${category.label}"`;
    
    const budgetMsg = await getBudgetProgress(userId, categoryId);
    if (budgetMsg) {
        msg += `\n\n${budgetMsg}`;
    }

    return { message: msg, transactionId: docRef.id };
}

async function commitTransaction(userId, draftId, categoryId) {
    const draftDoc = await db.collection('transaction_drafts').doc(draftId).get();
    if (!draftDoc.exists) throw new Error("Время выбора истекло или черновик устарел.");
    
    const { amount, description, userId: draftUserId } = draftDoc.data();
    if (userId !== draftUserId) throw new Error("Нет доступа.");

    const result = await _finalizeTransaction(userId, amount, description, categoryId);
    
    await db.collection('transaction_drafts').doc(draftId).delete();
    
    return result;
}

async function createTransaction(userId, parsedData) {
    const categories = await getUserCategoriesList(userId);
    
    let matchedCategory = null;
    if (parsedData.possibleCategory) {
        matchedCategory = categories.find(c => c.label && c.label.toLowerCase() === parsedData.possibleCategory.toLowerCase());
    }

    if (matchedCategory) {
        return {
            needsCategorySelection: false,
            result: await _finalizeTransaction(userId, parsedData.amount, parsedData.possibleDescription, matchedCategory.id)
        };
    } else {
        const draftId = await createDraftTransaction(userId, parsedData.amount, parsedData.fullText);
        return {
            needsCategorySelection: true,
            draftId,
            categories
        };
    }
}

async function deleteTransaction(userId, transactionId) {
    const txDoc = await db.collection('transactions').doc(transactionId).get();
    if (!txDoc.exists) throw new Error("Транзакция не найдена или уже удалена.");
    
    const tx = txDoc.data();
    if (tx.userId !== userId) throw new Error("Нет доступа.");

    const accountDoc = await db.collection('accounts').doc(tx.accountId).get();
    if (accountDoc.exists) {
        const currentBalance = accountDoc.data().balance || 0;
        const newBalance = tx.type === 'expense' 
            ? currentBalance + tx.amount 
            : currentBalance - tx.amount;
        await db.collection('accounts').doc(tx.accountId).update({ balance: newBalance });
    }

    await db.collection('transactions').doc(transactionId).delete();
    return `✅ Транзакция на сумму ${tx.amount} удалена, баланс восстановлен.`;
}

async function getRecentTransactions(userId) {
    const snapshot = await db.collection('transactions')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get();
        
    if (snapshot.empty) return [];
    
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

module.exports = {
    getUserIdByTelegramId,
    linkTelegramToFirebase,
    getBalance,
    getCategories,
    createTransaction,
    commitTransaction,
    deleteTransaction,
    getRecentTransactions
};

const { getUserAccounts, getBalance } = require('./src/firebase');

async function run() {
    try {
        const userId = 'WdYXK7J437OWkepxJoqnNue7axr1';
        console.log("=== getUserAccounts ===");
        const accountsResult = await getUserAccounts(userId);
        console.log(JSON.stringify(accountsResult, null, 2));

        console.log("\n=== getBalance ===");
        const balanceResult = await getBalance(userId);
        console.log(balanceResult);
    } catch (e) {
        console.error(e);
    }
}

run();

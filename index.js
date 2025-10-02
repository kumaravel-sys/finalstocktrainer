const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch'); // npm install node-fetch@2

admin.initializeApp();

exports.trade = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be signed in');
  }
  const uid = context.auth.uid;
  const symbol = data.symbol;
  const qty = Number(data.qty);
  const action = data.action; // 'buy' or 'sell'
  if (!symbol || !qty || !['buy','sell'].includes(action)) {
    throw new functions.https.HttpsError('invalid-argument', 'Bad arguments');
  }

  const finnhubKey = functions.config().finnhub.key;
  const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhubKey}`);
  const json = await res.json();
  const price = json.c;
  if (!price) throw new functions.https.HttpsError('internal','Price fetch failed');

  const db = admin.firestore();
  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    let balance = (snap.exists && snap.data().balance) || 100000;
    let portfolio = (snap.exists && snap.data().portfolio) || {};

    if (action === 'buy') {
      const cost = price * qty;
      if (balance < cost) throw new functions.https.HttpsError('failed-precondition','Insufficient balance');
      balance -= cost;
      portfolio[symbol] = (portfolio[symbol] || 0) + qty;
    } else { // sell
      const have = portfolio[symbol] || 0;
      if (have < qty) throw new functions.https.HttpsError('failed-precondition','Not enough shares');
      portfolio[symbol] = have - qty;
      if (portfolio[symbol] === 0) delete portfolio[symbol];
      balance += price * qty;
    }

    tx.set(userRef, { balance, portfolio }, { merge: true });
    return { balance, portfolio };
  });
});

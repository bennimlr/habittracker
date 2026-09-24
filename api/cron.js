import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    }),
  });
}

export default async function handler(req, res) {
  try {
    const db = admin.firestore();
    const usersSnapshot = await db.collection('users').get();
    let sentCount = 0;

    for (const doc of usersSnapshot.docs) {
      const userData = doc.data();
      // Prüfe sowohl das neue Token-Array als auch alte Einzel-Tokens
      const tokens = userData.fcmTokens || (userData.fcmToken ? [userData.fcmToken] : []);

      if (tokens.length > 0) {
        const response = await admin.messaging().sendEachForMulticast({
          tokens: tokens,
          notification: {
            title: 'Habit Tracker 🎯',
            body: 'Zeit für deine Daily Habits! Hak deine Erfolge für heute ab.'
          }
        });
        sentCount += response.successCount;
      }
    }

    return res.status(200).json({ success: true, sent: sentCount });
  } catch (error) {
    console.error("Cron Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
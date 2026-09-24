const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        })
    });
}

export default async function handler(req, res) {
    try {
        const db = admin.firestore();
        const usersSnapshot = await db.collection('users').get();
        let sentCount = 0;

        for (const userDoc of usersSnapshot.docs) {
            const token = userDoc.data().fcmToken;
            if (token) {
                const message = {
                    notification: { title: 'Habit Tracker 🎯', body: 'Vergiss nicht, deine heutigen Gewohnheiten abzuhaken!' },
                    token: token
                };
                try {
                    await admin.messaging().send(message);
                    sentCount++;
                } catch (err) {
                    console.error('Token-Fehler:', err);
                }
            }
        }
        res.status(200).json({ success: true, sent: sentCount });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
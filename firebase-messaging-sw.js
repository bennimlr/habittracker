importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyDBdakB1PQU0cyO8q1MYficltzoi-kKBdQ",
    authDomain: "habit-tracker-17e23.firebaseapp.com",
    projectId: "habit-tracker-17e23",
    storageBucket: "habit-tracker-17e23.firebasestorage.app",
    messagingSenderId: "648562953307",
    appId: "1:648562953307:web:a4e89af1c95db1b5fdc37e"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/static/icon.png' // Falls du später ein Logo hast
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});
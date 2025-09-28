// firebase-messaging-sw.js

// Scripts de Firebase necesarios
importScripts("https://www.gstatic.com/firebasejs/9.1.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.1.0/firebase-messaging-compat.js");

// TODO: Reemplaza esto con la configuración de tu proyecto de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAB2LImUOxv1BstMB12UTFyMfWbvxKjrjg",
  authDomain: "cps-belvedere.firebaseapp.com",
  projectId: "cps-belvedere",
  storageBucket: "cps-belvedere.firebasestorage.app",
  messagingSenderId: "1089833077765",
  appId: "1:1089833077765:web:28e8a2b3126f4c8d56e06c"
};

firebase.initializeApp(firebaseconfig);

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log("[firebase-messaging-sw.js] Mensaje en segundo plano recibido:", payload);
  
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/logo.png', // Opcional: añade un logo en la misma carpeta
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
// src/firebaseConfig.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getMessaging } from "firebase/messaging"; // 👈 importa Messaging

// ✅ Config en claro (valores de tu proyecto)
const firebaseConfig = {
  apiKey: "AIzaSyAB2LImUOxv1BstMB12UTFyMfWbvxKjrjg",
  authDomain: "cps-belvedere.firebaseapp.com",
  projectId: "cps-belvedere",
  storageBucket: "cps-belvedere.firebasestorage.app",
  messagingSenderId: "1089833077765",
  appId: "1:1089833077765:web:28e8a2b3126f4c8d56e06c",
};

// Inicializa Firebase
const app = initializeApp(firebaseConfig);

// Exporta servicios
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Messaging (protegido por si el navegador no lo soporta)
let messaging = null;
try {
  messaging = getMessaging(app);
} catch (err) {
  console.warn("Firebase Messaging could not be initialized.", err);
}
export { messaging };


// Fin src/firebaseConfig.js
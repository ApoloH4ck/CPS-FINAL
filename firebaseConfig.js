// firebaseConfig.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Tu configuración de Firebase, usando variables de entorno
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};


// Inicializa Firebase
const app = initializeApp(firebaseConfig);

// Exporta los servicios que necesitarás en tu aplicación
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Initialize messaging safely.
// It can fail in browsers that don't support it (e.g., non-HTTPS, missing features).
// This prevents the entire module from failing to load.
let messagingInstance = null;
try {
  messagingInstance = getMessaging(app);
} catch (err) {
  console.warn("Firebase Messaging could not be initialized.", err);
}

export const messaging = messagingInstance;

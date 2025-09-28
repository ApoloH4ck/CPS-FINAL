// functions/index.js

// Sintaxis v2: Se importa 'onDocumentCreated' directamente
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

// Sintaxis v2: La estructura de la función es diferente
exports.sendNotificationOnNewTask = onDocumentCreated("tasks/{taskId}", async (event) => {
  // En v2, los datos del documento están en event.data
  const snapshot = event.data;
  if (!snapshot) {
    console.log("No hay datos asociados al evento.");
    return;
  }

  const task = snapshot.data();
  const ownerUsername = task.owner;

  if (!ownerUsername) {
    console.log("La tarea no tiene propietario.");
    return;
  }

  const usersRef = db.collection("users");
  const userQuery = await usersRef
      .where("username", "==", ownerUsername)
      .limit(1)
      .get();

  if (userQuery.empty) {
    console.log(`No se encontró al usuario: ${ownerUsername}`);
    return;
  }
  const ownerUid = userQuery.docs[0].id;

  const tokensDoc = await db.collection("fcm_tokens").doc(ownerUid).get();
  if (!tokensDoc.exists) {
    console.log(`No se encontraron tokens para el usuario: ${ownerUid}`);
    return;
  }

  const { tokens } = tokensDoc.data();
  if (!tokens || tokens.length === 0) {
    console.log("El array de tokens está vacío.");
    return;
  }

  const payload = {
    notification: {
      title: "¡Nueva Tarea Asignada!",
      body: `Admin te ha asignado: ${task.text}`,
      icon: "/logo.png",
    },
  };

  const response = await messaging.sendToDevice(tokens, payload);
  const tokensToRemove = [];
  response.results.forEach((result, index) => {
    const error = result.error;
    if (error) {
      console.error(
          "Fallo al enviar notificación a",
          tokens[index],
          error,
      );
      if (
        error.code === "messaging/invalid-registration-token" ||
        error.code === "messaging/registration-token-not-registered"
      ) {
        tokensToRemove.push(tokens[index]);
      }
    }
  });

  if (tokensToRemove.length > 0) {
    const newTokens = tokens.filter((t) => !tokensToRemove.includes(t));
    await tokensDoc.ref.update({ tokens: newTokens });
  }
});
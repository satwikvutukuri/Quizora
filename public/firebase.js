import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBCq_sARumO35JWSUAa7FegJGCr95YUijA",
  authDomain: "quizora-9d933.firebaseapp.com",
  projectId: "quizora-9d933",
  storageBucket: "quizora-9d933.appspot.com",
  messagingSenderId: "318767245179",
  appId: "1:318767245179:web:58445f16c00c1a3cd2bfde",
  measurementId: "G-RBWPTRTPBR"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);
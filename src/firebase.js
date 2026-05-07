import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// ⚠️ แทนที่ด้วย Config จาก Firebase Console ของคุณ
const firebaseConfig = {
  apiKey: "AIzaSyBFWsztdGP_qlHv4ZIs0MTaSxQ_xPGbQUA",
  authDomain: "buddy-system-3500f.firebaseapp.com",
  projectId: "buddy-system-3500f",
  storageBucket: "buddy-system-3500f.firebasestorage.app",
  messagingSenderId: "921397744389",
  appId: "1:921397744389:web:5cd708f4bbc166a664dd6c"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;

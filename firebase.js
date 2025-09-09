// firebase.js - initialize firebase and export helpers
const firebaseConfig = {
apiKey: "AIzaSyBsbqTVszuJDkp8Ut19YnoH5Y35sNxuImA",
authDomain: "twinity-d2ba5.firebaseapp.com",
projectId: "twinity-d2ba5",
storageBucket: "twinity-d2ba5.firebasestorage.app",
messagingSenderId: "1008106990334",
appId: "1:1008106990334:web:f04aaf6a36700115e8d3af",
measurementId: "G-6LCD1DQQ1S"
};


const FUNCTIONS_BASE = "https://us-central1-twinity-d2ba5.cloudfunctions.net";


firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();


export { auth, db, FUNCTIONS_BASE };
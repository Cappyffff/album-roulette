// ── App configuration ────────────────────────────────────────────────────────
//
// 1) FIREBASE_CONFIG
//    Leave as null to run in LOCAL TEST MODE (data saved only in this
//    browser via localStorage — good for trying the app out).
//    To sync across your phone/computer and let friends suggest numbers,
//    create a free Firebase project (see README.md) and paste the config
//    object it gives you here, e.g.:
//
//    const FIREBASE_CONFIG = {
//      apiKey: "AIza....",
//      authDomain: "your-project.firebaseapp.com",
//      projectId: "your-project",
//      storageBucket: "your-project.appspot.com",
//      messagingSenderId: "1234567890",
//      appId: "1:1234567890:web:abcdef123456",
//    };
//
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBK5Zqg1FoUXaEV1I9STQkWHDTNN9QM6F0",
  authDomain: "album-roulette-cappyffff.firebaseapp.com",
  projectId: "album-roulette-cappyffff",
  storageBucket: "album-roulette-cappyffff.firebasestorage.app",
  messagingSenderId: "729086354464",
  appId: "1:729086354464:web:2d9fc6a5ae1f6e32a64845",
  measurementId: "G-1E40ZSLR0S",
};

// 2) OWNER_CODE
//    Spinning and the official rating are locked behind this code — visitors
//    can only view and leave their own reviews. Unlock once per device via
//    the 🔒 button in the header. CHANGE THIS to your own secret code before
//    sharing the link! (Set to "" to disable the lock entirely.)
const OWNER_CODE = "RLRY2JRG";

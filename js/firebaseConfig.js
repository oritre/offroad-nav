// Firebase web config for the offroad-nav project. These values are public identifiers, not secrets:
// access is enforced by firestore.rules (each user can only read/write users/{own uid}).
export const firebaseConfig = {
  apiKey: 'AIzaSyCbJB6CI9WM9KWyj-haUCmyldaJLCoC5Ls',
  authDomain: 'offroad-nav-879a0.firebaseapp.com',
  projectId: 'offroad-nav-879a0',
  storageBucket: 'offroad-nav-879a0.firebasestorage.app',
  messagingSenderId: '57239112799',
  appId: '1:57239112799:web:1439317360d0481f351fea',
};
// Only these Google accounts may sign in (others are signed out right away).
export const allowedEmails = ['origroup@gmail.com'];

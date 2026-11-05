// Firebase web config for live sync of YOUR points, tracks and layers between devices.
// Not a secret for web apps: access is enforced by firestore.rules (each signed-in user sees only users/{uid}).
// Leave as null to run fully local on each device.
export const firebaseConfig = null;

// Optional: only these Google accounts may sign in (checked client-side; the rules enforce per-user isolation).
export const allowedEmails = ['origroup@gmail.com'];

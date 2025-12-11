import { initializeApp, getApps, getApp } from "firebase/app";
import { getMessaging, isSupported as isMessagingSupported } from "firebase/messaging";
import { getAnalytics, isSupported as isAnalyticsSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Avoid re-initializing in dev hot-reload
export const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const messagingPromise = isMessagingSupported().then((ok) =>
  ok ? getMessaging(firebaseApp) : null
);

// Initialize Analytics with error handling to suppress ERR_BLOCKED_BY_CLIENT
// This error occurs when ad blockers or privacy extensions block Google Analytics
export const analyticsPromise = isAnalyticsSupported()
  .then((ok) => {
    if (!ok) return null;
    try {
      return getAnalytics(firebaseApp);
    } catch (error: any) {
      // Suppress ERR_BLOCKED_BY_CLIENT and other analytics errors
      // This is expected when ad blockers are active
      if (
        error?.message?.includes("BLOCKED_BY_CLIENT") ||
        error?.code === "BLOCKED_BY_CLIENT" ||
        error?.name === "NetworkError"
      ) {
        console.warn(
          "[Firebase Analytics] Analytics blocked by client (ad blocker or privacy extension)"
        );
        return null;
      }
      throw error;
    }
  })
  .catch((error: any) => {
    // Handle any errors during analytics initialization
    if (
      error?.message?.includes("BLOCKED_BY_CLIENT") ||
      error?.code === "BLOCKED_BY_CLIENT" ||
      error?.name === "NetworkError" ||
      error?.message?.includes("ERR_BLOCKED_BY_CLIENT")
    ) {
      console.warn(
        "[Firebase Analytics] Analytics blocked by client (ad blocker or privacy extension)"
      );
      return null;
    }
    console.error("[Firebase Analytics] Failed to initialize:", error);
    return null;
  });


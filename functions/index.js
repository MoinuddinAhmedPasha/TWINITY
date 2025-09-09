/**
 * Cloud Functions for Twinity
 * - applyAdReward: verifies ID token, ensures once-per-day ad reward, awards +100 points
 * - awardGamePoints: verifies ID token, validates request, awards game points (trusted server)
 *
 * Deploy with: firebase deploy --only functions
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");

admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// Helper: verify Firebase ID token from Authorization header
async function verifyIdTokenFromReq(req, res) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    res.status(401).json({ ok: false, error: "Missing or invalid Authorization header" });
    return null;
  }
  const idToken = auth.split("Bearer ")[1];
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded;
  } catch (err) {
    console.error("verifyIdToken error:", err);
    res.status(401).json({ ok: false, error: "Invalid ID token" });
    return null;
  }
}

/**
 * applyAdReward
 * body: { userId }
 * Behavior:
 *  - verifies idToken -> uid must equal body.userId
 *  - checks user's lastAdShown day key, only allows one award per day
 *  - awards +100 points atomically (transaction), logs activity
 */
app.post("/applyAdReward", async (req, res) => {
  try {
    const decoded = await verifyIdTokenFromReq(req, res);
    if (!decoded) return;
    const uid = decoded.uid;
    const { userId } = req.body || {};
    if (!userId || userId !== uid) return res.status(400).json({ ok: false, error: "userId mismatch" });

    const userRef = db.collection("users").doc(uid);
    const now = new Date();
    const dayKey = `${now.getUTCFullYear()}-${now.getUTCMonth()+1}-${now.getUTCDate()}`;

    await db.runTransaction(async tx => {
      const snap = await tx.get(userRef);
      const data = snap.exists ? snap.data() : {};

      // Already claimed today?
      if (data.lastAdShown === dayKey) {
        return res.status(200).json({ ok: false, error: "Already claimed today" });
      }

      // Award points and set lastAdShown
      tx.set(userRef, {
        points: admin.firestore.FieldValue.increment(100),
        lastAdShown: dayKey
      }, { merge: true });

      // add activity entry
      const actRef = userRef.collection("activities").doc();
      tx.set(actRef, { text: "Watched daily ad +100 pts (server)", time: admin.firestore.FieldValue.serverTimestamp() });

      // commit done by transaction
      return;
    });

    // Re-fetch points to return to caller (best-effort)
    const fresh = await userRef.get();
    const newPoints = fresh.exists ? (fresh.data().points || 0) : 0;
    return res.status(200).json({ ok: true, added: 100, points: newPoints });
  } catch (err) {
    console.error("applyAdReward error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

/**
 * awardGamePoints
 * body: { userId, points, level, totalScore }
 * Behavior:
 *  - verifies idToken -> uid must equal body.userId
 *  - validates points are reasonable (guard against client tampering)
 *  - awards points atomically and records activity
 */
app.post("/awardGamePoints", async (req, res) => {
  try {
    const decoded = await verifyIdTokenFromReq(req, res);
    if (!decoded) return;
    const uid = decoded.uid;
    const { userId, points, level, totalScore } = req.body || {};

    if (!userId || userId !== uid) return res.status(400).json({ ok: false, error: "userId mismatch" });
    if (!Number.isInteger(points) || points <= 0) return res.status(400).json({ ok: false, error: "invalid points" });

    // Basic anti-abuse: limit per-call points, and limit level number
    const MAX_POINTS_PER_CALL = 1000;
    const MAX_LEVEL_ALLOWED = 500;

    if (points > MAX_POINTS_PER_CALL) return res.status(400).json({ ok: false, error: "points_too_large" });
    if (level && (isNaN(level) || level < 0 || level > MAX_LEVEL_ALLOWED)) return res.status(400).json({ ok: false, error: "invalid level" });

    const userRef = db.collection("users").doc(uid);
    await db.runTransaction(async tx => {
      const snap = await tx.get(userRef);
      if (!snap.exists) {
        // create minimal user doc if missing (do not overwrite other fields)
        tx.set(userRef, { points: admin.firestore.FieldValue.increment(points) }, { merge: true });
      } else {
        tx.update(userRef, { points: admin.firestore.FieldValue.increment(points) });
      }
      const actRef = userRef.collection("activities").doc();
      tx.set(actRef, { text: `Game: +${points} pts (level ${level || "?"})`, time: admin.firestore.FieldValue.serverTimestamp(), totalScore: totalScore || null }, { merge: true });
    });

    const fresh = await userRef.get();
    const newPoints = fresh.exists ? (fresh.data().points || 0) : 0;
    return res.status(200).json({ ok: true, added: points, points: newPoints });
  } catch (err) {
    console.error("awardGamePoints error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// Expose app as HTTPS function
exports.api = functions.runWith({ memory: "256MB", timeoutSeconds: 30 }).https.onRequest(app);

// Optional convenience endpoints
exports.applyAdReward = functions.https.onRequest(async (req, res) => {
  // Proxy to /applyAdReward on express app for backward compatibility
  return app.handle(req, res);
});
exports.awardGamePoints = functions.https.onRequest(async (req, res) => {
  return app.handle(req, res);
});

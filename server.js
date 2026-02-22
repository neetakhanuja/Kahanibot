import "dotenv/config";
import express from "express";

const app = express();
app.use(express.json());

// Webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("Webhook verified successfully");
    return res.status(200).send(challenge);
  }

  console.log("Webhook verification failed");
  return res.sendStatus(403);
});

// Incoming webhook events
app.post("/webhook", (req, res) => {
  console.log("==== INCOMING WEBHOOK ====");
  console.log(JSON.stringify(req.body, null, 2));
  console.log("==========================");
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

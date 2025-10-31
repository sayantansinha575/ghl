import express from "express";
import axios from "axios";

const app = express();
// app.use(express.raw({ type: '*/*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Google API Key (keep it secret in .env for production)
const GOOGLE_API_KEY = "AIzaSyDGhn92p1EilcJwrBg1Fiv3NwXssPh0Z7c";

// ✅ Root route for Render
app.get("/", (req, res) => {
  res.send("✅ GHL Route Distance API is running successfully!");
});

/**
 * POST /check-available-slots
 * Example JSON body:
 * {
 *   "customerAddress": "123 Main St, Buffalo, NY",
 *   "staffAddress": "9990 Transit Rd, Buffalo, NY",
 *   "requestedDate": "2025-10-28",
 *   "requestedTime": "10:30 am"
 * }
 */
app.post("/check-available-slots", async (req, res) => {
  try {
    console.log("Headers:", req.headers);
    // console.log("Raw body string:", req.rawBody);
    console.log("Parsed body:", req.body);
    const { customerAddress, staffAddress, requestedDate, requestedTime } = req.body.customData;

    if (!customerAddress || !staffAddress || !requestedDate || !requestedTime) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // 🗺️ Step 1: Calculate travel distance and time
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(
      staffAddress
    )}&destinations=${encodeURIComponent(customerAddress)}&key=${GOOGLE_API_KEY}`;

    const response = await axios.get(url);
    const data = response.data;

    if (
      !data.rows?.[0]?.elements?.[0] ||
      data.rows[0].elements[0].status !== "OK"
    ) {
      throw new Error("Could not calculate distance between the given addresses");
    }

    const distance = data.rows[0].elements[0].distance.text;
    const duration = data.rows[0].elements[0].duration.text;
    const durationValue = data.rows[0].elements[0].duration.value / 60; // minutes

    // 🕒 Step 2: Add buffer time (e.g., 15 minutes)
    const bufferTime = 15;
    const totalTravelTime = durationValue + bufferTime;

    // 🧮 Step 3: Calculate next available slot
    const appointmentDateTime = new Date(`${requestedDate} ${requestedTime}`);
    const nextAvailable = new Date(
      appointmentDateTime.getTime() + totalTravelTime * 60000
    );

    const slotStart = nextAvailable.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const slotEnd = new Date(nextAvailable.getTime() + 30 * 60000).toLocaleTimeString(
      "en-US",
      {
        hour: "2-digit",
        minute: "2-digit",
      }
    );

    const availableSlot = `${slotStart} - ${slotEnd}`;

    // ✅ Step 4: Send response
    return res.json({
      message: "✅ Available slot calculated successfully",
      distance,
      travelDuration: duration,
      totalTravelTime: `${Math.round(totalTravelTime)} minutes`,
      suggestedSlot: availableSlot,
    });
  } catch (error) {
    console.error("❌ Error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

// ✅ Use Render’s dynamic port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running successfully on port ${PORT}`));



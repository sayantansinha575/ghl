import express from "express";
import axios from "axios";
import dayjs from "dayjs";

const app = express();
app.use(express.json());

// ---- CONFIG ----
const GOOGLE_API_KEY = "AIzaSyDGhn92p1EilcJwrBg1Fiv3NwXssPh0Z7c";
const GHL_API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJsb2NhdGlvbl9pZCI6IkhoSHRjYXlVc0NzeHFoY2hKVTdYIiwiY29tcGFueV9pZCI6IjhYeUFPNlMyTUltcWJtTm54dGJIIiwidmVyc2lvbiI6MSwiaWF0IjoxNjg2NDMwMDkyMTI5LCJzdWIiOiJ1c2VyX2lkIn0.DvYzFxWgBDknzfz8nWsy4_fjN3Jvibs2xKKAxRuXna4"; // Location-level API key
const BUSINESS_START = "09:00";
const BUSINESS_END = "17:00";

app.get("/", (req, res) => {
  res.send("✅ GHL Route Distance API is running successfully!");
});

// ---- Fetch appointments from GHL ----
async function getAppointmentsFromGHL(calendarId, date) {
  try {
    const res = await axios.get(
      `https://services.leadconnectorhq.com/calendars/appointments?calendarId=${calendarId}`,
      {
        headers: {
          Authorization: `Bearer ${GHL_API_KEY}`,
          Version: "2021-07-28",
        },
      }
    );

    const allAppointments = res.data.appointments || [];

    // Filter by same day
    return allAppointments.filter((a) =>
      dayjs(a.startTime).isSame(dayjs(date), "day")
    );
  } catch (err) {
    console.error("GHL API Error:", err.response?.data || err.message);
    return [];
  }
}

// ---- Calculate Distance using Google Maps ----
async function getTravelTime(origin, destination) {
  try {
    const res = await axios.get(
      "https://maps.googleapis.com/maps/api/distancematrix/json",
      {
        params: {
          origins: origin,
          destinations: destination,
          key: GOOGLE_API_KEY,
        },
      }
    );

    const element = res.data.rows[0].elements[0];
    if (element.status === "OK") {
      return {
        distanceText: element.distance.text,
        durationText: element.duration.text,
        durationMinutes: Math.ceil(element.duration.value / 60),
      };
    } else {
      console.warn("Distance matrix status:", element.status);
      return null;
    }
  } catch (err) {
    console.error("Google Distance API Error:", err.message);
    return null;
  }
}

// ---- Find previous appointment ----
function findPreviousAppointment(appointments, requestedDateTime) {
  let previous = null;
  appointments.forEach((a) => {
    const end = dayjs(a.endTime);
    if (end.isBefore(requestedDateTime)) {
      if (!previous || end.isAfter(dayjs(previous.endTime))) {
        previous = a;
      }
    }
  });
  return previous;
}

async function sendMessageToGHL(contactId, slotInfo) {
  try {
    await axios.post(
      `https://services.leadconnectorhq.com//conversations/messages`,
      {
        contactId,
        message: `${slotInfo.message}\nDistance: ${slotInfo.distance}\nTravel Time: ${slotInfo.travelDuration}`,
        type: "Inbound", // Inbound = from bot to customer
      },
      {
        headers: {
          Authorization: `Bearer ${GHL_API_KEY}`,
          Version: "2021-07-28",
          "Content-Type": "application/json",
        },
      }
    );
    console.log("Message sent successfully to GHL contact");
  } catch (error) {
    console.error("Failed to send GHL message:", error.response?.data || error);
  }
}


// ---- MAIN WEBHOOK ----
app.post("/check-available-slots", async (req, res) => {
  try {
    console.log("Incoming GHL Webhook:", req.body);

    const { contact, customData, calendar } = req.body;
    const customerAddress = customData?.customerAddress;
    const staffAddress = customData?.staffAddress;
    const requestedDate = customData?.requestedDate;
    const requestedTime = customData?.requestedTime;
    const calendarId = calendar?.id;

    const contactId = contact?.id;
    let slotInfo;

    if (!customerAddress || !staffAddress || !requestedDate || !requestedTime) {
      return res
        .status(400)
        .json({ error: "Missing required fields in webhook payload" });
    }

    const requestedDateTime = dayjs(`${requestedDate} ${requestedTime}`);

    // 1️ Get all appointments for that day from GHL
    const appointments = await getAppointmentsFromGHL(calendarId, requestedDate);

    // 2️ Find previous appointment (before requested time)
    const previous = findPreviousAppointment(appointments, requestedDateTime);

    // 3️ If none → this is first appointment of the day
    if (!previous) {
      const slotInfo = {
        message: "First appointment of the day (no previous appointment).",
        suggestedSlot: `${requestedTime} (start of day)`,
      };

      await sendMessageToGHL(contactId, slotInfo);
      return res.json({ status: "success", ...slotInfo });
    }

    // 4️ Calculate travel time between previous and new appointment
    const travel = await getTravelTime(previous.address, customerAddress);
    if (!travel) {
      return res.status(400).json({
        error: "Failed to calculate distance between addresses.",
      });
    }

    // 5️ Suggest slot based on travel buffer
    const prevEnd = dayjs(previous.endTime);
    const suggestedStart = prevEnd.add(travel.durationMinutes, "minute");
    const suggestedEnd = suggestedStart.add(30, "minute"); // default 30min slot

    const businessClose = dayjs(`${requestedDate} ${BUSINESS_END}`);
  
    if (suggestedStart.isAfter(businessClose)) {
      slotInfo = {
        message: "Office closed. Suggesting next day 9:00 AM slot.",
        suggestedSlot: "Next business day 9:00 AM",
        distance: travel.distanceText,
        travelDuration: travel.durationText,
      };
    } else {
      slotInfo = {
        message: "Available slot calculated successfully",
        distance: travel.distanceText,
        travelDuration: travel.durationText,
        totalTravelTime: `${travel.durationMinutes} minutes`,
        suggestedSlot: `${suggestedStart.format("hh:mm A")} - ${suggestedEnd.format("hh:mm A")}`,
        previousAppointment: {
          address: previous.address,
          endTime: previous.endTime,
        },
      }; 
    }

    if (contactId) await sendMessageToGHL(contactId, slotInfo);
    res.json({ status: "success", ...slotInfo });
  } catch (err) {
    console.error("Webhook Error:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ GHL Webhook live at http://localhost:${PORT}`)
);

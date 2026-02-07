import "dotenv/config";
import express from "express";
import cors from "cors";
import twilio from "twilio";
import multer from "multer";
import path from "path";
import fs from "fs";
import imap from 'imap-simple';
import { simpleParser } from 'mailparser';
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();

// CONFIGURATION
const PUBLIC_URL = "https://lean-hacks-backend.onrender.com"; 

// --- TWILIO CREDENTIALS---
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER;
const ADMIN_PHONE = process.env.ADMIN_PHONE_NUMBER;

// API KEYS (For Browser Calling)
const API_KEY_SID = process.env.TWILIO_API_KEY_SID;
const API_KEY_SECRET = process.env.TWILIO_API_KEY_SECRET;

// SAFETY CHECK: Ensure keys exist before starting
if (!ACCOUNT_SID || !API_KEY_SID) {
    console.error("CRITICAL ERROR: .env file is missing or empty!");
    console.error("Please create a .env file with your Twilio keys.");
    process.exit(1);
}

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);
const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

// Test Data
let complaints = [];

app.use(cors({ origin: "*", allowedHeaders: ["Content-Type", "ngrok-skip-browser-warning"] }));
app.use(express.json());
app.use(express.static("public")); 
app.use("/uploads", express.static("uploads"));

const upload = multer({ storage: multer.diskStorage({
    destination: (req, file, cb) => { if (!fs.existsSync("uploads")) fs.mkdirSync("uploads"); cb(null, "uploads/"); },
    filename: (req, file, cb) => { cb(null, req.body.id + '-' + Date.now() + path.extname(file.originalname)); }
})});

// API 1: GENERATE WEBRTC TOKEN
app.get("/api/token", (req, res) => {
    const identity = "citizen"; 

    const videoGrant = new VoiceGrant({
        incomingAllow: true, // Allow receiving calls
    });

    const token = new AccessToken(
        ACCOUNT_SID,
        API_KEY_SID,
        API_KEY_SECRET,
        { identity: identity }
    );

    token.addGrant(videoGrant);

    res.json({ token: token.toJwt(), identity: identity });
});

// API 2: REJECT CALL (The Hack)
app.post("/api/reject-complaint", async (req, res) => {
    const { id, reason } = req.body;
    console.log(`Rejecting ${id}. Calling Virtual Citizen...`); 
    try {
        const call = await client.calls.create({
            twiml: `
                <Response>
                    <Say voice="Polly.Aditi" language="hi-IN">
                        नमस्ते। मैं ऑफिसर वाणी बोल रही हूँ।
                        आपकी शिकायत संख्या ${id.split('').join(' ')} को अस्वीकार कर दिया गया है।
                        इसका कारण है: ${reason}।
                        कृपया दोबारा शिकायत दर्ज करें। असुविधा के लिए खेद है।
                    </Say>
                </Response>
            `,
            to: 'client:citizen', 
            from: TWILIO_PHONE
        });
        console.log("WebRTC Call Initiated SID:", call.sid);
        
        const item = complaints.find(c => c.id === id);
        if (item) item.status = "Rejected";

        res.json({ success: true });

    } catch (error) {
        console.error("Twilio Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 📨 API 3: SMS
// ==========================================
// 🚀 API: HANDLE NEW COMPLAINTS (WEB & VAANI)
// ==========================================
app.post("/api/new-complaint", express.json(), async (req, res) => {
    try {
        console.log("📥 Data Received (Web/Vaani):", req.body);

        // 1. Get the data
        const newComplaint = req.body;

        // 2. Validate & Sanitize (Important for Vaani/Web consistency)
        if (!newComplaint.id) newComplaint.id = "SIGW-" + Math.floor(Math.random() * 1000);
        if (!newComplaint.status) newComplaint.status = "Pending";
        if (!newComplaint.date) newComplaint.date = new Date().toISOString().split('T')[0];
        if (!newComplaint.lat) newComplaint.lat = "28.6139"; // Default Delhi
        if (!newComplaint.long) newComplaint.long = "77.2090";

        // 3. Add to the Global Dashboard List (Top of the list)
        complaints.unshift(newComplaint);

        // 4. Send SMS Confirmation (Twilio)
        // This works for both Web forms AND Vaani voice-to-text data
        if (newComplaint.phone && newComplaint.phone.length > 9) {
            
            // Format number for Twilio (+91...)
            let recipient = newComplaint.phone.replace(/\s+/g, '').replace(/-/g, '');
            if (!recipient.startsWith('+')) recipient = '+91' + recipient;

            const uploadLink = `${PUBLIC_URL}/upload.html?id=${newComplaint.id}`;
            
            try {
                await client.messages.create({
                    body: `दिल्ली सुदर्शन\nComplaint Registered!\nID: ${newComplaint.id}\nCategory: ${newComplaint.type}\n\nUpload Evidence:\n${uploadLink}`,
                    from: TWILIO_PHONE,
                    to: recipient
                });
                console.log(`✅ SMS Sent to ${recipient}`);
            } catch (smsError) {
                console.error("⚠️ SMS Failed:", smsError.message);
            }
        }

        // 5. Success Response
        res.json({ success: true, id: newComplaint.id });

    } catch (error) {
        console.error("❌ Server Error:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// Photo Upload
// ==========================================
// 🛡️ API: PHOTO UPLOAD WITH AI VERIFICATION
// ==========================================
app.post("/api/upload-photo", upload.single("photo"), async (req, res) => {
    // 1. Basic Validation
    if (!req.file) return res.json({ success: false, error: "No file uploaded" });

    const filePath = req.file.path;
    const fullImageUrl = `${PUBLIC_URL}/uploads/${req.file.filename}`;
    
    // 2. Find the complaint
    const item = complaints.find(c => c.id === req.body.id);
    if(!item) return res.json({ success: false, error: "Complaint ID not found" });

    try {
        console.log(`🤖 AI Verifying Image for ${item.id}...`);

        // 3. Setup AI Model
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // 4. The Verification Prompt
        const prompt = `
            Analyze this image for a government grievance portal.
            Is this image related to civic issues like: Garbage, Potholes, Water leakage, Broken roads, Street lights, Sewer issues, or Construction debris?
            
            - If YES (it looks like a valid complaint): Respond with "VALID"
            - If NO (it looks like a laptop, selfie, person face, computer screen, animal, or random object): Respond with "INVALID"
        `;

        const imagePart = fileToGenerativePart(filePath, req.file.mimetype);

        // 5. Generate Result
        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const text = response.text().trim();

        console.log(`🤖 AI Verdict: ${text}`);

        // 6. Handle AI Decision
        if (text.includes("VALID")) {
            // ✅ Accepted
            item.img = fullImageUrl; 
            item.status = "Pending"; 
            item.lat = req.body.lat; // Save GPS
            item.long = req.body.long; // Save GPS
            
            res.json({ success: true, url: fullImageUrl, spam: false });
        } else {
            // 🚫 Rejected (Spam)
            console.log("❌ Blocked by AI: Invalid Image");
            
            // Do NOT update the complaint status or image
            // We return 'spam: true' so frontend can show Red Alert
            res.json({ success: false, spam: true });
        }

    } catch (error) {
        console.error("AI Error:", error);
        // Fallback: If AI fails (server error), allow the upload to be safe
        item.img = fullImageUrl;
        item.status = "Pending";
        res.json({ success: true, url: fullImageUrl, warning: "AI Check Skipped" });
    }
});

app.get("/api/new-complaint", (req, res) => res.json(complaints));
// 🕵️‍♂️ API 4:CLUSTER(The "Random Sample" Call)
app.post("/api/audit-cluster", async (req, res) => {
    const { loc, dept, count } = req.body;
    
    console.log(`🕵️‍♂️ Initiating Surprise Audit for ${dept} in ${loc}. Target: Random Citizen.`);

    try {
        const call = await client.calls.create({
            twiml: `
                <Response>
                    <Say voice="Polly.Aditi" language="hi-IN">
                        नमस्ते। यह दिल्ली सुदर्शन से एक सेवा सत्यापन कॉल है।
                        Hello. This is a citizen assurance call from Delhi Sudarshan.
                        The ${dept} department claims to have resolved ${count} issues in ${loc}.
                        As a resident of this area,we request your confirmation.
                        Are you satisfied with the resolution?
                        Press 1 for Yes. Press 2 for No.
                    </Say>
                </Response>
            `,
            to: 'client:citizen', // Rings the browser
            from: TWILIO_PHONE
        });
        console.log("Call Initiated SID:", call.sid);
        res.json({ success: true });

    } catch (error) {
        console.error("Twilio Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==========================================
// 📧 AI EMAIL AGENT (IMAP LISTENER)
// ==========================================

// 1. CONFIGURATION (REPLACE WITH YOUR DETAILS)
const EMAIL_USER = "jkkhandelwal010@gmail.com";
const EMAIL_PASS = "came mnrd fbph bqkf";

const imapConfig = {
    imap: {
        user: EMAIL_USER,
        password: EMAIL_PASS,
        host: 'imap.gmail.com',
        port: 993,
        tls: true,
        authTimeout: 3000
    }
};

// 2. THE AI EMAIL PROCESSOR
async function checkEmails() {
    try {
        const connection = await imap.connect(imapConfig);
        await connection.openBox('INBOX');

        // Search for Unread Emails
        const searchCriteria = ['UNSEEN'];
        const fetchOptions = { bodies: ['HEADER', 'TEXT'], markSeen: true };
        const messages = await connection.search(searchCriteria, fetchOptions);

        if (messages.length === 0) {
            connection.end();
            return;
        }

        console.log(`📧 Found ${messages.length} new emails! AI Processing...`);

        for (const item of messages) {
            const all = item.parts.find(part => part.which === 'TEXT');
            const id = item.attributes.uid;
            const idHeader = "Imap-Id: "+id + "\r\n";
            
            // Parse Email Body
            const mail = await simpleParser(idHeader + all.body);
            const emailBody = mail.text; 

            // 🤖 USE GEMINI TO EXTRACT DATA
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            const prompt = `
                Analyze this email text and extract complaint details for a government portal.
                
                EMAIL TEXT: "${emailBody}"
                
                Task: Extract these fields into JSON: 
                - name (Citizen Name)
                - phone (Mobile Number)
                - type (Complaint Type e.g., Pothole, Garbage, Street Light)
                - loc (Location)
                - desc (Description)
                
                Rules:
                - If phone is missing, use "+91 00000 00000".
                - If type is unclear, categorize it as "General Grievance".
                - Return ONLY valid JSON. No Markdown.
            `;

            const result = await model.generateContent(prompt);
            const response = await result.response;
            // Clean up Markdown formatting if Gemini adds it
            let text = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
            
            try {
                const data = JSON.parse(text);
                
                // REGISTER THE COMPLAINT
                const newComplaint = {
                    id: "MAIL-" + Math.floor(1000 + Math.random() * 9000),
                    type: data.type,
                    loc: data.loc,
                    status: "Pending",
                    date: new Date().toISOString().split('T')[0],
                    phone: data.phone,
                    dept: "Auto-Assigned",
                    desc: data.desc + ` (Via Email: ${data.name})`,
                    img: "",
                    lat: "28.6139", 
                    long: "77.2090"
                };

                // Add to Global Array
                complaints.unshift(newComplaint);
                console.log(`✅ Email Converted to Complaint: ${newComplaint.id}`);

                // SEND SMS (Reuse logic)
                sendEmailSMS(newComplaint);

            } catch (jsonErr) {
                console.error("❌ AI Parsing Failed:", text);
            }
        }
        
        connection.end();

    } catch (error) {
        // console.error("IMAP Error (Ignore if just connection timeout):", error.message);
    }
}

// 3. HELPER SMS FUNCTION
async function sendEmailSMS(data) {
    if (!data.phone || data.phone.includes("00000")) return;
    
    let recipient = data.phone.replace(/\s+/g, '').replace(/-/g, '');
    if (!recipient.startsWith('+')) recipient = '+91' + recipient;

    const uploadLink = `${PUBLIC_URL}/upload.html?id=${data.id}`;

    try {
        await client.messages.create({
            body: `दिल्ली सुदर्शन\nEmail Received!\nComplaint ID: ${data.id}\nStatus: Registered\n\nUpload Evidence here:\n${uploadLink}`,
            from: TWILIO_PHONE,
            to: recipient
        });
        console.log(`📩 SMS Sent to ${recipient}`);
    } catch (err) {
        console.error("SMS Failed:", err.message);
    }
}

// 4. RUN CHECKER EVERY 30 SECONDS
setInterval(checkEmails, 30000);
console.log("📧 AI Email Agent Started...");

app.get("/api/new-complaint", (req, res) => {
    // Send the live list of complaints to the frontend
    res.json(complaints);
});

app.listen(5000, () => console.log("Backend running on http://localhost:5000"));







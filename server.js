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

// GEMINI AI INITIALIZATION
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ENHANCED SAFETY CHECK with Diagnostics
console.log("🔍 Checking Twilio Configuration...");
console.log("Account SID exists:", !!ACCOUNT_SID, ACCOUNT_SID ? `(${ACCOUNT_SID.substring(0, 6)}...)` : "MISSING");
console.log("Auth Token exists:", !!AUTH_TOKEN);
console.log("API Key SID exists:", !!API_KEY_SID, API_KEY_SID ? `(${API_KEY_SID.substring(0, 6)}...)` : "MISSING");
console.log("API Key Secret exists:", !!API_KEY_SECRET);
console.log("Twilio Phone exists:", !!TWILIO_PHONE);

if (!ACCOUNT_SID || !AUTH_TOKEN) {
    console.error("❌ CRITICAL: Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
    process.exit(1);
}

if (!API_KEY_SID || !API_KEY_SECRET) {
    console.error("❌ CRITICAL: Missing TWILIO_API_KEY_SID or TWILIO_API_KEY_SECRET");
    console.error("⚠️  You need to create a NEW API Key in Twilio Console:");
    console.error("    1. Go to: https://console.twilio.com/us1/develop/voice/settings/api-keys");
    console.error("    2. Click 'Create API Key'");
    console.error("    3. Save BOTH the SID and Secret immediately!");
    process.exit(1);
}

// Verify Account SID and API Key SID formats
if (!ACCOUNT_SID.startsWith('AC')) {
    console.error("❌ ACCOUNT_SID must start with 'AC'. Got:", ACCOUNT_SID.substring(0, 6));
    process.exit(1);
}

if (!API_KEY_SID.startsWith('SK')) {
    console.error("❌ API_KEY_SID must start with 'SK'. Got:", API_KEY_SID.substring(0, 6));
    console.error("⚠️  Make sure you're using the API Key SID, not the Auth Token!");
    process.exit(1);
}

console.log("✅ Twilio credentials format looks correct");

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

// HELPER FUNCTION FOR AI IMAGE PROCESSING
function fileToGenerativePart(filePath, mimeType) {
    return {
        inlineData: {
            data: fs.readFileSync(filePath).toString("base64"),
            mimeType
        },
    };
}

// API 1: GENERATE WEBRTC TOKEN (WITH ENHANCED ERROR HANDLING)
app.get("/api/token", (req, res) => {
    try {
        console.log("📞 Token request received");
        
        const identity = "citizen"; 

        const voiceGrant = new VoiceGrant({
            incomingAllow: true,
            outgoingApplicationSid: undefined, // Not using TwiML app
        });

        const token = new AccessToken(
            ACCOUNT_SID,
            API_KEY_SID,
            API_KEY_SECRET,
            { 
                identity: identity,
                ttl: 3600 // Token valid for 1 hour
            }
        );

        token.addGrant(voiceGrant);
        const jwt = token.toJwt();

        console.log("✅ Token generated successfully for identity:", identity);
        
        res.json({ 
            token: jwt, 
            identity: identity 
        });

    } catch (error) {
        console.error("❌ Token Generation Error:", error.message);
        console.error("Stack:", error.stack);
        
        res.status(500).json({ 
            success: false,
            error: "Failed to generate token",
            message: error.message,
            hint: "Check if your Twilio API Key is valid and belongs to the correct account"
        });
    }
});

// DIAGNOSTIC ENDPOINT (Remove after debugging)
app.get("/api/test-credentials", (req, res) => {
    res.json({
        accountSid: ACCOUNT_SID ? `${ACCOUNT_SID.substring(0, 6)}...${ACCOUNT_SID.substring(ACCOUNT_SID.length - 4)}` : "MISSING",
        apiKeySid: API_KEY_SID ? `${API_KEY_SID.substring(0, 6)}...${API_KEY_SID.substring(API_KEY_SID.length - 4)}` : "MISSING",
        hasAuthToken: !!AUTH_TOKEN,
        hasApiSecret: !!API_KEY_SECRET,
        hasTwilioPhone: !!TWILIO_PHONE,
        hasGeminiKey: !!GEMINI_API_KEY,
        formatCheck: {
            accountSidValid: ACCOUNT_SID?.startsWith('AC'),
            apiKeySidValid: API_KEY_SID?.startsWith('SK')
        }
    });
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
        console.log("✅ WebRTC Call Initiated SID:", call.sid);
        
        const item = complaints.find(c => c.id === id);
        if (item) item.status = "Rejected";

        res.json({ success: true, callSid: call.sid });

    } catch (error) {
        console.error("❌ Twilio Call Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API 3: HANDLE NEW COMPLAINTS
app.post("/api/new-complaint", express.json(), async (req, res) => {
    try {
        console.log("📥 Data Received (Web/Vaani):", req.body);

        const newComplaint = req.body;

        // Validate & Sanitize
        if (!newComplaint.id) newComplaint.id = "SIGW-" + Math.floor(Math.random() * 1000);
        if (!newComplaint.status) newComplaint.status = "Pending";
        if (!newComplaint.date) newComplaint.date = new Date().toISOString().split('T')[0];
        if (!newComplaint.lat) newComplaint.lat = "28.6139";
        if (!newComplaint.long) newComplaint.long = "77.2090";

        complaints.unshift(newComplaint);

        // Send SMS Confirmation
        if (newComplaint.phone && newComplaint.phone.length > 9) {
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

        res.json({ success: true, id: newComplaint.id });

    } catch (error) {
        console.error("❌ Server Error:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// API 4: PHOTO UPLOAD WITH AI VERIFICATION
app.post("/api/upload-photo", upload.single("photo"), async (req, res) => {
    if (!req.file) return res.json({ success: false, error: "No file uploaded" });

    const filePath = req.file.path;
    const fullImageUrl = `${PUBLIC_URL}/uploads/${req.file.filename}`;
    
    const item = complaints.find(c => c.id === req.body.id);
    if(!item) return res.json({ success: false, error: "Complaint ID not found" });

    try {
        console.log(`🤖 AI Verifying Image for ${item.id}...`);

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
            Analyze this image for a government grievance portal.
            Is this image related to civic issues like: Garbage, Potholes, Water leakage, Broken roads, Street lights, Sewer issues, or Construction debris?
            
            - If YES (it looks like a valid complaint): Respond with "VALID"
            - If NO (it looks like a laptop, selfie, person face, computer screen, animal, or random object): Respond with "INVALID"
        `;

        const imagePart = fileToGenerativePart(filePath, req.file.mimetype);
        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const text = response.text().trim();

        console.log(`🤖 AI Verdict: ${text}`);

        if (text.includes("VALID")) {
            item.img = fullImageUrl; 
            item.status = "Pending"; 
            item.lat = req.body.lat;
            item.long = req.body.long;
            res.json({ success: true, url: fullImageUrl, spam: false });
        } else {
            console.log("❌ Blocked by AI: Invalid Image");
            res.json({ success: false, spam: true });
        }

    } catch (error) {
        console.error("AI Error:", error);
        item.img = fullImageUrl;
        item.status = "Pending";
        res.json({ success: true, url: fullImageUrl, warning: "AI Check Skipped" });
    }
});

app.get("/api/complaints", (req, res) => res.json(complaints));

// API 5: CLUSTER AUDIT
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
            to: 'client:citizen',
            from: TWILIO_PHONE
        });
        console.log("✅ Call Initiated SID:", call.sid);
        res.json({ success: true, callSid: call.sid });

    } catch (error) {
        console.error("❌ Twilio Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// EMAIL AGENT CONFIGURATION
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

// AI EMAIL PROCESSOR
async function checkEmails() {
    try {
        const connection = await imap.connect(imapConfig);
        await connection.openBox('INBOX');

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
            
            const mail = await simpleParser(idHeader + all.body);
            const emailBody = mail.text; 

            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
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
            let text = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
            
            try {
                const data = JSON.parse(text);
                
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

                complaints.unshift(newComplaint);
                console.log(`✅ Email Converted to Complaint: ${newComplaint.id}`);
                sendEmailSMS(newComplaint);

            } catch (jsonErr) {
                console.error("❌ AI Parsing Failed:", text);
            }
        }
        
        connection.end();

    } catch (error) {
        // Silently handle IMAP errors
    }
}

// HELPER SMS FUNCTION
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

// RUN EMAIL CHECKER EVERY 30 SECONDS
setInterval(checkEmails, 30000);
console.log("📧 AI Email Agent Started...");

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Backend running on port ${PORT}`);
    console.log(`📍 Public URL: ${PUBLIC_URL}`);
    console.log(`🔑 Twilio Account: ${ACCOUNT_SID.substring(0, 10)}...`);
});

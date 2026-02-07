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
import sgMail from '@sendgrid/mail';

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

const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// SENDGRID CONFIGURATION
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;

// EMAIL CONFIGURATION
const EMAIL_USER = "grievancedelhicivic@gmail.com";
const EMAIL_PASS = "qngl tpqu ppbd hmlt";
const VERIFIED_SENDER = "grievancedelhicivic@gmail.com";

// Initialize SendGrid only if API key exists
if (SENDGRID_API_KEY) {
    sgMail.setApiKey(SENDGRID_API_KEY);
    console.log("✅ SendGrid API Key configured");
} else {
    console.warn("⚠️  WARNING: SENDGRID_API_KEY not found in environment variables");
    console.warn("⚠️  Email auto-replies will be disabled");
}

// SAFETY CHECK
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
let auditResults = {};

app.use(cors({ origin: "*", allowedHeaders: ["Content-Type", "ngrok-skip-browser-warning"] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public")); 
app.use("/uploads", express.static("uploads"));

const upload = multer({ storage: multer.diskStorage({
    destination: (req, file, cb) => { if (!fs.existsSync("uploads")) fs.mkdirSync("uploads"); cb(null, "uploads/"); },
    filename: (req, file, cb) => { cb(null, req.body.id + '-' + Date.now() + path.extname(file.originalname)); }
})});

// HELPER FUNCTION
function fileToGenerativePart(path, mimeType) {
  return {
    inlineData: {
      data: fs.readFileSync(path).toString("base64"),
      mimeType
    },
  };
}

// SENDGRID EMAIL AUTO-REPLY FUNCTION
async function sendAutoReplyEmail(recipientEmail, complaintData) {
    if (!SENDGRID_API_KEY) {
        console.log("⚠️  SendGrid not configured, skipping email auto-reply");
        return false;
    }

    const uploadLink = `${PUBLIC_URL}/upload.html?id=${complaintData.id}`;
    
    const msg = {
        to: recipientEmail,
        from: {
            email: VERIFIED_SENDER,
            name: 'Delhi Sudarshan - Grievance Portal'
        },
        subject: `✅ Complaint Registered - ID: ${complaintData.id}`,
        html: `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; border-left: 4px solid #667eea; }
        .info-row { margin: 10px 0; }
        .label { font-weight: bold; color: #667eea; }
        .button { display: inline-block; background: #667eea; color: white !important; padding: 15px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
        .button:hover { background: #764ba2; }
        .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; }
        .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏛️ दिल्ली सुदर्शन</h1>
            <p style="margin: 10px 0 0 0; font-size: 14px;">Citizen Grievance Portal</p>
        </div>
        
        <div class="content">
            <h2 style="color: #28a745; margin-top: 0;">✅ Complaint Successfully Registered!</h2>
            
            <p>Dear Citizen,</p>
            
            <p>Thank you for reaching out to Delhi Sudarshan. Your complaint has been successfully registered in our system and will be forwarded to the concerned department.</p>
            
            <div class="info-box">
                <h3 style="margin-top: 0; color: #667eea;">📋 Complaint Details</h3>
                <div class="info-row">
                    <span class="label">Complaint ID:</span> ${complaintData.id}
                </div>
                <div class="info-row">
                    <span class="label">Type:</span> ${complaintData.type || 'General Grievance'}
                </div>
                <div class="info-row">
                    <span class="label">Location:</span> ${complaintData.loc || 'Delhi'}
                </div>
                <div class="info-row">
                    <span class="label">Status:</span> <span style="color: #ffc107; font-weight: bold;">Pending Review</span>
                </div>
                <div class="info-row">
                    <span class="label">Date Registered:</span> ${complaintData.date}
                </div>
            </div>
            
            <div class="warning">
                <strong>⚠️ Important Next Step:</strong><br>
                To expedite the resolution of your complaint, please upload supporting evidence (photos/documents) using the link below:
            </div>
            
            <div style="text-align: center;">
                <a href="${uploadLink}" class="button">📤 Upload Evidence</a>
            </div>
            
            <p style="font-size: 14px; color: #666; margin-top: 20px;">
                <strong>What happens next?</strong><br>
                1. Our AI system will verify your uploaded evidence<br>
                2. Your complaint will be assigned to the relevant department<br>
                3. You will receive updates via email and SMS<br>
                4. The department will work to resolve your issue
            </p>
            
            <div class="footer">
                <p><strong>Need Help?</strong></p>
                <p>Reply to this email or contact us at:<br>
                📧 ${VERIFIED_SENDER}<br>
                📞 Support: 1800-XXX-XXXX</p>
                
                <p style="margin-top: 20px;">
                    This is an automated message from Delhi Sudarshan Grievance Portal.<br>
                    Please do not reply directly to this email for new complaints.
                </p>
                
                <p style="margin-top: 20px; font-size: 11px; color: #999;">
                    © 2025 Delhi Sudarshan. All rights reserved.
                </p>
            </div>
        </div>
    </div>
</body>
</html>
        `,
        text: `
Delhi Sudarshan - Complaint Registered

Dear Citizen,

Your complaint has been successfully registered!

Complaint Details:
- ID: ${complaintData.id}
- Type: ${complaintData.type || 'General Grievance'}
- Location: ${complaintData.loc || 'Delhi'}
- Status: Pending Review
- Date: ${complaintData.date}

IMPORTANT: Please upload supporting evidence (photos/documents) here:
${uploadLink}

What happens next?
1. Our AI system will verify your uploaded evidence
2. Your complaint will be assigned to the relevant department
3. You will receive updates via email and SMS
4. The department will work to resolve your issue

Thank you for using Delhi Sudarshan Grievance Portal.

---
This is an automated message.
        `
    };

    try {
        await sgMail.send(msg);
        console.log(`📧 ✅ SendGrid: Auto-reply email sent to ${recipientEmail}`);
        return true;
    } catch (error) {
        console.error(`❌ SendGrid Error sending to ${recipientEmail}:`, error.message);
        if (error.response) {
            console.error(`   Status Code: ${error.response.statusCode}`);
            console.error(`   Error Body:`, JSON.stringify(error.response.body, null, 2));
        }
        return false;
    }
}

// API 1: GENERATE WEBRTC TOKEN
app.get("/api/token", (req, res) => {
    const identity = "citizen"; 

    const videoGrant = new VoiceGrant({
        incomingAllow: true,
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

// API 2: REJECT CALL
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

// API 3: NEW COMPLAINT
app.post("/api/new-complaint", express.json(), async (req, res) => {
    try {
        console.log("📥 Data Received (Web/Vaani/Email):", req.body);

        const newComplaint = req.body;

        // Validate & Sanitize
        if (!newComplaint.id) newComplaint.id = "SIG-" + Math.floor(1000 + Math.random() * 9000);
        if (!newComplaint.status) newComplaint.status = "Pending";
        if (!newComplaint.date) newComplaint.date = new Date().toISOString().split('T')[0];
        if (!newComplaint.lat) newComplaint.lat = "28.6139";
        if (!newComplaint.long) newComplaint.long = "77.2090";

        // Add to Dashboard
        complaints.unshift(newComplaint);
        console.log(`✅ Complaint added to dashboard. Total complaints: ${complaints.length}`);

        // Send SMS Confirmation
        if (newComplaint.phone && newComplaint.phone.length > 9 && newComplaint.phone !== "Not Provided") {
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

// Photo Upload API
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

        console.log(`🤖 AI Verdict: [${text}]`);

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

// GET complaints endpoint
app.get("/api/new-complaint", (req, res) => {
    console.log(`📊 Dashboard requesting complaints. Current count: ${complaints.length}`);
    res.json(complaints);
});

// API 4: CITIZEN ASSURANCE CALL
app.post("/api/audit-cluster", async (req, res) => {
    const { loc, dept, count } = req.body;
    console.log(`Starting Audit: ${dept} in ${loc}`);

    try {
        const call = await client.calls.create({
            url: `${PUBLIC_URL}/api/audit-ivr?dept=${encodeURIComponent(dept)}&loc=${encodeURIComponent(loc)}`, 
            to: 'client:citizen', 
            from: TWILIO_PHONE
        });
        
        auditResults[call.sid] = 'pending'; 
        console.log("Call SID:", call.sid);
        res.json({ success: true, callSid: call.sid });

    } catch (error) {
        console.error("Twilio Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post("/api/audit-ivr", (req, res) => {
    const { dept, loc } = req.query; 
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        numDigits: 1,
        action: '/api/audit-result',
        method: 'POST',
        timeout: 10
    });

    gather.say({ voice: 'Polly.Aditi', language: 'hi-IN' }, 
        `नमस्ते। यह दिल्ली सुदर्शन से एक सेवा सत्यापन कॉल है। ${dept} विभाग का दावा है कि उन्होंने आपकी समस्या का समाधान कर दिया है। ${loc} क्षेत्र के निवासी होने के नाते, क्या आप इस कार्य से संतुष्ट हैं? हाँ के लिए 1 दबाएँ। नहीं के लिए 2 दबाएँ।`
    );

    twiml.say({ voice: 'Polly.Aditi', language: 'hi-IN' }, "हमें कोई इनपुट नहीं मिला। धन्यवाद।");
    res.type('text/xml');
    res.send(twiml.toString());
});

app.post("/api/audit-result", (req, res) => {
    const digits = req.body.Digits;
    const callSid = req.body.CallSid;
    
    console.log(`Call ${callSid} pressed: ${digits}`);
    auditResults[callSid] = digits; 

    const twiml = new twilio.twiml.VoiceResponse();
    if (digits === '1') {
        twiml.say({ voice: 'Polly.Aditi', language: 'hi-IN' }, "पुष्टि करने के लिए धन्यवाद। आपका दिन शुभ हो।");
    } else {
        twiml.say({ voice: 'Polly.Aditi', language: 'hi-IN' }, "धन्यवाद। हम इसकी जांच करेंगे।");
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

app.get("/api/check-audit-status/:sid", (req, res) => {
    const sid = req.params.sid;
    const status = auditResults[sid] || 'pending';
    res.json({ status: status });
});

// ==========================================
// 📧 AI EMAIL AGENT (FIXED HEADER PARSING)
// ==========================================
const imapConfig = {
    imap: {
        user: EMAIL_USER,
        password: EMAIL_PASS,
        host: 'imap.gmail.com',
        port: 993,
        tls: true,
        authTimeout: 10000,
        tlsOptions: { rejectUnauthorized: false }
    }
};

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

        console.log(`📧 Found ${messages.length} NEW emails! Processing...`);

        for (const item of messages) {
            // 1. FETCH BOTH HEADER AND BODY
            const headerPart = item.parts.find(part => part.which === 'HEADER');
            const textPart = item.parts.find(part => part.which === 'TEXT');

            if (!headerPart || !textPart) {
                console.log("⚠️ Skipping email (Missing Header or Text part)");
                continue;
            }

            // 2. COMBINE THEM (Crucial Step for 'mailparser')
            // We stitch the raw header and the raw body together so the parser sees the "From" field.
            const fullEmailSource = headerPart.body + textPart.body;
            
            // 3. PARSE
            const mail = await simpleParser(fullEmailSource);
            
            // 4. EXTRACT SENDER SAFELY
            const senderEmail = mail.from?.value?.[0]?.address || mail.from?.text || "unknown@example.com";
            const senderName = mail.from?.value?.[0]?.name || "Citizen";

            console.log(`📨 Processing email from: ${senderEmail} (${senderName})`);

            // AI PROCESSING
            try {
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                const result = await model.generateContent(`
                    Extract JSON (name, phone, type, loc, desc) from email text: 
                    "${mail.text}". 
                    If phone missing, use "Not Provided".
                    Return ONLY raw JSON.
                `);
                
                let text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
                const data = JSON.parse(text);
                
                const newId = "MAIL-" + Math.floor(Math.random() * 9000);
                
                const newComplaint = {
                    id: newId, 
                    type: data.type || "General",
                    loc: data.loc || "Delhi",
                    status: "Pending",
                    date: new Date().toISOString().split('T')[0], 
                    phone: data.phone,
                    dept: "Auto-Assigned", 
                    desc: data.desc + ` (Email: ${data.name || senderName})`,
                    img: "", 
                    lat: "28.6139", 
                    long: "77.2090",
                    email: senderEmail // Store for dashboard use
                };

                // ADD TO DASHBOARD LIST
                complaints.unshift(newComplaint);
                console.log(`✅ Registered Complaint: ${newId}`);

                // SEND AUTO-REPLY (Only if email is valid)
                if (senderEmail && !senderEmail.includes('unknown')) {
                    await sendAutoReplyEmail(senderEmail, newComplaint);
                } else {
                    console.warn(`⚠️ Cannot send auto-reply - invalid sender email: ${senderEmail}`);
                }

            } catch (aiError) { 
                console.error("❌ AI/Parsing Error:", aiError.message); 
            }
        }
        
        connection.end();

    } catch (error) {
        console.error("⚠️ IMAP Connection Error:", error.message);
    }
}

// HELPER SMS FUNCTION
async function sendComplaintSMS(data) {
    if (!data.phone || data.phone === "Not Provided") return;
    
    let recipient = data.phone.replace(/\s+/g, '').replace(/-/g, '');
    if (!recipient.startsWith('+')) recipient = '+91' + recipient;

    const uploadLink = `${PUBLIC_URL}/upload.html?id=${data.id}`;

    try {
        await client.messages.create({
            body: `दिल्ली सुदर्शन\nEmail Complaint Registered!\nID: ${data.id}\nStatus: Pending\n\nUpload Evidence:\n${uploadLink}`,
            from: TWILIO_PHONE,
            to: recipient
        });
        console.log(`📩 SMS Sent to ${recipient}`);
    } catch (err) {
        console.error("❌ SMS Failed:", err.message);
    }
}

// RUN EMAIL CHECKER EVERY 30 SECONDS
const emailCheckInterval = setInterval(checkEmails, 30000);
console.log("📧 Email checker scheduled - runs every 30 seconds");

// Also run once immediately on startup
setTimeout(() => {
    console.log("📧 Running initial email check...");
    checkEmails();
}, 5000); // Wait 5 seconds after startup

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log("\n========================================");
    console.log(`🚀 Backend running on port ${PORT}`);
    console.log(`📍 Public URL: ${PUBLIC_URL}`);
    console.log(`📧 Email: ${EMAIL_USER}`);
    console.log(`📊 Complaints in memory: ${complaints.length}`);
    
    if (SENDGRID_API_KEY) {
        console.log(`✅ SendGrid configured`);
    } else {
        console.log(`⚠️  SendGrid NOT configured - set SENDGRID_API_KEY env variable`);
    }
    
    console.log("========================================\n");
    console.log("✅ Server is ready and listening for requests");
});



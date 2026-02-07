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
import { fileURLToPath } from 'url';

// --- CONFIGURATION ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 5000;
const PUBLIC_URL = "https://lean-hacks-backend.onrender.com"; // ⚠️ Verify this matches your Render URL

// --- CREDENTIALS ---
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER;
const API_KEY_SID = process.env.TWILIO_API_KEY_SID;
const API_KEY_SECRET = process.env.TWILIO_API_KEY_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- SAFETY CHECK ---
if (!ACCOUNT_SID || !API_KEY_SID || !API_KEY_SECRET) {
    console.error("❌ CRITICAL: Missing Keys in .env file");
    // We don't exit process so you can at least see logs, but app won't work fully
}

// --- INITIALIZE SERVICES ---
const client = twilio(ACCOUNT_SID, AUTH_TOKEN);
const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Static Files (Fixed pathing)
app.use(express.static(__dirname)); 
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// --- DATA STORE ---
let complaints = [];

// --- FILE UPLOAD ---
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
const upload = multer({ storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, req.body.id + '-' + Date.now() + path.extname(file.originalname))
})});

// ==========================================
// 📞 API 1: GENERATE WEBRTC TOKEN (FIXED)
// ==========================================
app.get("/api/token", (req, res) => {
    try {
        const identity = "citizen"; 
        console.log("🎟️ Generating Token for:", identity);

        const videoGrant = new VoiceGrant({
            incomingAllow: true, // Allow receiving calls
            outgoingApplicationSid: process.env.TWILIO_APP_SID // Optional
        });

        const token = new AccessToken(
            ACCOUNT_SID,    // ✅ FIXED: Was TWILIO_ACCOUNT_SID
            API_KEY_SID,    // ✅ FIXED: Was TWILIO_API_KEY_SID
            API_KEY_SECRET, // ✅ FIXED: Was TWILIO_API_KEY_SECRET
            { identity: identity }
        );

        token.addGrant(videoGrant);
        res.json({ token: token.toJwt(), identity: identity });
        
    } catch (error) {
        console.error("❌ Token Error:", error);
        res.status(500).json({ error: "Token generation failed" });
    }
});

// ==========================================
// 🚀 API 2: NEW COMPLAINT (Unified)
// ==========================================
app.get("/api/new-complaint", (req, res) => res.json(complaints));

app.post("/api/new-complaint", async (req, res) => {
    try {
        console.log("📥 New Complaint:", req.body.id || "Unknown");
        const data = req.body;

        const complaint = {
            id: data.id || "WEB-" + Math.floor(Math.random() * 10000),
            type: data.type || "General",
            loc: data.loc || "Delhi",
            status: "Pending",
            date: new Date().toISOString().split('T')[0],
            phone: data.phone,
            dept: data.dept || "Auto-Assigned",
            desc: data.desc,
            lat: data.lat || "28.6139",
            long: data.long || "77.2090",
            img: ""
        };

        complaints.unshift(complaint);

        // Send SMS
        if (complaint.phone && complaint.phone.length > 9) {
            let recipient = complaint.phone.replace(/\s+/g, '').replace(/-/g, '');
            if (!recipient.startsWith('+')) recipient = '+91' + recipient;
            
            const uploadLink = `${PUBLIC_URL}/upload.html?id=${complaint.id}`;
            client.messages.create({
                body: `दिल्ली सुदर्शन\nID: ${complaint.id}\nStatus: Registered\nUpload Proof: ${uploadLink}`,
                from: TWILIO_PHONE,
                to: recipient
            }).catch(e => console.error("SMS Failed:", e.message));
        }

        res.json({ success: true, id: complaint.id });

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ success: false });
    }
});

// ==========================================
// 🕵️‍♂️ API 3: AUDIT CALL & REJECT
// ==========================================
app.post("/api/audit-cluster", async (req, res) => {
    const { loc, dept, count } = req.body;
    console.log(`🕵️‍♂️ Auditing ${dept} in ${loc}`);

    try {
        await client.calls.create({
            twiml: `<Response><Say voice="Polly.Aditi" language="hi-IN">नमस्ते। दिल्ली सुदर्शन से कॉल। ${dept} विभाग ने ${loc} में ${count} समस्याएं हल की हैं। क्या आप संतुष्ट हैं? हाँ के लिए 1 दबाएँ।</Say></Response>`,
            to: 'client:citizen',
            from: TWILIO_PHONE
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/api/reject-complaint", async (req, res) => {
    const { id, reason } = req.body;
    console.log(`❌ Rejecting ${id}`);
    try {
        await client.calls.create({
            twiml: `<Response><Say voice="Polly.Aditi" language="hi-IN">नमस्ते। आपकी शिकायत संख्या ${id.split('').join(' ')} अस्वीकार कर दी गई है। कारण: ${reason}।</Say></Response>`,
            to: 'client:citizen',
            from: TWILIO_PHONE
        });
        const item = complaints.find(c => c.id === id);
        if (item) item.status = "Rejected";
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 📸 API 4: PHOTO UPLOAD (Gemini)
// ==========================================
function fileToGenerativePart(path, mimeType) {
    return { inlineData: { data: fs.readFileSync(path).toString("base64"), mimeType } };
}

app.post("/api/upload-photo", upload.single("photo"), async (req, res) => {
    if (!req.file) return res.json({ success: false });
    const fullImageUrl = `${PUBLIC_URL}/uploads/${req.file.filename}`;
    const item = complaints.find(c => c.id === req.body.id);

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent([
            `ACT AS: Inspector. VALIDATE if this image shows a civic issue. REJECT screens/selfies. Output VALID or INVALID.`,
            fileToGenerativePart(req.file.path, req.file.mimetype)
        ]);
        const text = result.response.text().trim();

        if (text === "VALID") {
            if(item) { item.img = fullImageUrl; item.status = "Pending"; }
            res.json({ success: true, url: fullImageUrl, spam: false });
        } else {
            res.json({ success: false, spam: true });
        }
    } catch (e) {
        if(item) item.img = fullImageUrl;
        res.json({ success: true, warning: "AI Skipped" });
    }
});

// ==========================================
// 📧 API 5: EMAIL AGENT
// ==========================================
const EMAIL_USER = "jkkhandelwal010@gmail.com";
const EMAIL_PASS = "came mnrd fbph bqkf";

const imapConfig = {
    imap: { user: EMAIL_USER, password: EMAIL_PASS, host: 'imap.gmail.com', port: 993, tls: true, authTimeout: 3000 }
};

async function checkEmails() {
    try {
        const connection = await imap.connect(imapConfig);
        await connection.openBox('INBOX');
        const messages = await connection.search(['UNSEEN'], { bodies: ['HEADER', 'TEXT'], markSeen: true });

        if (messages.length > 0) {
            console.log(`📧 Processing ${messages.length} emails...`);
            for (const item of messages) {
                const all = item.parts.find(part => part.which === 'TEXT');
                const mail = await simpleParser("Imap-Id: "+item.attributes.uid + "\r\n" + all.body);
                
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                const result = await model.generateContent(`Extract JSON (name, phone, type, loc, desc) from: "${mail.text}". Default phone: "+910000000000".`);
                
                try {
                    const data = JSON.parse(result.response.text().replace(/```json/g, '').replace(/```/g, '').trim());
                    const newId = "MAIL-" + Math.floor(Math.random() * 9000);
                    complaints.unshift({
                        id: newId, type: data.type, loc: data.loc, status: "Pending",
                        date: new Date().toISOString().split('T')[0], phone: data.phone,
                        dept: "Auto-Assigned", desc: data.desc + ` (Email: ${data.name})`,
                        img: "", lat: "28.6139", long: "77.2090"
                    });
                    console.log(`✅ Email Registered: ${newId}`);
                } catch (e) { console.error("AI Parse Error"); }
            }
        }
        connection.end();
    } catch (e) {}
}
setInterval(checkEmails, 30000);

// --- START SERVER ---
app.listen(port, () => console.log(`✅ Server running on http://localhost:${port}`));

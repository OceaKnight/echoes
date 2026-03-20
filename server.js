const express  = require("express");
const fs       = require("fs");
const cors     = require("cors");
const path     = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
});

/* serve the website */
app.use(express.static(path.join(__dirname)));

/* file locations */
const FRAGMENTS_FILE = path.join(__dirname, "data", "fragments.json");
const DRAFTS_FILE    = path.join(__dirname, "data", "drafts.json");
const BACKUP_DIR     = path.join(__dirname, "data", "backups");


/* ============================================================
   SANITIZATION
   ============================================================ */

function sanitize(str) {
    if (typeof str !== "string") return "";
    return str
        .replace(/&/g,  "&amp;")
        .replace(/</g,  "&lt;")
        .replace(/>/g,  "&gt;")
        .replace(/"/g,  "&quot;")
        .replace(/'/g,  "&#x27;")
        .trim();
}

function sanitizeFragment(fragment) {
    if (fragment.title)  fragment.title  = sanitize(fragment.title);
    if (fragment.lines)  fragment.lines  = fragment.lines.map(line => sanitize(line));
    if (fragment.status) fragment.status = sanitize(fragment.status);
    return fragment;
}


/* ============================================================
   HELPERS
   ============================================================ */

function readFragments() {
    const data = fs.readFileSync(FRAGMENTS_FILE, "utf8");
    return JSON.parse(data);
}

function writeFragments(data) {
    fs.writeFileSync(FRAGMENTS_FILE, JSON.stringify(data, null, 2));
}

function readDrafts() {
    if (!fs.existsSync(DRAFTS_FILE)) {
        fs.writeFileSync(DRAFTS_FILE, "[]");
    }
    const data = fs.readFileSync(DRAFTS_FILE, "utf8");
    return JSON.parse(data);
}

function writeDrafts(data) {
    fs.writeFileSync(DRAFTS_FILE, JSON.stringify(data, null, 2));
}

function calcWordCount(lines) {
    return lines.join(" ").split(/\s+/).filter(Boolean).length;
}


/* ============================================================
   BACKUP
   ============================================================ */

function createBackup() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const now   = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 16);

    /* backup fragments */
    const fragBackup = path.join(BACKUP_DIR, `fragments_${stamp}.json`);
    fs.copyFileSync(FRAGMENTS_FILE, fragBackup);
    console.log(`[BACKUP] Created: fragments_${stamp}.json`);

    /* backup drafts */
    if (fs.existsSync(DRAFTS_FILE)) {
        const draftBackup = path.join(BACKUP_DIR, `drafts_${stamp}.json`);
        fs.copyFileSync(DRAFTS_FILE, draftBackup);
        console.log(`[BACKUP] Created: drafts_${stamp}.json`);
    }

    /* keep only last 7 backups of each type */
    ["fragments", "drafts"].forEach(type => {
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith(`${type}_`))
            .sort();

        if (files.length > 7) {
            files.slice(0, files.length - 7).forEach(f => {
                fs.unlinkSync(path.join(BACKUP_DIR, f));
                console.log(`[BACKUP] Removed old backup: ${f}`);
            });
        }
    });
}

/* backup on startup and every 24 hours */
createBackup();
setInterval(createBackup, 24 * 60 * 60 * 1000);


/* ============================================================
   AUTH
   ============================================================ */

const EDITOR_PASSWORD = process.env.EDITOR_PASSWORD || "113111";

app.post("/api/auth", (req, res) => {
    if (req.body.password === EDITOR_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false });
    }
});


/* ============================================================
   GET all fragments
   ============================================================ */

app.get("/api/fragments", (req, res) => {
    const fragments = readFragments();
    res.json(fragments);
});


/* ============================================================
   POST — publish new fragment
   ============================================================ */

app.post("/api/fragments", (req, res) => {
    sanitizeFragment(req.body);

    const fragments = readFragments();
    const wordCount = calcWordCount(req.body.lines);

    req.body.id        = uuidv4();
    req.body.createdAt = req.body.createdAt || new Date().toISOString();
    req.body.updatedAt = new Date().toISOString();
    req.body.wordCount = wordCount;
    req.body.readTime  = Math.ceil(wordCount / 200);
    req.body.status    = "published";

    fragments.push(req.body);
    writeFragments(fragments);

    res.json({ status: "saved", id: req.body.id });
});


/* ============================================================
   DELETE fragment by ID
   ============================================================ */

app.delete("/api/fragments/:id", (req, res) => {
    let fragments = readFragments();
    const before  = fragments.length;

    fragments = fragments.filter(f => f.id !== req.params.id);

    if (fragments.length === before) {
        return res.status(404).json({ error: "Fragment not found" });
    }

    writeFragments(fragments);
    res.json({ status: "deleted" });
});


/* ============================================================
   PUT — update fragment by ID
   ============================================================ */

app.put("/api/fragments/:id", (req, res) => {
    sanitizeFragment(req.body);

    const fragments = readFragments();
    const i         = fragments.findIndex(f => f.id === req.params.id);

    if (i === -1) {
        return res.status(404).json({ error: "Fragment not found" });
    }

    const wordCount = calcWordCount(req.body.lines);

    req.body.id        = req.params.id;
    req.body.createdAt = req.body.createdAt || fragments[i].createdAt;
    req.body.updatedAt = new Date().toISOString();
    req.body.wordCount = wordCount;
    req.body.readTime  = Math.ceil(wordCount / 200);

    fragments[i] = req.body;
    writeFragments(fragments);

    res.json({ status: "updated" });
});


/* ============================================================
   GET all drafts
   ============================================================ */

app.get("/api/drafts", (req, res) => {
    const drafts = readDrafts();
    res.json(drafts);
});


/* ============================================================
   POST — save new draft
   ============================================================ */

app.post("/api/drafts", (req, res) => {
    sanitizeFragment(req.body);

    const drafts = readDrafts();

    req.body.id        = uuidv4();
    req.body.status    = "draft";
    req.body.createdAt = req.body.createdAt || new Date().toISOString();
    req.body.updatedAt = new Date().toISOString();

    drafts.push(req.body);
    writeDrafts(drafts);

    res.json({ status: "saved", id: req.body.id });
});


/* ============================================================
   PUT — update existing draft by ID
   ============================================================ */

app.put("/api/drafts/:id", (req, res) => {
    sanitizeFragment(req.body);

    const drafts = readDrafts();
    const i      = drafts.findIndex(d => d.id === req.params.id);

    if (i === -1) {
        return res.status(404).json({ error: "Draft not found" });
    }

    req.body.id        = req.params.id;
    req.body.status    = "draft";
    req.body.createdAt = drafts[i].createdAt;
    req.body.updatedAt = new Date().toISOString();

    drafts[i] = req.body;
    writeDrafts(drafts);

    res.json({ status: "updated" });
});


/* ============================================================
   DELETE draft by ID
   ============================================================ */

app.delete("/api/drafts/:id", (req, res) => {
    let drafts   = readDrafts();
    const before = drafts.length;

    drafts = drafts.filter(d => d.id !== req.params.id);

    if (drafts.length === before) {
        return res.status(404).json({ error: "Draft not found" });
    }

    writeDrafts(drafts);
    res.json({ status: "deleted" });
});


/* ============================================================
   POST — publish a draft
   ============================================================ */

app.post("/api/drafts/:id/publish", (req, res) => {
    let drafts = readDrafts();
    const i    = drafts.findIndex(d => d.id === req.params.id);

    if (i === -1) {
        return res.status(404).json({ error: "Draft not found" });
    }

    const draft     = drafts[i];
    const fragments = readFragments();
    const wordCount = calcWordCount(draft.lines);

    const published = {
        ...draft,
        id:        uuidv4(),
        status:    "published",
        updatedAt: new Date().toISOString(),
        wordCount,
        readTime:  Math.ceil(wordCount / 200),
    };

    fragments.push(published);
    writeFragments(fragments);

    drafts.splice(i, 1);
    writeDrafts(drafts);

    res.json({ status: "published", id: published.id });
});


/* ============================================================
   START
   ============================================================ */

const PORT = process.env.PORT;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Echoes server running on port ${PORT}`);
});
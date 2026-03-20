const express        = require("express");
const fs             = require("fs");
const cors           = require("cors");
const path           = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();

app.use(cors());
app.use(express.json());
app.use((req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
app.use(express.static(path.join(__dirname)));


/* ============================================================
   CONFIG
   ============================================================ */

const PORT            = process.env.PORT || 3000;
const EDITOR_PASSWORD = process.env.EDITOR_PASSWORD;   /* set in Railway Variables */
const FRAGMENTS_FILE  = path.join(__dirname, "data", "fragments.json");
const DRAFTS_FILE     = path.join(__dirname, "data", "drafts.json");
const BACKUP_DIR      = path.join(__dirname, "data", "backups");

if (!EDITOR_PASSWORD) {
    console.warn("[WARN] EDITOR_PASSWORD is not set — editor will be inaccessible.");
}


/* ============================================================
   FILE HELPERS
   ============================================================ */

function readJSON(file, fallback = []) {
    try {
        if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
        console.error(`[ERROR] Failed to read ${file}:`, err.message);
        return fallback;
    }
}

function writeJSON(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error(`[ERROR] Failed to write ${file}:`, err.message);
    }
}

const readFragments  = () => readJSON(FRAGMENTS_FILE, []);
const writeFragments = (data) => writeJSON(FRAGMENTS_FILE, data);
const readDrafts     = () => readJSON(DRAFTS_FILE, []);
const writeDrafts    = (data) => writeJSON(DRAFTS_FILE, data);

function calcWordCount(lines) {
    return lines.join(" ").split(/\s+/).filter(Boolean).length;
}


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
    if (fragment.lines)  fragment.lines  = fragment.lines.map(sanitize);
    if (fragment.status) fragment.status = sanitize(fragment.status);
    return fragment;
}


/* ============================================================
   BACKUP
   ============================================================ */

function createBackup() {
    try {
        if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);

        fs.copyFileSync(FRAGMENTS_FILE, path.join(BACKUP_DIR, `fragments_${stamp}.json`));
        console.log(`[BACKUP] fragments_${stamp}.json`);

        if (fs.existsSync(DRAFTS_FILE)) {
            fs.copyFileSync(DRAFTS_FILE, path.join(BACKUP_DIR, `drafts_${stamp}.json`));
            console.log(`[BACKUP] drafts_${stamp}.json`);
        }

        ["fragments", "drafts"].forEach(type => {
            const files = fs.readdirSync(BACKUP_DIR)
                .filter(f => f.startsWith(`${type}_`))
                .sort();
            if (files.length > 7) {
                files.slice(0, files.length - 7).forEach(f => {
                    fs.unlinkSync(path.join(BACKUP_DIR, f));
                });
            }
        });
    } catch (err) {
        console.error("[BACKUP ERROR]", err.message);
    }
}

createBackup();
setInterval(createBackup, 24 * 60 * 60 * 1000);


/* ============================================================
   AUTH
   ============================================================ */

app.post("/api/auth", (req, res) => {
    if (!EDITOR_PASSWORD) return res.status(503).json({ success: false, error: "Password not configured." });
    if (req.body.password === EDITOR_PASSWORD) return res.json({ success: true });
    res.status(401).json({ success: false });
});


/* ============================================================
   FRAGMENTS
   ============================================================ */

app.get("/api/fragments", (req, res) => {
    res.json(readFragments());
});

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

app.put("/api/fragments/:id", (req, res) => {
    sanitizeFragment(req.body);
    const fragments = readFragments();
    const i         = fragments.findIndex(f => f.id === req.params.id);

    if (i === -1) return res.status(404).json({ error: "Fragment not found" });

    const wordCount  = calcWordCount(req.body.lines);
    req.body.id        = req.params.id;
    req.body.createdAt = req.body.createdAt || fragments[i].createdAt;
    req.body.updatedAt = new Date().toISOString();
    req.body.wordCount = wordCount;
    req.body.readTime  = Math.ceil(wordCount / 200);

    fragments[i] = req.body;
    writeFragments(fragments);
    res.json({ status: "updated" });
});

app.delete("/api/fragments/:id", (req, res) => {
    let fragments = readFragments();
    const before  = fragments.length;
    fragments     = fragments.filter(f => f.id !== req.params.id);

    if (fragments.length === before) return res.status(404).json({ error: "Fragment not found" });

    writeFragments(fragments);
    res.json({ status: "deleted" });
});


/* ============================================================
   DRAFTS
   ============================================================ */

app.get("/api/drafts", (req, res) => {
    res.json(readDrafts());
});

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

app.put("/api/drafts/:id", (req, res) => {
    sanitizeFragment(req.body);
    const drafts = readDrafts();
    const i      = drafts.findIndex(d => d.id === req.params.id);

    if (i === -1) return res.status(404).json({ error: "Draft not found" });

    req.body.id        = req.params.id;
    req.body.status    = "draft";
    req.body.createdAt = drafts[i].createdAt;
    req.body.updatedAt = new Date().toISOString();

    drafts[i] = req.body;
    writeDrafts(drafts);
    res.json({ status: "updated" });
});

app.delete("/api/drafts/:id", (req, res) => {
    let drafts   = readDrafts();
    const before = drafts.length;
    drafts       = drafts.filter(d => d.id !== req.params.id);

    if (drafts.length === before) return res.status(404).json({ error: "Draft not found" });

    writeDrafts(drafts);
    res.json({ status: "deleted" });
});

app.post("/api/drafts/:id/publish", (req, res) => {
    const drafts = readDrafts();
    const i      = drafts.findIndex(d => d.id === req.params.id);

    if (i === -1) return res.status(404).json({ error: "Draft not found" });

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

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Echoes running on port ${PORT}`);
});
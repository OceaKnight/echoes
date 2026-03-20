/* ============================================================
   STATE
   ============================================================ */

let editingServerFragmentId = null;
let editingDraftId          = null;
let currentFragmentId       = null;
let cachedFragments         = [];
let autosaveTimer           = null;
let visibleCount            = 5;
let searchQuery             = "";
let sortOrder               = "newest";


/* ============================================================
   RIPPLE CANVAS
   ============================================================ */

const canvas = document.getElementById("rippleCanvas");
const ctx    = canvas.getContext("2d");

canvas.width  = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener("resize", () => {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
});

let cursorX = canvas.width / 2;
let cursorY = canvas.height / 2;

window.addEventListener("mousemove", (e) => {
    cursorX = e.clientX;
    cursorY = e.clientY;
});


/* ============================================================
   PARTICLES
   ============================================================ */

let particles = [];

for (let i = 0; i < 80; i++) {
    particles.push({
        x:      Math.random() * canvas.width,
        y:      Math.random() * canvas.height,
        size:   Math.random() * 2,
        speedX: (Math.random() - 0.5) * 0.2,
        speedY: (Math.random() - 0.5) * 0.2
    });
}


/* ============================================================
   RIPPLES
   ============================================================ */

let ripples = [];

function createRipple() {
    for (let i = 0; i < 3; i++) {
        ripples.push({
            x:       cursorX,
            y:       cursorY,
            radius:  60 + i * 80,
            opacity: 0.35 - i * 0.08
        });
    }
}

window.addEventListener("scroll", createRipple);


/* ============================================================
   FRAGMENT DISTURBANCE
   ============================================================ */

function disturbFragments() {
    document.querySelectorAll(".fragment").forEach(fragment => {
        let rect    = fragment.getBoundingClientRect();
        let centerX = rect.left + rect.width  / 2;
        let centerY = rect.top  + rect.height / 2;

        let offsetX = 0;
        let offsetY = 0;

        ripples.forEach(r => {
            let dx   = centerX - r.x;
            let dy   = centerY - r.y;
            let dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < r.radius + 140 && dist > r.radius - 140) {
                let force = (1 - Math.abs(dist - r.radius) / 140);
                offsetX += dx * force * 0.002;
                offsetY += dy * force * 0.002;
            }
        });

        fragment.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    });
}


/* ============================================================
   ANIMATION LOOP
   ============================================================ */

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particles.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(200,210,255,0.08)";
        ctx.fill();

        p.x += p.speedX;
        p.y += p.speedY;

        if (p.x > canvas.width)  p.x = 0;
        if (p.x < 0)             p.x = canvas.width;
        if (p.y > canvas.height) p.y = 0;
        if (p.y < 0)             p.y = canvas.height;
    });

    ripples.forEach(r => {
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(180,200,255,${r.opacity})`;
        ctx.lineWidth   = 1.5;
        ctx.stroke();

        r.radius  += 1.2;
        r.opacity -= 0.002;
    });

    ripples = ripples.filter(r => r.opacity > 0);

    disturbFragments();

    requestAnimationFrame(draw);
}

draw();


/* ============================================================
   FRAGMENT SYSTEM
   ============================================================ */

async function loadFragments() {
    let response  = await fetch("/api/fragments");
    let fragments = await response.json();

    cachedFragments = fragments;
    visibleCount    = 5;

    renderVisibleFragments();
}


/* ============================================================
   SEARCH HELPERS
   ============================================================ */

function cleanText(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, "");
}

function fuzzyMatch(text, query) {
    let ti = 0;
    let qi = 0;

    while (ti < text.length && qi < query.length) {
        if (text[ti] === query[qi]) qi++;
        ti++;
    }

    return qi === query.length;
}

function matchesQuery(fragment, query) {
    const haystack = cleanText([fragment.title, ...fragment.lines].join(" "));
    const words    = cleanText(query).split(/\s+/).filter(Boolean);

    for (let word of words) {
        const wordsGt = word.match(/^words>(\d+)$/);
        const wordsLt = word.match(/^words<(\d+)$/);
        const timeGt  = word.match(/^time>(\d+)$/);
        const timeLt  = word.match(/^time<(\d+)$/);

        if (wordsGt) { if ((fragment.wordCount || 0) <= parseInt(wordsGt[1])) return false; continue; }
        if (wordsLt) { if ((fragment.wordCount || 0) >= parseInt(wordsLt[1])) return false; continue; }
        if (timeGt)  { if ((fragment.readTime  || 0) <= parseInt(timeGt[1]))  return false; continue; }
        if (timeLt)  { if ((fragment.readTime  || 0) >= parseInt(timeLt[1]))  return false; continue; }

        if (word.length >= 4) {
            if (!haystack.includes(word)) return false;
        } else {
            if (!fuzzyMatch(haystack, word)) return false;
        }
    }

    return true;
}

function getFilteredFragments() {
    let results = [...cachedFragments];

    results.sort((a, b) => {
        const dateA = new Date(a.createdAt || 0);
        const dateB = new Date(b.createdAt || 0);
        return sortOrder === "newest" ? dateB - dateA : dateA - dateB;
    });

    if (!searchQuery) return results;

    return results.filter(f => matchesQuery(f, searchQuery));
}

function renderVisibleFragments() {
    let container       = document.getElementById("fragmentContainer");
    container.innerHTML = "";

    const filtered = getFilteredFragments();

    if (filtered.length === 0) {
        let empty         = document.createElement("p");
        empty.className   = "searchEmpty";
        empty.textContent = searchQuery
            ? `No fragments found for "${searchQuery}"`
            : "No fragments yet.";
        container.appendChild(empty);
    } else {
        filtered.slice(0, visibleCount).forEach(fragment => renderFragment(fragment));
    }

    let loadMoreBtn           = document.getElementById("loadMoreBtn");
    loadMoreBtn.style.display = visibleCount < filtered.length ? "block" : "none";
}

function renderFragment(fragment) {
    let container = document.getElementById("fragmentContainer");

    let section       = document.createElement("section");
    section.className = "fragment";

    let title         = document.createElement("h2");
    title.textContent = fragment.title;

    let preview         = document.createElement("p");
    preview.className   = "fragmentPreview";
    preview.textContent = fragment.lines.slice(0, 2).join(" ") + "...";

    section.onclick = () => openReader(fragment);

    section.appendChild(title);
    section.appendChild(preview);
    container.appendChild(section);
}


/* ============================================================
   SEARCH
   ============================================================ */

document.getElementById("searchInput").addEventListener("input", (e) => {
    searchQuery  = e.target.value.trim();
    visibleCount = 5;
    renderVisibleFragments();
    document.getElementById("searchClear").style.display = searchQuery ? "block" : "none";
});

document.getElementById("searchClear").onclick = () => {
    document.getElementById("searchInput").value = "";
    searchQuery  = "";
    visibleCount = 5;
    renderVisibleFragments();
    document.getElementById("searchClear").style.display = "none";
};


/* ============================================================
   SORT
   ============================================================ */

document.getElementById("sortBtn").onclick = () => {
    sortOrder = sortOrder === "newest" ? "oldest" : "newest";

    let btn         = document.getElementById("sortBtn");
    btn.textContent = sortOrder === "newest" ? "Newest" : "Oldest";
    btn.classList.toggle("active", sortOrder === "oldest");

    visibleCount = 5;
    renderVisibleFragments();
};


/* ============================================================
   LOAD MORE
   ============================================================ */

document.getElementById("loadMoreBtn").onclick = () => {
    visibleCount += 5;
    renderVisibleFragments();
};


/* ============================================================
   RANDOM FRAGMENT
   ============================================================ */

function openRandomFragment() {
    if (cachedFragments.length === 0) return;

    let btn          = document.getElementById("randomBtn");
    let originalText = btn.textContent;

    btn.textContent = "...";

    setTimeout(() => {
        let random = cachedFragments[Math.floor(Math.random() * cachedFragments.length)];
        openReader(random);
        btn.textContent = originalText;
    }, 600);
}


/* ============================================================
   READER
   ============================================================ */

function openReader(fragment) {
    let reader  = document.getElementById("readerView");
    let title   = document.getElementById("readerTitle");
    let content = document.getElementById("readerContent");

    title.textContent = fragment.title;
    content.innerHTML = "";

    let meta       = document.createElement("p");
    meta.className = "fragmentMeta";

    const text      = fragment.lines.join(" ");
    const wordCount = fragment.wordCount || text.split(/\s+/).filter(w => w.length > 0).length;
    const readTime  = fragment.readTime  || Math.max(1, Math.ceil(wordCount / 200));

    let dateText = "";
    if (fragment.createdAt) {
        dateText = new Date(fragment.createdAt).toLocaleDateString("en-GB", {
            day:    "numeric",
            month:  "long",
            year:   "numeric",
            hour:   "2-digit",
            minute: "2-digit"
        });
    }

    meta.textContent = `${wordCount} words · ${readTime} min read${dateText ? " · " + dateText : ""}`;
    content.appendChild(meta);

    fragment.lines.forEach(line => {
        let p         = document.createElement("p");
        p.textContent = line;
        content.appendChild(p);
    });

    currentFragmentId    = fragment.id || null;
    reader.style.display = "flex";
}

document.getElementById("closeReader").onclick = () => {
    document.getElementById("readerView").style.display = "none";
    currentFragmentId = null;
};


/* ============================================================
   PASSWORD PROTECTION
   ============================================================ */

async function promptPassword() {
    const password = window.prompt("Enter password to access the editor:");
    if (!password) return;

    const response = await fetch("/api/auth", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ password })
    });

    const data = await response.json();

    if (data.success) {
        sessionStorage.setItem("authenticated", "true");
        toggleEditor();
    } else {
        alert("Incorrect password.");
    }
}


/* ============================================================
   EDITOR TOGGLE
   ============================================================ */

let editor = document.getElementById("editorPanel");

function toggleEditor() {
    editor.classList.toggle("open");

    if (editor.classList.contains("open")) {
        fillEditorDate();
        loadAutosaveDraft();
        renderDrafts();
        renderFragmentManager();
    }
}

document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    if (e.key.toLowerCase() === "w") {
        if (sessionStorage.getItem("authenticated") === "true") {
            toggleEditor();
        } else {
            promptPassword();
        }
    }
});

document.getElementById("closeEditor").onclick = () => {
    editor.classList.remove("open");
    resetEditor();
};


/* ============================================================
   DATE / TIME
   ============================================================ */

function fillEditorDate() {
    const now       = new Date();
    const formatted = now.toISOString().slice(0, 16);
    document.getElementById("fragmentDate").value = formatted;
}

function getEditorDate() {
    const val = document.getElementById("fragmentDate").value;
    return val ? new Date(val).toISOString() : new Date().toISOString();
}


/* ============================================================
   AUTOSAVE
   ============================================================ */

function startAutoSave() {
    let status         = document.getElementById("autosaveStatus");
    status.textContent = "Saving...";

    clearTimeout(autosaveTimer);

    autosaveTimer = setTimeout(() => {
        saveDraftLocally();
        status.textContent = "Saved";
    }, 1500);
}

function saveDraftLocally() {
    const title = document.getElementById("fragmentTitle").value;
    const text  = document.getElementById("fragmentText").value;
    localStorage.setItem("autosaveDraft", JSON.stringify({ title, text }));
}

function loadAutosaveDraft() {
    const saved = localStorage.getItem("autosaveDraft");
    if (!saved) return;

    const draft = JSON.parse(saved);
    document.getElementById("fragmentTitle").value = draft.title || "";
    document.getElementById("fragmentText").value  = draft.text  || "";
}


/* ============================================================
   EDITOR RESET
   ============================================================ */

function resetEditor() {
    editingServerFragmentId                                = null;
    editingDraftId                                         = null;
    document.getElementById("fragmentTitle").value         = "";
    document.getElementById("fragmentText").value          = "";
    document.getElementById("fragmentDate").value          = "";
    document.getElementById("autosaveStatus").textContent  = "";
    localStorage.removeItem("autosaveDraft");
}


/* ============================================================
   SAVE / PUBLISH
   ============================================================ */

async function saveFragment(status) {
    let title = document.getElementById("fragmentTitle").value.trim();
    let text  = document.getElementById("fragmentText").value.trim();

    if (!title || !text) return;

    if (title.length > 200) {
        alert("Title is too long — keep it under 200 characters.");
        return;
    }

    if (text.length > 50000) {
        alert("Fragment is too long — keep it under 50,000 characters.");
        return;
    }

    let lines    = text.split("\n");
    let fragment = { title, lines, status, createdAt: getEditorDate() };

    if (status === "draft") {

        if (editingDraftId !== null) {
            /* update existing draft */
            await fetch(`/api/drafts/${editingDraftId}`, {
                method:  "PUT",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify(fragment)
            });
            editingDraftId = null;
        } else {
            /* save new draft */
            await fetch("/api/drafts", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify(fragment)
            });
        }

        renderDrafts();

    } else if (status === "published") {

        if (editingServerFragmentId !== null) {

            await fetch(`/api/fragments/${editingServerFragmentId}`, {
                method:  "PUT",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify(fragment)
            });

            editingServerFragmentId = null;

        } else {

            await fetch("/api/fragments", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify(fragment)
            });
        }

        loadFragments();
        renderFragmentManager();
    }

    resetEditor();
}

document.getElementById("saveDraft").onclick       = () => saveFragment("draft");
document.getElementById("publishFragment").onclick = () => saveFragment("published");


/* ============================================================
   DRAFTS
   ============================================================ */

async function renderDrafts() {
    let draftList       = document.getElementById("draftList");
    draftList.innerHTML = "";

    let response = await fetch("/api/drafts");
    let drafts   = await response.json();

    if (drafts.length === 0) {
        draftList.innerHTML = `<p style="color:#444;font-size:13px;">No drafts yet.</p>`;
        return;
    }

    drafts.forEach(draft => {
        let row       = document.createElement("div");
        row.className = "draftRow";
        row.innerHTML = `
            <span>${draft.title || "Untitled"}</span>
            <button onclick="editDraft('${draft.id}')">Edit</button>
            <button onclick="publishDraft('${draft.id}')">Publish</button>
            <button onclick="deleteDraft('${draft.id}')">Delete</button>
        `;
        draftList.appendChild(row);
    });
}

async function editDraft(id) {
    let response = await fetch("/api/drafts");
    let drafts   = await response.json();
    let draft    = drafts.find(d => d.id === id);

    if (!draft) return;

    document.getElementById("fragmentTitle").value = draft.title || "";
    document.getElementById("fragmentText").value  = draft.lines ? draft.lines.join("\n") : "";

    const date = draft.createdAt
        ? new Date(draft.createdAt).toISOString().slice(0, 16)
        : new Date().toISOString().slice(0, 16);
    document.getElementById("fragmentDate").value = date;

    editingDraftId = id;
}

async function publishDraft(id) {
    let response = await fetch("/api/drafts");
    let drafts   = await response.json();
    let draft    = drafts.find(d => d.id === id);

    if (!draft) return;

    draft.status = "published";

    await fetch("/api/fragments", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(draft)
    });

    await fetch(`/api/drafts/${id}`, { method: "DELETE" });

    loadFragments();
    renderDrafts();
}

async function deleteDraft(id) {
    if (!confirm("Delete this draft?")) return;

    await fetch(`/api/drafts/${id}`, { method: "DELETE" });
    renderDrafts();
}


/* ============================================================
   FRAGMENT MANAGER
   ============================================================ */

async function renderFragmentManager() {
    let manager       = document.getElementById("fragmentManager");
    manager.innerHTML = "";

    let response        = await fetch("/api/fragments");
    let serverFragments = await response.json();

    serverFragments.forEach(fragment => {
        let row       = document.createElement("div");
        row.className = "fragmentRow";
        row.innerHTML = `
            <span>${fragment.title}</span>
            <div>
                <button onclick="editServerFragment('${fragment.id}')">Edit</button>
                <button onclick="deleteServerFragment('${fragment.id}')">Delete</button>
            </div>
        `;
        manager.appendChild(row);
    });

    /* also show drafts in manager */
    let draftsRes = await fetch("/api/drafts");
    let drafts    = await draftsRes.json();

    drafts.forEach(draft => {
        let row       = document.createElement("div");
        row.className = "fragmentRow";
        row.innerHTML = `
            <span>${draft.title || "Untitled"} (draft)</span>
            <div>
                <button onclick="editDraft('${draft.id}')">Edit</button>
                <button onclick="publishDraft('${draft.id}')">Publish</button>
                <button onclick="deleteDraft('${draft.id}')">Delete</button>
            </div>
        `;
        manager.appendChild(row);
    });
}

async function editServerFragment(id) {
    let response  = await fetch("/api/fragments");
    let fragments = await response.json();
    let fragment  = fragments.find(f => f.id === id);

    if (!fragment) return;

    document.getElementById("fragmentTitle").value = fragment.title;
    document.getElementById("fragmentText").value  = fragment.lines.join("\n");

    const date = fragment.createdAt
        ? new Date(fragment.createdAt).toISOString().slice(0, 16)
        : new Date().toISOString().slice(0, 16);
    document.getElementById("fragmentDate").value = date;

    editingServerFragmentId = id;
    editor.classList.add("open");
}

async function deleteServerFragment(id) {
    if (!confirm("Delete this fragment? This cannot be undone.")) return;

    await fetch(`/api/fragments/${id}`, { method: "DELETE" });
    loadFragments();
    renderFragmentManager();
}


/* ============================================================
   FOOTER
   ============================================================ */

const closingLines = [
    "Somewhere between what was and what remains, this is where it stayed.",
    "I thought it would fade.",
    "Still here.",
    "What never found its place stayed behind as this.",
    "Not everything fades when it should.",
    "Time moves on. Some things don't.",
    "Not yet gone.",
    "Somewhere between then and now.",
    "Not everything here has an ending.",
    "What we lose never truly leaves us.",
];

function setRandomFooter() {
    const el   = document.getElementById("footerLine");
    const line = closingLines[Math.floor(Math.random() * closingLines.length)];
    el.textContent = line;
    setTimeout(() => el.classList.add("show"), 200);
}


/* ============================================================
   INIT — always last
   ============================================================ */

document.getElementById("randomBtn").onclick = openRandomFragment;

document.getElementById("fragmentText").addEventListener("input", startAutoSave);
document.getElementById("fragmentTitle").addEventListener("input", startAutoSave);

window.addEventListener("load", setRandomFooter);

loadFragments();
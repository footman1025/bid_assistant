const form = document.querySelector("#bid-form");
const filesInput = document.querySelector("#files");
const fileList = document.querySelector("#file-list");
const styleSelect = document.querySelector("#style-id");
const styleHint = document.querySelector("#style-hint");
const output = document.querySelector("#output");
const resultMeta = document.querySelector("#result-meta");
const copyBtn = document.querySelector("#copy");
const downloadBtn = document.querySelector("#download");
const generateBtn = document.querySelector("#generate");
const timelineInput = document.querySelector("#timeline");
const budgetInput = document.querySelector("#budget");
const statTime = document.querySelector("#stat-time");
const statTimeline = document.querySelector("#stat-timeline");
const statBudget = document.querySelector("#stat-budget");
const resultTime = document.querySelector("#result-time");

const settingsDialog = document.querySelector("#settings-dialog");
const stylesDialog = document.querySelector("#styles-dialog");
const apiKeyInput = document.querySelector("#api-key");
const modelInput = document.querySelector("#model");
const providerSelect = document.querySelector("#provider");
const keyField = document.querySelector("#key-field");
const keyLabel = document.querySelector("#key-label");
const settingsHint = document.querySelector("#settings-hint");
const styleList = document.querySelector("#style-list");
const styleForm = document.querySelector("#style-form");

const PROVIDER_DEFAULTS = {
  gemini: {
    model: "gemini-3.6-flash",
    keyLabel: "Gemini API key",
    hint: "Gemini is called from this browser, so Google sees the browser network.",
    needsKey: true,
  },
  deepseek: {
    model: "deepseek-chat",
    keyLabel: "DeepSeek API key",
    hint: "Get a key at platform.deepseek.com.",
    needsKey: true,
  },
  ollama: {
    model: "llama3.2",
    keyLabel: "API key",
    hint: "Install Ollama from ollama.com, then run: ollama pull llama3.2. No API key needed.",
    needsKey: false,
  },
};

let styles = [];
let selectedFiles = [];
let editingStyleId = "";
let lastBid = "";
const toastBox = document.querySelector("#toasts");

function showToast(message, kind = "ok") {
  toastBox.showPopover();
  const item = document.createElement("div");
  item.className = `toast ${kind}`;
  item.innerHTML = `<span>${escapeHtml(message)}</span><button type="button" aria-label="Dismiss"><svg class="icon"><use href="#i-close"></use></svg></button>`;
  toastBox.append(item);
  requestAnimationFrame(() => item.classList.add("show"));

  const hide = () => {
    item.classList.add("hide");
    item.classList.remove("show");
    window.setTimeout(() => {
      item.remove();
      if (!toastBox.children.length) toastBox.hidePopover();
    }, 250);
  };
  item.querySelector("button").addEventListener("click", hide);
  window.setTimeout(hide, 3200);
}

function setOutput(text, kind = "") {
  output.textContent = text;
  output.className = `output${kind ? ` ${kind}` : ""}`;
}

function formatDuration(ms) {
  const seconds = Math.max(0.1, ms / 1000);
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

function updateProjectStats() {
  const timeline = timelineInput.value.trim();
  const budget = budgetInput.value.trim();
  statTimeline.textContent = timeline || "Not set";
  statBudget.textContent = budget || "Not set";
  localStorage.setItem("bid.timeline", timeline);
  localStorage.setItem("bid.budget", budget);
}

function persistSettings() {
  localStorage.setItem("bid.provider", providerSelect.value);
  localStorage.setItem("bid.apiKey", apiKeyInput.value.trim());
  localStorage.setItem("bid.model", modelInput.value.trim());
}

function syncProviderFields() {
  const config = PROVIDER_DEFAULTS[providerSelect.value] || PROVIDER_DEFAULTS.gemini;
  keyLabel.textContent = config.keyLabel;
  settingsHint.textContent = config.hint;
  keyField.classList.toggle("is-hidden", !config.needsKey);
}

function loadSettings() {
  const storedProvider = localStorage.getItem("bid.provider") || "gemini";
  providerSelect.value = PROVIDER_DEFAULTS[storedProvider] ? storedProvider : "deepseek";
  apiKeyInput.value = localStorage.getItem("bid.apiKey") || "";
  const storedModel = localStorage.getItem("bid.model") || "";
  const provider = providerSelect.value;
  const stale =
    !storedModel ||
    storedModel.startsWith("gpt-") ||
    (provider !== "gemini" && storedModel.startsWith("gemini-"));
  modelInput.value = stale ? PROVIDER_DEFAULTS[provider].model : storedModel;
  syncProviderFields();
}

function renderFiles() {
  fileList.innerHTML = selectedFiles
    .map(
      (file, index) =>
        `<li><span>${file.name}</span><button class="ghost" type="button" data-remove="${index}"><svg class="icon"><use href="#i-trash"></use></svg>Remove</button></li>`,
    )
    .join("");
}

function currentStyle() {
  return styles.find((style) => style.id === styleSelect.value);
}

function fillStyleSelect() {
  const previous = styleSelect.value;
  styleSelect.innerHTML = styles
    .map((style) => `<option value="${style.id}">${style.name}</option>`)
    .join("");
  if (styles.some((style) => style.id === previous)) {
    styleSelect.value = previous;
  }
  updateStyleHint();
}

function stylePromptList(style) {
  const prompts = (style?.prompts || []).filter((item) => item && item.trim());
  return prompts.length ? prompts : [""];
}

function nextPromptLabel(style) {
  const prompts = (style?.prompts || []).filter((item) => item && item.trim());
  if (!prompts.length) return "No bid prompt yet. Add one in Manage styles.";
  const index = (Number(style.use_count) || 0) % prompts.length;
  return `Next bid uses prompt ${index + 1} of ${prompts.length}`;
}

function updateStyleHint() {
  const style = currentStyle();
  styleHint.textContent = style
    ? [nextPromptLabel(style), style.tone, style.length].filter(Boolean).join(" · ")
    : "";
}

function renderPromptFields(prompts) {
  const list = document.querySelector("#prompt-list");
  const items = prompts.length ? prompts : [""];
  list.innerHTML = items
    .map(
      (text, index) => `
        <div class="prompt-item">
          <header>
            <span>Prompt ${index + 1} · used on bid ${index + 1}, ${index + 1 + items.length}, …</span>
            ${items.length > 1 ? `<button class="ghost" type="button" data-remove-prompt="${index}"><svg class="icon"><use href="#i-trash"></use></svg>Remove</button>` : ""}
          </header>
          <textarea rows="5" data-prompt-field placeholder="How this style should write the bid.">${escapeHtml(text)}</textarea>
        </div>`,
    )
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function readPromptFields() {
  return [...document.querySelectorAll("[data-prompt-field]")].map((field) => field.value);
}

function renderStyleList() {
  styleList.innerHTML = styles
    .map(
      (style) =>
        `<li><button type="button" data-id="${style.id}" class="${
          style.id === editingStyleId ? "active" : ""
        }">${style.name}</button></li>`,
    )
    .join("");
}

function fillStyleForm(style) {
  editingStyleId = style?.id || "";
  document.querySelector("#style-name").value = style?.name || "";
  document.querySelector("#style-tone").value = style?.tone || "";
  document.querySelector("#style-voice").value = style?.voice || "";
  document.querySelector("#style-length").value = style?.length || "";
  document.querySelector("#style-notes").value = style?.notes || "";
  renderPromptFields(stylePromptList(style));
  renderStyleList();
}

async function fetchStyles() {
  const response = await fetch("/api/styles");
  styles = await response.json();
  fillStyleSelect();
  if (!editingStyleId && styles[0]) {
    fillStyleForm(styles[0]);
  } else {
    fillStyleForm(styles.find((style) => style.id === editingStyleId) || styles[0]);
  }
}

function setButtonLabel(button, icon, label) {
  button.innerHTML = `<svg class="icon"><use href="#${icon}"></use></svg>${label}`;
}

function setBusy(busy) {
  generateBtn.disabled = busy;
  setButtonLabel(generateBtn, "i-pen", busy ? "Writing bid…" : "Make bid");
}

filesInput.addEventListener("change", () => {
  const added = [...filesInput.files];
  selectedFiles = [...selectedFiles, ...added];
  filesInput.value = "";
  renderFiles();
  if (added.length) showToast(added.length === 1 ? "File added." : `${added.length} files added.`);
});

fileList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  const index = button.dataset.remove;
  selectedFiles.splice(Number(index), 1);
  renderFiles();
  showToast("File removed.");
});

timelineInput.addEventListener("input", updateProjectStats);
budgetInput.addEventListener("input", updateProjectStats);
document.querySelector("#focus-timeline").addEventListener("click", () => {
  timelineInput.focus();
  timelineInput.scrollIntoView({ behavior: "smooth", block: "center" });
});
document.querySelector("#focus-budget").addEventListener("click", () => {
  budgetInput.focus();
  budgetInput.scrollIntoView({ behavior: "smooth", block: "center" });
});

styleSelect.addEventListener("change", updateStyleHint);

providerSelect.addEventListener("change", () => {
  modelInput.value = PROVIDER_DEFAULTS[providerSelect.value].model;
  syncProviderFields();
});

document.querySelector("#open-settings").addEventListener("click", () => {
  settingsDialog.showModal();
});

document.querySelector("#save-settings").addEventListener("click", () => {
  persistSettings();
  settingsDialog.close();
  showToast("Settings saved.");
});

document.querySelector("#open-styles").addEventListener("click", async () => {
  await fetchStyles();
  stylesDialog.showModal();
});

document.querySelector("#close-styles").addEventListener("click", () => {
  stylesDialog.close();
});

document.querySelector("#new-style").addEventListener("click", () => {
  fillStyleForm({
    id: "",
    name: "",
    tone: "",
    voice: "",
    length: "",
    notes: "",
    prompts: [""],
  });
  showToast("New style ready. Fill it in, then save.");
});

document.querySelector("#add-prompt").addEventListener("click", () => {
  renderPromptFields([...readPromptFields(), ""]);
  showToast("Another prompt added.");
});

document.querySelector("#prompt-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-prompt]");
  if (!button) return;
  const index = button.dataset.removePrompt;
  const next = readPromptFields().filter((_, itemIndex) => itemIndex !== Number(index));
  renderPromptFields(next.length ? next : [""]);
  showToast("Prompt removed.");
});

styleList.addEventListener("click", (event) => {
  const id = event.target.dataset.id;
  if (!id) return;
  fillStyleForm(styles.find((style) => style.id === id));
});

styleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = {
    name: document.querySelector("#style-name").value.trim(),
    tone: document.querySelector("#style-tone").value.trim(),
    voice: document.querySelector("#style-voice").value.trim(),
    length: document.querySelector("#style-length").value.trim(),
    notes: document.querySelector("#style-notes").value.trim(),
    prompts: readPromptFields(),
  };
  const url = editingStyleId ? `/api/styles/${editingStyleId}` : "/api/styles";
  const method = editingStyleId ? "PUT" : "POST";
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const saved = await response.json();
  if (!response.ok) {
    showToast(saved.detail || "Could not save style", "err");
    return;
  }
  editingStyleId = saved.id;
  await fetchStyles();
  showToast("Style saved.");
});

document.querySelector("#delete-style").addEventListener("click", async () => {
  if (!editingStyleId) return;
  const response = await fetch(`/api/styles/${editingStyleId}`, { method: "DELETE" });
  if (!response.ok) {
    const data = await response.json();
    showToast(data.detail || "Could not delete style", "err");
    return;
  }
  editingStyleId = "";
  await fetchStyles();
  showToast("Style deleted.");
});

async function prepareBid(data) {
  const response = await fetch("/api/prepare", { method: "POST", body: data });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.detail || "Could not read the brief");
  }
  return payload;
}

async function generateGeminiInBrowser(system, user) {
  const key = apiKeyInput.value.trim();
  if (!key) {
    throw new Error("Add a Gemini API key in Settings.");
  }
  const model = modelInput.value.trim() || "gemini-3.6-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 4096 },
      }),
    });
  } catch {
    throw new Error("The browser could not reach Gemini. Check the network and try again.");
  }
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || "Gemini could not make the bid");
  }
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const bid = parts.map((part) => part.text || "").join("").trim();
  if (!bid) {
    throw new Error("Gemini returned no bid. Try again.");
  }
  return bid;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const requirements = document.querySelector("#requirements").value.trim();
    if (!requirements) {
    setOutput("Add the project requirements first.", "error");
    showToast("Add the project requirements first.", "err");
    return;
  }

  persistSettings();
  const provider = providerSelect.value || "gemini";
  const data = new FormData();
  data.append("requirements", requirements);
  data.append("style_id", styleSelect.value);
  data.append("api_key", apiKeyInput.value.trim());
  data.append("model", modelInput.value.trim());
  data.append("provider", provider);
  data.append("timeline", timelineInput.value.trim());
  data.append("budget", budgetInput.value.trim());
  selectedFiles.forEach((file) => data.append("files", file));

  setBusy(true);
  setOutput("Reading the brief and writing the bid…", "empty");
  resultMeta.textContent = "Working";
  statTime.textContent = "…";
  resultTime.textContent = "";
  copyBtn.disabled = true;
  downloadBtn.disabled = true;
  const started = performance.now();

  try {
    let bid;
    let styleName;
    if (provider === "gemini") {
      const prepared = await prepareBid(data);
      styleName = prepared.style;
      bid = await generateGeminiInBrowser(prepared.system, prepared.user);
      await fetch(`/api/styles/${styleSelect.value}/use`, { method: "POST" });
      await fetchStyles();
    } else {
      const response = await fetch("/api/generate", { method: "POST", body: data });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || "Could not make the bid");
      }
      styleName = payload.style;
      bid = payload.bid;
    }
    lastBid = bid;
    const elapsed = formatDuration(performance.now() - started);
    setOutput(lastBid);
    resultMeta.textContent = `${styleName} · ${lastBid.split(/\s+/).filter(Boolean).length} words`;
    statTime.textContent = elapsed;
    resultTime.textContent = `Generated in ${elapsed}`;
    updateProjectStats();
    copyBtn.disabled = false;
    downloadBtn.disabled = false;
    showToast("Bid ready.");
  } catch (error) {
    lastBid = "";
    setOutput(error.message, "error");
    resultMeta.textContent = "Not generated";
    statTime.textContent = "—";
    resultTime.textContent = "";
    showToast(error.message, "err");
  } finally {
    setBusy(false);
  }
});

copyBtn.addEventListener("click", async () => {
  if (!lastBid) return;
  await navigator.clipboard.writeText(lastBid);
  setButtonLabel(copyBtn, "i-check", "Copied");
  showToast("Bid copied.");
  setTimeout(() => {
    setButtonLabel(copyBtn, "i-copy", "Copy");
  }, 1200);
});

downloadBtn.addEventListener("click", () => {
  if (!lastBid) return;
  const blob = new Blob([lastBid], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "bid.txt";
  link.click();
  URL.revokeObjectURL(url);
  showToast("Bid downloaded.");
});

setOutput("Your bid will appear here.", "empty");
loadSettings();
timelineInput.value = localStorage.getItem("bid.timeline") || "";
budgetInput.value = localStorage.getItem("bid.budget") || "";
fetchStyles();
updateProjectStats();

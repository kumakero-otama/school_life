const STORAGE_PREFIX = "school-life-checks:";
const AUTH_STORAGE_KEY = "school-life-auth";
const PASSWORD_HASH = "43bf9bce5e0fe12801dfaba71b702c4956c9761ed722a43bc80d7d3c6f211d88";
const DEFAULT_PASSWORD_HINT = "初期パスワードは school-life です。公開前に app.js 内のハッシュ変更をおすすめします。";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function parseMarkdownTables(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  let currentSection = null;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (!line || line === "---") {
      continue;
    }

    if (line.startsWith("#")) {
      const title = line.replace(/^#+\s*/, "").replace(/\*\*/g, "").trim();
      currentSection = { title, rows: [] };
      sections.push(currentSection);
      continue;
    }

    if (!line.startsWith("|")) {
      continue;
    }

    const nextLine = lines[index + 1]?.trim() ?? "";
    if (!nextLine.startsWith("|")) {
      continue;
    }

    const headerCells = splitRow(line);
    const separatorCells = splitRow(nextLine);
    const isSeparator = separatorCells.every((cell) => /^:?-{3,}:?$/.test(cell));

    if (!isSeparator || headerCells.length < 3) {
      continue;
    }

    if (!currentSection) {
      currentSection = { title: "チェックリスト", rows: [] };
      sections.push(currentSection);
    }

    index += 2;
    while (index < lines.length) {
      const rowLine = lines[index].trim();
      if (!rowLine.startsWith("|")) {
        index -= 1;
        break;
      }

      const cells = splitRow(rowLine);
      if (cells.length >= headerCells.length) {
        currentSection.rows.push(buildRow(headerCells, cells, currentSection.title, currentSection.rows.length));
      }
      index += 1;
    }
  }

  return sections.filter((section) => section.rows.length > 0);
}

function splitRow(line) {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function buildRow(headers, cells, sectionTitle, rowIndex) {
  const normalizedHeaders = headers.map((header) => header.replace(/\*\*/g, "").trim());
  const item = {
    id: `${slugify(sectionTitle)}-${rowIndex}-${slugify(cells.slice(2).join("-")) || "item"}`,
    purchaseLabel: normalizedHeaders[0] || "購入",
    prepareLabel: normalizedHeaders[1] || "準備",
    purchase: cells[0].includes("[x]"),
    prepare: cells[1].includes("[x]"),
    fields: [],
  };

  for (let i = 2; i < normalizedHeaders.length; i += 1) {
    item.fields.push({
      label: normalizedHeaders[i],
      value: cells[i] ?? "",
    });
  }

  return item;
}

function readStorage(storageKey) {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || "{}");
  } catch {
    return {};
  }
}

function writeStorage(storageKey, value) {
  localStorage.setItem(storageKey, JSON.stringify(value));
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getHomePath() {
  return document.body.dataset.homePath || "./";
}

function getRedirectTarget() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function isAuthenticated() {
  return sessionStorage.getItem(AUTH_STORAGE_KEY) === PASSWORD_HASH;
}

function setAuthenticated() {
  sessionStorage.setItem(AUTH_STORAGE_KEY, PASSWORD_HASH);
}

function clearAuthenticated() {
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
}

function wireLogoutButton() {
  const button = document.querySelector("#logout-button");
  if (!button) return;

  button.hidden = !isAuthenticated();
  button.addEventListener("click", () => {
    clearAuthenticated();
    window.location.href = `${getHomePath()}?redirect=${encodeURIComponent(getRedirectTarget())}`;
  });
}

function redirectToHome() {
  window.location.replace(`${getHomePath()}?redirect=${encodeURIComponent(getRedirectTarget())}`);
}

function showAuthOverlay() {
  if (document.querySelector(".auth-overlay")) {
    return;
  }

  const redirect = new URLSearchParams(window.location.search).get("redirect") || "";
  const overlay = document.createElement("div");
  overlay.className = "auth-overlay";
  overlay.innerHTML = `
    <section class="auth-panel" aria-labelledby="auth-title">
      <p class="eyebrow">Access</p>
      <h2 id="auth-title">パスワードを入力</h2>
      <p class="auth-copy">メインページを開くにはパスワードが必要です。認証後は子ページにも移動できます。</p>
      <form class="auth-form" id="auth-form">
        <div class="auth-field">
          <label for="site-password">パスワード</label>
          <input id="site-password" name="password" type="password" autocomplete="current-password" required>
        </div>
        <div class="auth-actions">
          <button type="submit" class="primary-button">入室する</button>
          <span class="auth-hint">${escapeHtml(DEFAULT_PASSWORD_HINT)}</span>
        </div>
        <p class="auth-error" id="auth-error" aria-live="polite"></p>
      </form>
    </section>
  `;

  document.body.append(overlay);
  const form = overlay.querySelector("#auth-form");
  const input = overlay.querySelector("#site-password");
  const error = overlay.querySelector("#auth-error");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";

    const hash = await sha256(input.value);
    if (hash !== PASSWORD_HASH) {
      error.textContent = "パスワードが違います。";
      input.select();
      return;
    }

    setAuthenticated();
    overlay.remove();
    wireLogoutButton();

    if (redirect) {
      window.location.href = redirect;
      return;
    }

    bootstrap();
  });

  requestAnimationFrame(() => input.focus());
}

function enforceAuth() {
  const view = document.body.dataset.view;

  if (view === "home") {
    wireLogoutButton();
    if (!isAuthenticated()) {
      showAuthOverlay();
      return false;
    }
    return true;
  }

  if (!isAuthenticated()) {
    redirectToHome();
    return false;
  }

  wireLogoutButton();
  return true;
}

function renderHome(pages) {
  const mount = document.querySelector("#page-list");
  if (!mount) return;

  if (!pages.length) {
    mount.innerHTML = '<p class="empty-state">まだ公開ページがありません。</p>';
    return;
  }

  mount.innerHTML = pages
    .map(
      (page) => `
        <a class="page-card" href="${escapeHtml(page.path)}">
          <span class="page-meta">${escapeHtml(page.label)}</span>
          <h3>${escapeHtml(page.title)}</h3>
          <p class="page-description">${escapeHtml(page.description || "")}</p>
        </a>
      `
    )
    .join("");
}

function renderChecklist(markdown) {
  const body = document.body;
  const title = body.dataset.pageTitle || "チェックリスト";
  const source = body.dataset.pageSource || "./list.md";
  const slug = body.dataset.pageSlug || slugify(title) || "page";
  const storageKey = `${STORAGE_PREFIX}${slug}`;
  const sections = parseMarkdownTables(markdown);
  const state = readStorage(storageKey);

  const mount = document.querySelector("#app");
  if (!mount) return;

  if (!sections.length) {
    mount.innerHTML = '<p class="empty-state">表示できる表が `list.md` に見つかりませんでした。</p>';
    return;
  }

  const metrics = collectMetrics(sections, state);

  mount.innerHTML = `
    <section class="panel">
      <div class="summary-row">
        <div>
          <p class="section-label">Overview</p>
          <h2>進み具合</h2>
          <p class="summary-copy">購入と準備をそれぞれ保存できます。チェックはこのブラウザに残ります。</p>
        </div>
        <button type="button" class="ghost-button" id="reset-checks">このページのチェックをリセット</button>
      </div>
      <div class="summary-grid">
        <article class="summary-card">
          <p class="meta-label">項目数</p>
          <strong>${metrics.items}</strong>
        </article>
        <article class="summary-card">
          <p class="meta-label">購入完了</p>
          <strong>${metrics.purchaseDone} / ${metrics.items}</strong>
        </article>
        <article class="summary-card">
          <p class="meta-label">準備完了</p>
          <strong>${metrics.prepareDone} / ${metrics.items}</strong>
        </article>
      </div>
    </section>
    <section class="section-list">
      ${sections.map((section) => renderSection(section, state)).join("")}
    </section>
  `;

  mount.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.addEventListener("change", (event) => {
      const target = event.currentTarget;
      const itemId = target.dataset.itemId;
      const field = target.dataset.field;
      const nextState = {
        ...readStorage(storageKey),
        [itemId]: {
          ...(readStorage(storageKey)[itemId] || {}),
          [field]: target.checked,
        },
      };

      writeStorage(storageKey, nextState);
      renderChecklist(markdown);
    });
  });

  document.querySelector("#reset-checks")?.addEventListener("click", () => {
    localStorage.removeItem(storageKey);
    renderChecklist(markdown);
  });

  document.querySelector("#source-path").textContent = source;
}

function renderSection(section, state) {
  const sectionMetrics = section.rows.reduce(
    (accumulator, row) => {
      const rowState = state[row.id] || {};
      accumulator.items += 1;
      if (rowState.purchase ?? row.purchase) accumulator.purchaseDone += 1;
      if (rowState.prepare ?? row.prepare) accumulator.prepareDone += 1;
      return accumulator;
    },
    { items: 0, purchaseDone: 0, prepareDone: 0 }
  );

  return `
    <article class="section-card">
      <div class="section-head">
        <div>
          <p class="section-label">Section</p>
          <h3>${escapeHtml(section.title)}</h3>
        </div>
        <div class="section-progress">
          <span>購入 ${sectionMetrics.purchaseDone}/${sectionMetrics.items}</span>
          <span>準備 ${sectionMetrics.prepareDone}/${sectionMetrics.items}</span>
        </div>
      </div>
      <div class="item-list">
        ${section.rows.map((row) => renderRow(row, state[row.id] || {})).join("")}
      </div>
    </article>
  `;
}

function renderRow(row, rowState) {
  const purchaseChecked = rowState.purchase ?? row.purchase;
  const prepareChecked = rowState.prepare ?? row.prepare;
  const titleField = row.fields[1]?.value || row.fields[0]?.value || "項目";
  const noteField = row.fields.at(-1);
  const metaFields = row.fields.filter((field, index) => {
    const isTitleField = row.fields[1] && index === 1;
    const isNoteField = noteField && index === row.fields.length - 1;
    return !isTitleField && !isNoteField;
  });

  return `
    <article class="item-card">
      <div class="item-grid">
        <div class="item-main">
          <h4 class="item-title">${escapeHtml(titleField)}</h4>
          <div class="meta-row">
            ${metaFields
              .map(
                (field) => `
                  <span class="meta-pill">
                    <strong>${escapeHtml(field.label)}</strong>
                    <span>${escapeHtml(field.value || "-")}</span>
                  </span>
                `
              )
              .join("")}
          </div>
          ${noteField && noteField.value ? `<p class="item-notes">${escapeHtml(noteField.value)}</p>` : ""}
        </div>
        <div class="status-row">
          <label class="check-toggle">
            <input type="checkbox" data-item-id="${escapeHtml(row.id)}" data-field="purchase" ${purchaseChecked ? "checked" : ""}>
            <span>${escapeHtml(row.purchaseLabel)}</span>
          </label>
          <label class="check-toggle">
            <input type="checkbox" data-item-id="${escapeHtml(row.id)}" data-field="prepare" ${prepareChecked ? "checked" : ""}>
            <span>${escapeHtml(row.prepareLabel)}</span>
          </label>
        </div>
      </div>
    </article>
  `;
}

function collectMetrics(sections, state) {
  return sections.flatMap((section) => section.rows).reduce(
    (accumulator, row) => {
      const rowState = state[row.id] || {};
      accumulator.items += 1;
      if (rowState.purchase ?? row.purchase) accumulator.purchaseDone += 1;
      if (rowState.prepare ?? row.prepare) accumulator.prepareDone += 1;
      return accumulator;
    },
    { items: 0, purchaseDone: 0, prepareDone: 0 }
  );
}

async function bootstrap() {
  if (!enforceAuth()) {
    return;
  }

  const view = document.body.dataset.view;

  if (view === "home") {
    const response = await fetch("./data/pages.json", { cache: "no-store" });
    const pages = await response.json();
    renderHome(pages);
    return;
  }

  if (view === "checklist") {
    const source = document.body.dataset.pageSource || "./list.md";
    const response = await fetch(source, { cache: "no-store" });
    const markdown = await response.text();
    renderChecklist(markdown);
  }
}

bootstrap().catch((error) => {
  const mount = document.querySelector("#app") || document.querySelector("#page-list");
  if (mount) {
    mount.innerHTML = `<p class="empty-state">ページの読み込みに失敗しました: ${escapeHtml(error.message)}</p>`;
  }
});

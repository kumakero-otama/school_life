const STORAGE_PREFIX = "school-life-checks:";
const AUTH_STORAGE_KEY = "school-life-auth";
const PASSWORD_HASH = "43bf9bce5e0fe12801dfaba71b702c4956c9761ed722a43bc80d7d3c6f211d88";
const DEFAULT_PASSWORD_HINT = "初期パスワードは school-life です。公開前に app.js 内のハッシュ変更をおすすめします。";
const SHARED_CONFIG = window.SCHOOL_LIFE_CONFIG?.sharedStorage || {};
const pageUiState = new Map();

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

function isSharedStorageEnabled() {
  return Boolean(
    SHARED_CONFIG.enabled &&
      SHARED_CONFIG.provider === "supabase" &&
      SHARED_CONFIG.projectUrl &&
      SHARED_CONFIG.anonKey &&
      SHARED_CONFIG.table
  );
}

function getSharedHeaders() {
  return {
    apikey: SHARED_CONFIG.anonKey,
    Authorization: `Bearer ${SHARED_CONFIG.anonKey}`,
    "Content-Type": "application/json",
  };
}

async function readPageState(pageSlug) {
  if (!isSharedStorageEnabled()) {
    return null;
  }

  const url = new URL(`${SHARED_CONFIG.projectUrl}/rest/v1/${SHARED_CONFIG.table}`);
  url.searchParams.set("page_slug", `eq.${pageSlug}`);
  url.searchParams.set("select", "item_id,purchase,prepare");

  const response = await fetch(url, {
    headers: getSharedHeaders(),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("共有データの読み込みに失敗しました。");
  }

  const rows = await response.json();
  return Object.fromEntries(
    rows.map((row) => [
      row.item_id,
      {
        purchase: Boolean(row.purchase),
        prepare: Boolean(row.prepare),
      },
    ])
  );
}

async function writePageItemState(pageSlug, itemId, value) {
  if (!isSharedStorageEnabled()) {
    return;
  }

  const url = new URL(`${SHARED_CONFIG.projectUrl}/rest/v1/${SHARED_CONFIG.table}`);
  url.searchParams.set("on_conflict", "page_slug,item_id");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...getSharedHeaders(),
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([
      {
        page_slug: pageSlug,
        item_id: itemId,
        purchase: Boolean(value.purchase),
        prepare: Boolean(value.prepare),
      },
    ]),
  });

  if (!response.ok) {
    throw new Error("共有データの保存に失敗しました。");
  }
}

async function clearPageState(pageSlug) {
  if (!isSharedStorageEnabled()) {
    return;
  }

  const url = new URL(`${SHARED_CONFIG.projectUrl}/rest/v1/${SHARED_CONFIG.table}`);
  url.searchParams.set("page_slug", `eq.${pageSlug}`);

  const response = await fetch(url, {
    method: "DELETE",
    headers: getSharedHeaders(),
  });

  if (!response.ok) {
    throw new Error("共有データのリセットに失敗しました。");
  }
}

function getUiState(pageKey) {
  if (!pageUiState.has(pageKey)) {
    pageUiState.set(pageKey, {});
  }
  return pageUiState.get(pageKey);
}

function updateSectionUiState(pageKey, sectionKey, patch) {
  const pageState = getUiState(pageKey);
  pageState[sectionKey] = {
    ...(pageState[sectionKey] || {}),
    ...patch,
  };
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
  const sharedStatus = document.body.dataset.sharedStatus || "local";
  const flashMessage = document.body.dataset.flashMessage || "";
  const flashTone = document.body.dataset.flashTone || "";
  const body = document.body;
  const title = body.dataset.pageTitle || "チェックリスト";
  const source = body.dataset.pageSource || "./list.md";
  const slug = body.dataset.pageSlug || slugify(title) || "page";
  const storageKey = `${STORAGE_PREFIX}${slug}`;
  const pageKey = slug;
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
    ${
      flashMessage
        ? `<p class="flash-message ${flashTone === "error" ? "flash-error" : ""}">${escapeHtml(flashMessage)}</p>`
        : ""
    }
    <section class="panel">
      <div class="summary-row">
        <div>
          <p class="section-label">Overview</p>
          <h2>進み具合</h2>
          <p class="summary-copy">${getSummaryCopy(sharedStatus)}</p>
          <div class="status-pills">
            <span class="status-pill ${sharedStatus === "shared" ? "status-pill-shared" : ""}">
              ${sharedStatus === "shared" ? "共有保存中" : "ローカル保存中"}
            </span>
            ${isSharedStorageEnabled() ? '<span class="status-pill">Supabase</span>' : ""}
          </div>
        </div>
        <div class="status-row">
          <button type="button" class="ghost-button" id="reload-shared">最新状態を再読込</button>
          <button type="button" class="ghost-button" id="reset-checks">このページのチェックをリセット</button>
        </div>
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
      ${sections.map((section, sectionIndex) => renderSection(section, state, pageKey, sectionIndex)).join("")}
    </section>
  `;

  mount.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.addEventListener("change", async (event) => {
      const target = event.currentTarget;
      const itemId = target.dataset.itemId;
      const field = target.dataset.field;
      const currentState = readStorage(storageKey);
      const nextState = {
        ...currentState,
        [itemId]: {
          ...(currentState[itemId] || {}),
          [field]: target.checked,
        },
      };

      writeStorage(storageKey, nextState);
      try {
        await writePageItemState(slug, itemId, nextState[itemId]);
        renderChecklist(markdown);
      } catch (error) {
        target.checked = !(target.checked);
        writeStorage(storageKey, currentState);
        renderChecklist(markdown);
        showPageMessage(error.message, "error");
      }
    });
  });

  mount.querySelectorAll("[data-sort-section]").forEach((button) => {
    button.addEventListener("click", () => {
      const sectionKey = button.dataset.sortSection;
      const fieldIndex = Number(button.dataset.sortField);
      const current = getUiState(pageKey)[sectionKey] || {};
      const isSameField = current.sortField === fieldIndex;
      const nextDirection = !isSameField ? "asc" : current.sortDirection === "asc" ? "desc" : "asc";
      updateSectionUiState(pageKey, sectionKey, { sortField: fieldIndex, sortDirection: nextDirection });
      renderChecklist(markdown);
    });
  });

  mount.querySelectorAll("[data-filter-section]").forEach((select) => {
    select.addEventListener("change", (event) => {
      const target = event.currentTarget;
      updateSectionUiState(pageKey, target.dataset.filterSection, { filterValue: target.value });
      renderChecklist(markdown);
    });
  });

  document.querySelector("#reload-shared")?.addEventListener("click", async () => {
    if (!isSharedStorageEnabled()) {
      showPageMessage("共有保存はまだ有効化されていません。", "error");
      renderChecklist(markdown);
      return;
    }

    try {
      const remoteState = await readPageState(slug);
      writeStorage(storageKey, remoteState || {});
      document.body.dataset.sharedStatus = "shared";
      showPageMessage("共有データを再読込しました。", "");
      renderChecklist(markdown);
    } catch (error) {
      showPageMessage(error.message, "error");
      renderChecklist(markdown);
    }
  });

  document.querySelector("#reset-checks")?.addEventListener("click", async () => {
    const previousState = readStorage(storageKey);
    localStorage.removeItem(storageKey);
    try {
      await clearPageState(slug);
      renderChecklist(markdown);
    } catch (error) {
      writeStorage(storageKey, previousState);
      showPageMessage(error.message, "error");
      renderChecklist(markdown);
    }
  });

  document.querySelector("#source-path").textContent = source;
  document.body.dataset.flashMessage = "";
  document.body.dataset.flashTone = "";
}

function getSummaryCopy(sharedStatus) {
  if (sharedStatus === "shared") {
    return "購入と準備は共有保存されます。別の利用者が更新した内容も、このページを開き直すと反映されます。";
  }
  return "購入と準備をそれぞれ保存できます。いまはこのブラウザ内だけに保存されます。";
}

function showPageMessage(message, tone) {
  if (!message) return;
  document.body.dataset.flashMessage = message;
  document.body.dataset.flashTone = tone || "";
}

function renderSection(section, state, pageKey, sectionIndex) {
  const sectionKey = `${slugify(section.title) || "section"}-${sectionIndex}`;
  const uiState = getUiState(pageKey)[sectionKey] || {};
  const filterFieldIndex = getFilterFieldIndex(section);
  const filterOptions = filterFieldIndex >= 0 ? getFilterOptions(section, filterFieldIndex) : [];
  const processedRows = applySectionView(section.rows, uiState, filterFieldIndex);
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
          <div class="section-tools">
            ${
              filterFieldIndex >= 0
                ? `
                  <label class="filter-group">
                    <span>${escapeHtml(section.rows[0].fields[filterFieldIndex].label)}で絞り込み</span>
                    <select data-filter-section="${escapeHtml(sectionKey)}">
                      <option value="">すべて</option>
                      ${filterOptions
                        .map(
                          (option) => `
                            <option value="${escapeHtml(option)}" ${uiState.filterValue === option ? "selected" : ""}>${escapeHtml(option)}</option>
                          `
                        )
                        .join("")}
                    </select>
                  </label>
                `
                : ""
            }
          </div>
        </div>
        <div class="section-progress">
          <span>購入 ${sectionMetrics.purchaseDone}/${sectionMetrics.items}</span>
          <span>準備 ${sectionMetrics.prepareDone}/${sectionMetrics.items}</span>
        </div>
      </div>
      <div class="list-table-wrap">
        <table class="list-table">
          <thead>
            <tr>
              ${section.rows[0].fields
                .map(
                  (field, fieldIndex) => `
                    <th>
                      <button
                        type="button"
                        class="sort-button"
                        data-sort-section="${escapeHtml(sectionKey)}"
                        data-sort-field="${fieldIndex}"
                      >
                        <span>${escapeHtml(field.label)}</span>
                        <span class="sort-indicator">${getSortIndicator(uiState, fieldIndex)}</span>
                      </button>
                    </th>
                  `
                )
                .join("")}
              <th>
                <button type="button" class="sort-button" data-sort-section="${escapeHtml(sectionKey)}" data-sort-field="-1">
                  <span>${escapeHtml(section.rows[0].purchaseLabel)}</span>
                  <span class="sort-indicator">${getSortIndicator(uiState, -1)}</span>
                </button>
              </th>
              <th>
                <button type="button" class="sort-button" data-sort-section="${escapeHtml(sectionKey)}" data-sort-field="-2">
                  <span>${escapeHtml(section.rows[0].prepareLabel)}</span>
                  <span class="sort-indicator">${getSortIndicator(uiState, -2)}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            ${
              processedRows.length
                ? processedRows.map((row) => renderRow(row, state[row.id] || {})).join("")
                : `<tr><td colspan="${section.rows[0].fields.length + 2}" class="empty-row">条件に合う項目はありません。</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function getFilterFieldIndex(section) {
  const labels = section.rows[0]?.fields.map((field) => field.label) || [];
  const priority = ["教科", "分類", "項目"];
  for (const label of priority) {
    const index = labels.indexOf(label);
    if (index >= 0) return index;
  }
  return labels.length ? 0 : -1;
}

function getFilterOptions(section, filterFieldIndex) {
  return [...new Set(section.rows.map((row) => row.fields[filterFieldIndex]?.value || "").filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ja")
  );
}

function applySectionView(rows, uiState, filterFieldIndex) {
  let result = [...rows];

  if (filterFieldIndex >= 0 && uiState.filterValue) {
    result = result.filter((row) => (row.fields[filterFieldIndex]?.value || "") === uiState.filterValue);
  }

  if (typeof uiState.sortField === "number") {
    result.sort((left, right) => compareRows(left, right, uiState.sortField, uiState.sortDirection || "asc"));
  }

  return result;
}

function compareRows(left, right, sortField, sortDirection) {
  const direction = sortDirection === "desc" ? -1 : 1;
  const leftValue = getSortableValue(left, sortField);
  const rightValue = getSortableValue(right, sortField);
  return leftValue.localeCompare(rightValue, "ja", { numeric: true, sensitivity: "base" }) * direction;
}

function getSortableValue(row, sortField) {
  if (sortField === -1) return row.purchase ? "1" : "0";
  if (sortField === -2) return row.prepare ? "1" : "0";
  return row.fields[sortField]?.value || "";
}

function getSortIndicator(uiState, fieldIndex) {
  if (uiState.sortField !== fieldIndex) return "↕";
  return uiState.sortDirection === "desc" ? "↓" : "↑";
}

function renderRow(row, rowState) {
  const purchaseChecked = rowState.purchase ?? row.purchase;
  const prepareChecked = rowState.prepare ?? row.prepare;

  return `
    <tr>
      ${row.fields.map((field) => `<td>${escapeHtml(field.value || "")}</td>`).join("")}
      <td class="check-cell">
        <label class="check-toggle compact-toggle">
          <input type="checkbox" data-item-id="${escapeHtml(row.id)}" data-field="purchase" ${purchaseChecked ? "checked" : ""}>
          <span>${escapeHtml(row.purchaseLabel)}</span>
        </label>
      </td>
      <td class="check-cell">
        <label class="check-toggle compact-toggle">
          <input type="checkbox" data-item-id="${escapeHtml(row.id)}" data-field="prepare" ${prepareChecked ? "checked" : ""}>
          <span>${escapeHtml(row.prepareLabel)}</span>
        </label>
      </td>
    </tr>
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
    const slug = document.body.dataset.pageSlug || slugify(document.body.dataset.pageTitle || "page");
    const response = await fetch(source, { cache: "no-store" });
    const markdown = await response.text();
    let sharedStatus = "local";

    if (isSharedStorageEnabled()) {
      try {
        const remoteState = await readPageState(slug);
        writeStorage(`${STORAGE_PREFIX}${slug}`, remoteState || {});
        sharedStatus = "shared";
      } catch (error) {
        showPageMessage(`${error.message} ローカル保存モードで表示しています。`, "error");
      }
    }

    document.body.dataset.sharedStatus = sharedStatus;
    renderChecklist(markdown);
  }
}

bootstrap().catch((error) => {
  const mount = document.querySelector("#app") || document.querySelector("#page-list");
  if (mount) {
    mount.innerHTML = `<p class="empty-state">ページの読み込みに失敗しました: ${escapeHtml(error.message)}</p>`;
  }
});

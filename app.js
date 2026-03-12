const qs = (sel, root = document) => root.querySelector(sel);

const MODE_LABELS = {
  mode1: "Режим 1",
  mode2: "Режим 2",
};

function getMode() {
  const url = new URL(window.location.href);
  return url.searchParams.get("mode") || "mode1";
}

function stateKey(mode) {
  return `svoya_igra_state_${mode}`;
}

function loadState(mode) {
  try {
    const raw = localStorage.getItem(stateKey(mode));
    if (!raw) return { score: 0, used: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("bad state");
    return {
      score: Number.isFinite(parsed.score) ? parsed.score : 0,
      used: parsed.used && typeof parsed.used === "object" ? parsed.used : {},
      quizSig: typeof parsed.quizSig === "string" ? parsed.quizSig : "",
      completedCats:
        parsed.completedCats && typeof parsed.completedCats === "object"
          ? parsed.completedCats
          : {},
    };
  } catch {
    return { score: 0, used: {}, quizSig: "" };
  }
}

function saveState(mode, state) {
  localStorage.setItem(stateKey(mode), JSON.stringify(state));
}

function quizSignature(quiz) {
  const title = quiz?.title ?? "";
  const cats = Array.isArray(quiz?.categories) ? quiz.categories : [];
  const catParts = cats.map((c) => {
    const name = c?.name ?? "";
    const count = Array.isArray(c?.questions) ? c.questions.length : 0;
    return `${name}:${count}`;
  });
  return `${title}|${catParts.join("|")}`;
}

function buildBoard(boardEl, quiz, state, openQuestion) {
  boardEl.innerHTML = "";
  const categories = quiz.categories || [];
  boardEl.style.setProperty("--cols", String(categories.length || 1));
  const maxDepth = Math.max(
    0,
    ...categories.map((c) => (c.questions ? c.questions.length : 0)),
  );

  for (let catIndex = 0; catIndex < categories.length; catIndex++) {
    const col = document.createElement("div");
    col.className = "col";

    const head = document.createElement("div");
    head.className = "col__head";
    head.textContent = categories[catIndex]?.name ?? `Категория ${catIndex + 1}`;
    col.appendChild(head);

    for (let qIndex = 0; qIndex < maxDepth; qIndex++) {
      const q = categories[catIndex]?.questions?.[qIndex];
      const value = q?.value ?? (qIndex + 1) * 100;

      if (!q) {
        const empty = document.createElement("div");
        empty.className = "tile tile--empty";
        empty.setAttribute("aria-hidden", "true");
        col.appendChild(empty);
        continue;
      }

      const btn = document.createElement("button");
      btn.className = "tile";
      btn.type = "button";
      btn.textContent = value;

      const id = `${catIndex}:${qIndex}`;
      const isUsed = Boolean(state.used[id]);
      if (isUsed) btn.classList.add("is-used");
      if (isUsed) btn.disabled = true;

      btn.addEventListener("click", () => {
        openQuestion({ catIndex, qIndex, value, q });
      });

      col.appendChild(btn);
    }

    boardEl.appendChild(col);
  }
}

function renderOptions(optionsEl, options) {
  optionsEl.innerHTML = "";
  if (!Array.isArray(options) || options.length === 0) return;
  for (const opt of options) {
    const card = document.createElement("div");
    card.className = "opt";

    const head = document.createElement("div");
    head.className = "opt__head";

    const label = document.createElement("div");
    label.className = "opt__label";
    label.textContent = opt.label || "";

    const text = document.createElement("div");
    text.className = "opt__text";
    text.textContent = opt.text || "";

    head.appendChild(label);
    head.appendChild(text);
    card.appendChild(head);

    if (opt.image) {
      const img = document.createElement("img");
      img.className = "opt__img";
      img.loading = "lazy";
      img.alt = opt.text ? `${opt.label}: ${opt.text}` : `Вариант ${opt.label}`;
      img.src = opt.image;
      card.appendChild(img);
    }

    optionsEl.appendChild(card);
  }
}

async function loadQuiz(mode) {
  const jsCandidates = [`./questions_${mode}.js`, `./data/${mode}/questions.js`];

  const loadScriptQuiz = (src) =>
    new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;

      script.onload = () => {
        const quiz = window.SVOYA_IGRA_QUIZ;
        delete window.SVOYA_IGRA_QUIZ;
        if (!quiz) {
          reject(new Error(`В ${src} не найдено window.SVOYA_IGRA_QUIZ`));
          return;
        }
        resolve(quiz);
      };
      script.onerror = () => reject(new Error(`Не удалось загрузить ${src}`));

      document.head.appendChild(script);
    });

  for (const src of jsCandidates) {
    try {
      return await loadScriptQuiz(src);
    } catch {
      // try next
    }
  }

  const jsonCandidates = [`./questions_${mode}.json`, `./data/${mode}/questions.json`];
  for (const src of jsonCandidates) {
    const res = await fetch(src, { cache: "no-store" });
    if (res.ok) return res.json();
  }
  throw new Error(`Нет файлов вопросов для ${mode}`);
}

function fmtScore(n) {
  return n >= 0 ? String(n) : `−${Math.abs(n)}`;
}

function isAllThrees(n) {
  const s = String(Math.abs(n));
  return /^3+$/.test(s);
}

function normUsedValue(v) {
  // Old saves: boolean true. New saves: number delta (+value / -value).
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return 0;
}

async function main() {
  const mode = getMode();
  const modeTitle = qs("#modeTitle");
  const scoreValue = qs("#scoreValue");
  const boardEl = qs("#board");
  const resetBtn = qs("#resetBtn");
  const homeBtn = qs("#homeBtn");

  const modal = qs("#qModal");
  const modalCat = qs("#modalCat");
  const modalValue = qs("#modalValue");
  const modalQ = qs("#modalQ");
  const modalOptions = qs("#modalOptions");
  const answerWrap = qs("#answerWrap");
  const modalA = qs("#modalA");
  const revealBtn = qs("#revealBtn");
  const plusBtn = qs("#plusBtn");
  const minusBtn = qs("#minusBtn");

  const resultModal = qs("#resultModal");
  const resultCat = qs("#resultCat");
  const resultAch = qs("#resultAch");
  const resultCount = qs("#resultCount");
  const resultDelta = qs("#resultDelta");
  const resultTotal = qs("#resultTotal");
  const resultEaster = qs("#resultEaster");

  modeTitle.textContent = MODE_LABELS[mode] || mode;

  const state = loadState(mode);
  scoreValue.textContent = fmtScore(state.score);

  let quiz;
  try {
    quiz = await loadQuiz(mode);
  } catch (e) {
    boardEl.innerHTML =
      `<div class="col__head">` +
      `Нет данных для режима: ${mode}.<br/>` +
      `Нужен файл <span style="font-family:var(--font2)">questions_${mode}.js</span> (или <span style="font-family:var(--font2)">questions_${mode}.json</span>).` +
      `</div>`;
    return;
  }

  if (quiz?.title) {
    modeTitle.textContent = `${MODE_LABELS[mode] || mode} · ${quiz.title}`;
  }

  // If the quiz content changed (we renamed/removed categories), old saved "used" cells
  // can disable random tiles. Reset state in that case.
  const sig = quizSignature(quiz);
  if (sig && state.quizSig !== sig) {
    state.score = 0;
    state.used = {};
    state.quizSig = sig;
    state.completedCats = {};
    saveState(mode, state);
    scoreValue.textContent = fmtScore(0);
  }

  let active = null;
  let pendingCatCheck = null;

  const categoryMetrics = (catIndex) => {
    const cat = quiz.categories?.[catIndex];
    const qList = Array.isArray(cat?.questions) ? cat.questions : [];
    let answered = 0;
    let plusCount = 0;
    let minusCount = 0;
    let delta = 0;
    for (let qIndex = 0; qIndex < qList.length; qIndex++) {
      const id = `${catIndex}:${qIndex}`;
      if (!state.used[id]) continue;
      answered++;
      const d = normUsedValue(state.used[id]);
      delta += d;
      if (d > 0) plusCount++;
      if (d < 0) minusCount++;
    }
    return {
      name: cat?.name ?? "",
      total: qList.length,
      answered,
      plusCount,
      minusCount,
      delta,
    };
  };

  const achievementFor = (m) => {
    if (m.total === 0) return "Раздел пустой";
    if (m.answered < m.total) return "В процессе";
    const maxPossible = (m.total * (m.total + 1)) / 2 * 100;
    if (m.minusCount === 0 && m.delta === maxPossible) return "Идеальный раунд";
    if (m.minusCount === 0) return "Чистая победа";
    if (m.plusCount === 0) return "Суровый урок";
    if (m.delta < 0) return "Тяжелая полоса";
    return "Боевой зачет";
  };

  const showCategoryResult = (catIndex) => {
    const m = categoryMetrics(catIndex);
    resultCat.textContent = m.name || "Раздел";
    resultAch.textContent = achievementFor(m);
    resultCount.textContent = `${m.answered}/${m.total}`;
    resultDelta.textContent = fmtScore(m.delta);
    resultTotal.textContent = fmtScore(state.score);

    const easter = isAllThrees(state.score);
    if (easter) {
      resultEaster.hidden = false;
      resultEaster.textContent =
        `Счет ${Math.abs(state.score)}: отсылка на Макса Ферстаппена (его номер 33).`;
    } else {
      resultEaster.hidden = true;
      resultEaster.textContent = "";
    }

    resultModal.showModal();
  };

  const openQuestion = ({ catIndex, qIndex, value, q }) => {
    active = { catIndex, qIndex, value, q };

    modalCat.textContent = quiz.categories?.[catIndex]?.name ?? "";
    modalValue.textContent = `${value}`;
    modalQ.textContent = q.question || "";
    renderOptions(modalOptions, q.options);

    answerWrap.hidden = true;
    revealBtn.textContent = "Показать ответ";
    modalA.textContent = q.answer || "Ответ не указан";

    plusBtn.textContent = `+${value}`;
    minusBtn.textContent = `-${value}`;

    modal.showModal();
  };

  const markUsed = () => {
    if (!active) return;
    const id = `${active.catIndex}:${active.qIndex}`;
    // Default old behavior: "used". New: set exact delta later.
    if (!state.used[id]) state.used[id] = true;
    saveState(mode, state);
  };

  const updateScore = (delta) => {
    state.score += delta;
    scoreValue.textContent = fmtScore(state.score);
    saveState(mode, state);
  };

  revealBtn.addEventListener("click", () => {
    const willShow = answerWrap.hidden;
    answerWrap.hidden = !willShow;
    revealBtn.textContent = willShow ? "Скрыть ответ" : "Показать ответ";
  });

  plusBtn.addEventListener("click", () => {
    if (!active) return;
    updateScore(active.value);
    const id = `${active.catIndex}:${active.qIndex}`;
    state.used[id] = active.value;
    saveState(mode, state);
    pendingCatCheck = active.catIndex;
    modal.close();
  });

  minusBtn.addEventListener("click", () => {
    if (!active) return;
    updateScore(-active.value);
    const id = `${active.catIndex}:${active.qIndex}`;
    state.used[id] = -active.value;
    saveState(mode, state);
    pendingCatCheck = active.catIndex;
    modal.close();
  });

  modal.addEventListener("close", () => {
    active = null;
    buildBoard(boardEl, quiz, state, openQuestion);

    if (pendingCatCheck !== null) {
      const idx = pendingCatCheck;
      pendingCatCheck = null;
      const m = categoryMetrics(idx);
      if (m.total > 0 && m.answered === m.total && !state.completedCats[String(idx)]) {
        state.completedCats[String(idx)] = true;
        saveState(mode, state);
        showCategoryResult(idx);
      }
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.open) return;
    if (!modal.open) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      revealBtn.click();
    }
  });

  resetBtn.addEventListener("click", () => {
    localStorage.removeItem(stateKey(mode));
    state.score = 0;
    state.used = {};
    state.completedCats = {};
    scoreValue.textContent = fmtScore(0);
    buildBoard(boardEl, quiz, state, openQuestion);
  });

  homeBtn.addEventListener("click", () => {
    window.location.href = "./index.html";
  });

  buildBoard(boardEl, quiz, state, openQuestion);
}

main();

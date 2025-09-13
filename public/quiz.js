import { auth, provider, db } from "./firebase.js";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// --- Autosave Drafts ---
let user = null;
let quizData = null;
let currentQuizId = null;
let questions = [];
let currentQuestionIndex = 0;
let answers = {};
let quizSubmitted = false;
let registrationNumber = null;

const globalTimerDiv = document.getElementById("global-timer");
const questionTimerDiv = document.getElementById("question-timer");
const questionBox = document.getElementById("question-box");
const questionSlider = document.getElementById("question-slider");
const optionsBox = document.getElementById("options-box");
const nextBtn = document.getElementById("next-btn");
const submitBtn = document.getElementById("submit-btn");
const resultSection = document.getElementById("result-section");
const resultText = document.getElementById("result-text");
const quizTitleEl = document.getElementById("quiz-title");
const draftStatus = document.getElementById("draft-status");

// --- Anti-cheat: enforce on quiz ---
function enforceAntiCheat() {
  document.addEventListener("contextmenu", e => e.preventDefault());
  document.addEventListener("copy", e => e.preventDefault());
  document.addEventListener("paste", e => e.preventDefault());
  document.addEventListener("keydown", e => {
    if (e.key === "F12" || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "i")) e.preventDefault();
    if (e.ctrlKey && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "v")) e.preventDefault();
    if (e.key === "Tab") e.preventDefault();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) autoSubmitQuiz();
  });
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) autoSubmitQuiz();
  });
}
enforceAntiCheat();

// --- Fullscreen on load ---
window.onload = () => {
  function showFullscreenPrompt() {
    let msg = document.getElementById('fullscreen-msg');
    if (!msg) {
      msg = document.createElement('div');
      msg.id = 'fullscreen-msg';
      msg.style = 'color: #ff5252; font-size: 1.1em; margin-bottom: 12px; text-align:center;';
      msg.innerHTML = 'Please enable fullscreen mode to continue the quiz.<br>';
      const btn = document.createElement('button');
      btn.innerText = 'Go Fullscreen';
      btn.className = 'btn-accent';
      btn.onclick = () => {
        const el = document.documentElement;
        if (el.requestFullscreen) el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        else if (el.msRequestFullscreen) el.msRequestFullscreen();
      };
      msg.appendChild(btn);
      document.body.prepend(msg);
    }
  }
  function removeFullscreenPrompt() {
    const msg = document.getElementById('fullscreen-msg');
    if (msg) msg.remove();
  }
  if (!document.fullscreenElement) {
    showFullscreenPrompt();
  }
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
      removeFullscreenPrompt();
    } else {
      showFullscreenPrompt();
    }
  });
};

// --- Quiz state from sessionStorage (set by student.js) ---
user = JSON.parse(sessionStorage.getItem("quizUser"));
registrationNumber = sessionStorage.getItem("quizRegNum");
currentQuizId = sessionStorage.getItem("quizId");

if (!user || !registrationNumber || !currentQuizId) {
  window.location.href = "student.html";
}

// --- Draft Autosave/Restore ---
function autosaveDraft() {
  if (!currentQuizId || !registrationNumber) return;
  const draft = {
    quizId: currentQuizId,
    registrationNumber,
    answers,
    currentQuestionIndex
  };
  sessionStorage.setItem('quizDraft', JSON.stringify(draft));
  if (draftStatus) {
    draftStatus.style.display = "block";
    draftStatus.innerText = "Draft autosaved.";
    setTimeout(() => { draftStatus.style.display = "none"; }, 1500);
  }
}
setInterval(autosaveDraft, 20000); // Save every 20 seconds

function restoreDraftIfAvailable() {
  const draftStr = sessionStorage.getItem('quizDraft');
  if (draftStr) {
    try {
      const draft = JSON.parse(draftStr);
      if (
        draft.quizId === currentQuizId &&
        draft.registrationNumber === registrationNumber
      ) {
        answers = draft.answers || {};
        currentQuestionIndex = draft.currentQuestionIndex || 0;
        if (draftStatus) {
          draftStatus.style.display = "block";
          draftStatus.innerText = "Draft restored! Continue from where you left off.";
          setTimeout(() => { draftStatus.style.display = "none"; }, 2500);
        }
        return true;
      }
    } catch (e) {}
  }
  return false;
}

// --- Load quiz data and start ---
(async function() {
  const quizDoc = await getDoc(doc(db, "quizzes", currentQuizId));
  quizData = quizDoc.data();
  if (quizTitleEl) quizTitleEl.innerText = quizData.quizName || "Quiz";
  // Quiz status check
  const now = new Date();
  const startDate = quizData.startDate ? new Date(quizData.startDate) : null;
  const endDate = quizData.endDate ? new Date(quizData.endDate) : null;
  if (startDate && now < startDate) {
    alert(`Quiz has not started yet. Starts at: ${startDate.toLocaleString()}`);
    window.location.href = "student.html";
    return;
  }
  if (endDate && now > endDate) {
    alert(`Quiz has expired. Ended at: ${endDate.toLocaleString()}`);
    window.location.href = "student.html";
    return;
  }
  const csvQuestions = await parseCSV(quizData.questionsCsvUrl);
  let globalTimer = 15 * 60;
  const globalTimerRow = csvQuestions.find(q => q.global_timer);
  if (globalTimerRow && !isNaN(Number(globalTimerRow.global_timer))) {
    globalTimer = Number(globalTimerRow.global_timer);
  }
  questions = csvQuestions.filter(q => q.question && q.question.trim());
  shuffleArray(questions);
  startGlobalTimer(globalTimer);
  if (!restoreDraftIfAvailable()) {
    currentQuestionIndex = 0;
    answers = {};
  }
  renderQuestion();
})();

function parseCSV(url) {
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      download: true,
      header: true,
      complete: (results) => resolve(results.data),
      error: reject,
    });
  });
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

let globalTimerInterval = null;
let questionTimerInterval = null;
function startGlobalTimer(timeLeft) {
  updateGlobalTimerDisplay(timeLeft);
  globalTimerInterval = setInterval(() => {
    timeLeft--;
    updateGlobalTimerDisplay(timeLeft);
    if (timeLeft <= 0) {
      clearInterval(globalTimerInterval);
      autoSubmitQuiz('timer');
    }
  }, 1000);
}
function updateGlobalTimerDisplay(timeLeft) {
  const min = Math.floor(timeLeft / 60);
  const sec = timeLeft % 60;
  globalTimerDiv.textContent = `Quiz Time Left: ${min}:${sec.toString().padStart(2, '0')}`;
}

function startQuestionTimer(seconds) {
  clearInterval(questionTimerInterval);
  let timeLeft = seconds;
  updateQuestionTimerDisplay(timeLeft);
  questionTimerInterval = setInterval(() => {
    timeLeft--;
    updateQuestionTimerDisplay(timeLeft);
    if (timeLeft <= 0) {
      clearInterval(questionTimerInterval);
      answers[`q${currentQuestionIndex + 1}`] = null;
      currentQuestionIndex++;
      autosaveDraft();
      renderQuestion();
    }
  }, 1000);
}
function updateQuestionTimerDisplay(timeLeft) {
  questionTimerDiv.textContent = `Time left for this question: ${timeLeft}s`;
}

function autoSubmitQuiz(reason) {
  if (quizSubmitted) return;
  quizSubmitted = true;
  nextBtn.disabled = true;
  submitBtn.disabled = true;
  const radios = document.querySelectorAll('input[type="radio"]');
  const checks = document.querySelectorAll('input[type="checkbox"]');
  const texts = document.querySelectorAll('input[type="text"]');
  radios.forEach(el => el.disabled = true);
  checks.forEach(el => el.disabled = true);
  texts.forEach(el => el.disabled = true);
  if (reason === 'timer') alert("Time's up! Submitting your quiz.");
  else alert("Quiz auto-submitted due to anti-cheat.");
  submitBtn.click();
}

// Helper for checked status when restoring answers
function answerChecked(q, opt) {
  const ans = answers[`q${currentQuestionIndex+1}`];
  if (q.type === "single") {
    return ans === opt ? "checked" : "";
  }
  if (q.type === "multi") {
    return Array.isArray(ans) && ans.includes(opt) ? "checked" : "";
  }
  return "";
}

function renderQuestion() {
  if (currentQuestionIndex >= questions.length) {
    optionsBox.innerHTML = "<p>All questions done. Please submit.</p>";
    nextBtn.style.display = "none";
    submitBtn.style.display = "block";
    questionTimerDiv.textContent = "";
    clearInterval(questionTimerInterval);
    return;
  }
  submitBtn.style.display = "none";
  nextBtn.style.display = "block";
  const q = questions[currentQuestionIndex];
  let qTime = 30;
  if (q.timer && !isNaN(Number(q.timer))) qTime = Number(q.timer);
  startQuestionTimer(qTime);

  // Slider box logic
  const visibleChars = Math.ceil((q.question || '').length / 2);
  questionSlider.value = 0;
  questionSlider.max = Math.max(0, (q.question || '').length - visibleChars);
  function updateSliderBox() {
    const start = Number(questionSlider.value);
    const end = start + visibleChars;
    const visibleText = (q.question || '').substring(start, end);
    questionBox.innerHTML = `<div style="width:350px; overflow:hidden; border:1px solid var(--border2); background:var(--card); padding:8px 12px; font-size:1.1em; margin-bottom:10px; white-space:nowrap;">${visibleText}</div>`;
  }
  questionSlider.oninput = updateSliderBox;
  updateSliderBox();

  // Show options and restore if draft present
  let html = '';
  if (q.type === "single") {
    html += q.options.split(";").map((opt, i) =>
      `<div style="display:flex;align-items:center;margin-bottom:8px;">
        <input type="radio" name="option" value="${opt}" id="opt${i}" style="margin-right:10px;" ${answerChecked(q, opt)} />
        <label for="opt${i}" style="margin:0;">${opt}</label>
      </div>`
    ).join("");
  } else if (q.type === "multi") {
    html += q.options.split(";").map((opt, i) =>
      `<div style="display:flex;align-items:center;margin-bottom:8px;">
        <input type="checkbox" name="option" value="${opt}" id="opt${i}" style="margin-right:10px;" ${answerChecked(q, opt)} />
        <label for="opt${i}" style="margin:0;">${opt}</label>
      </div>`
    ).join("");
  } else if (q.type === "text") {
    html += `<input type="text" id="text-answer" value="${answers[`q${currentQuestionIndex+1}`] || ""}" />`;
  }
  optionsBox.innerHTML = html;

  // For single option: auto-advance on select
  if (q.type === "single") {
    document.querySelectorAll('input[type="radio"][name="option"]').forEach(radio => {
      radio.addEventListener('change', function() {
        if (this.checked) {
          clearInterval(questionTimerInterval);
          answers[`q${currentQuestionIndex + 1}`] = this.value;
          currentQuestionIndex++;
          autosaveDraft();
          renderQuestion();
        }
      });
    });
  }
}

nextBtn.onclick = () => {
  clearInterval(questionTimerInterval);
  const q = questions[currentQuestionIndex];
  let ans = null;
  if (q.type === "single") {
    const selected = document.querySelector('input[name="option"]:checked');
    if (!selected) return alert("Select an option");
    ans = selected.value;
  } else if (q.type === "multi") {
    const selected = Array.from(document.querySelectorAll('input[name="option"]:checked')).map(el => el.value);
    if (selected.length === 0) return alert("Select at least one option");
    ans = selected;
  } else if (q.type === "text") {
    ans = document.getElementById("text-answer").value.trim();
    if (!ans) return alert("Enter your answer");
  }
  answers[`q${currentQuestionIndex + 1}`] = ans;
  currentQuestionIndex++;
  autosaveDraft();
  renderQuestion();
};

submitBtn.onclick = async () => {
  let score = 0;
  questions.forEach((q, i) => {
    const userAns = answers[`q${i + 1}`];
    if (!q.answer) return;
    if (q.type === "single" || q.type === "text") {
      if ((userAns || "").toLowerCase().trim() === (q.answer || "").toLowerCase().trim()) score++;
    } else if (q.type === "multi") {
      const correct = (q.answer || "").split(";").map(x => x.trim()).sort();
      const userAnsArr = (userAns || []).map(x => x.trim()).sort();
      if (JSON.stringify(correct) === JSON.stringify(userAnsArr)) score++;
    }
  });
  await setDoc(doc(db, "quizzes", currentQuizId, "responses", user.uid), {
    registrationNumber,
    email: user.email,
    answers,
    score,
    status: quizSubmitted ? "autosubmitted" : "submitted",
    attemptedAt: new Date(),
  });
  sessionStorage.removeItem('quizDraft'); // Clear draft upon submit
  quizSubmitted = true;
  quizBoxDisable();
  resultSection.style.display = "block";
  resultText.innerText = `Quiz submitted! Registration number: ${registrationNumber}\nScore: ${score}`;
  setTimeout(() => {
    window.location.href = "results.html";
  }, 2000);
};

function quizBoxDisable() {
  nextBtn.disabled = true;
  submitBtn.disabled = true;
  Array.from(document.querySelectorAll('input')).forEach(el => el.disabled = true);
}
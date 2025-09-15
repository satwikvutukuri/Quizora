import { auth, provider, db } from "./firebase.js";
import {
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// --- State variables ---
let user = null;
let quizData = null;
let currentQuizId = null;
let questions = [];
let currentQuestionIndex = 0;
let answers = {};
let quizSubmitted = false;
let registrationNumber = null;
let autoSubmitReason = null; // For tracking autosubmission reason

const globalTimerDiv = document.getElementById("global-timer");
const questionTimerDiv = document.getElementById("question-timer");
const questionBox = document.getElementById("question-box");
const questionSlider = document.getElementById("question-slider");
const optionsBox = document.getElementById("options-box");
const nextBtn = document.getElementById("next-btn");
const submitBtn = document.getElementById("submit-btn");
const resultSection = document.getElementById("result-section");
const resultText = document.getElementById("result-text");

// --- Anti-cheat enforcement ---
function enforceAntiCheat() {
  document.addEventListener("contextmenu", e => e.preventDefault());
  document.addEventListener("copy", e => e.preventDefault());
  document.addEventListener("paste", e => e.preventDefault());
  document.addEventListener("keydown", e => {
    if (
      e.key === "F12" ||
      (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "i") ||
      (e.ctrlKey && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "v")) ||
      e.key === "Tab" ||
      e.key === "PrintScreen" ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "4" || e.key === "3")) ||
      (e.key === "S" && e.shiftKey && (e.ctrlKey || e.metaKey))
    ) {
      e.preventDefault();
      autoSubmitQuiz('anticheat');
    }
  });
  document.addEventListener("keyup", e => {
    if (
      e.key === "PrintScreen" ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "4" || e.key === "3")) ||
      (e.key === "S" && e.shiftKey && (e.ctrlKey || e.metaKey))
    ) {
      autoSubmitQuiz('anticheat');
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) autoSubmitQuiz('anticheat');
  });
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) autoSubmitQuiz('anticheat');
  });
}
enforceAntiCheat();

// --- Fullscreen enforcement on load ---
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

// --- Get quiz session state ---
user = JSON.parse(sessionStorage.getItem("quizUser"));
registrationNumber = sessionStorage.getItem("quizRegNum");
currentQuizId = sessionStorage.getItem("quizId");

if (!user || !registrationNumber || !currentQuizId) {
  window.location.href = "student.html";
}

let globalTimerInterval = null;
let questionTimerInterval = null;

function clearAllTimers() {
  if (globalTimerInterval) clearInterval(globalTimerInterval);
  if (questionTimerInterval) clearInterval(questionTimerInterval);
}

// --- Load quiz data and start logic ---
(async function() {
  const quizDoc = await getDoc(doc(db, "quizzes", currentQuizId));
  quizData = quizDoc.data();

  // --- Time window check ---
  const now = new Date();
  let quizStart = quizData.quizStart ? new Date(quizData.quizStart) : null;
  let quizEnd = quizData.quizEnd ? new Date(quizData.quizEnd) : null;

  if (quizStart && now < quizStart) {
    document.body.innerHTML = `<div style="color:#e85d6f;max-width:450px;margin:80px auto;font-size:1.3em;text-align:center;background:#18223a;padding:32px 16px;border-radius:16px;">
      Quiz not started yet.<br>Please come back at <b>${quizStart.toLocaleString()}</b>.
    </div>`;
    return;
  }
  if (quizEnd && now > quizEnd) {
    document.body.innerHTML = `<div style="color:#e85d6f;max-width:450px;margin:80px auto;font-size:1.3em;text-align:center;background:#18223a;padding:32px 16px;border-radius:16px;">
      Quiz is now closed.<br>It ended at <b>${quizEnd.toLocaleString()}</b>.
    </div>`;
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
  autoSubmitReason = reason;
  clearAllTimers();
  nextBtn.disabled = true;
  submitBtn.disabled = true;
  document.querySelectorAll('input[type="radio"]').forEach(el => el.disabled = true);
  document.querySelectorAll('input[type="checkbox"]').forEach(el => el.disabled = true);
  document.querySelectorAll('input[type="text"]').forEach(el => el.disabled = true);

  if (reason === 'timer') {
    alert("Time's up! Submitting your quiz.");
  } else if (reason === 'anticheat') {
    alert("Quiz auto-submitted due to anti-cheat (window/tab switch, fullscreen exit, or screenshot).");
  } else {
    alert("Quiz auto-submitted.");
  }
  submitBtn.click();
}

// ----------- UI LOGIC (LIKE THE REFERENCE IMAGE!) -----------
function renderQuestion() {
  document.getElementById("quiz-main")?.classList.add("quiz-centered");
  // Add no-select CSS, disable selection
  if (!document.getElementById('no-select-style')) {
    const style = document.createElement('style');
    style.id = 'no-select-style';
    style.innerHTML = `
      .no-select, .no-select * {
        user-select: none !important;
        -webkit-user-select: none !important;
        -ms-user-select: none !important;
        -moz-user-select: none !important;
        pointer-events: auto;
      }
    `;
    document.head.appendChild(style);
  }
  questionBox.classList.add('no-select');
  optionsBox.classList.add('no-select');
  ['copy','cut','selectstart','contextmenu'].forEach(evt => {
    questionBox["on"+evt] = null;
    optionsBox["on"+evt] = null;
  });
  ['copy','cut','selectstart','contextmenu'].forEach(evt => {
    questionBox.addEventListener(evt, e => e.preventDefault());
    optionsBox.addEventListener(evt, e => e.preventDefault());
  });
  document.addEventListener('copy', e => e.preventDefault());
  document.addEventListener('cut', e => e.preventDefault());
  document.addEventListener('selectstart', e => e.preventDefault());
  document.addEventListener('contextmenu', e => e.preventDefault());
  questionBox.classList.add('no-select');
  questionBox.oncopy = e => { e.preventDefault(); };
  questionBox.onselectstart = e => { e.preventDefault(); };

  // Ensure fullscreen for every question
  if (!document.fullscreenElement) {
    function goFullscreen() {
      const el = document.documentElement;
      if (!document.fullscreenElement) {
        if (el.requestFullscreen) el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        else if (el.msRequestFullscreen) el.msRequestFullscreen();
      }
    }
    goFullscreen();
    setTimeout(() => {
      if (!document.fullscreenElement) {
        let msg = document.getElementById('fullscreen-msg');
        if (!msg) {
          msg = document.createElement('div');
          msg.id = 'fullscreen-msg';
          msg.style = 'color: #ff5252; font-size: 1.1em; margin-bottom: 12px; text-align:center;';
          msg.innerText = 'Please enable fullscreen mode to continue the quiz.';
          document.body.prepend(msg);
        }
        goFullscreen();
      } else {
        const msg = document.getElementById('fullscreen-msg');
        if (msg) msg.remove();
      }
    }, 500);
  }

  if (currentQuestionIndex >= questions.length) {
    // Instead of showing "All questions done. Please submit.", we auto-submit and show results
    handleQuizCompletion();
    return;
  }

  const q = questions[currentQuestionIndex];
  let qTime = 30;
  if (q.timer && !isNaN(Number(q.timer))) qTime = Number(q.timer);
  startQuestionTimer(qTime);

  // --- IMAGE HANDLING ---
  let imageHtml = "";
  if (q.image && q.image.trim().length > 0) {
    imageHtml = `<img src="${q.image}" alt="Question Image" style="max-width:250px;max-height:140px;display:block;margin:0 auto 18px auto;border-radius:12px;box-shadow:0 2px 10px #111c2d66;">`;
  }

  // --- QUESTION TEXT & SLIDER (like reference) ---
  const visibleChars = Math.ceil((q.question || '').length / 2);
  questionSlider.value = 0;
  questionSlider.max = Math.max(0, (q.question || '').length - visibleChars);
  function updateSliderBox() {
    const start = Number(questionSlider.value);
    const end = start + visibleChars;
    const visibleText = (q.question || '').substring(start, end);
    questionBox.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;">
        ${imageHtml}
        <div class="question-centered-box">
          ${visibleText}
        </div>
        <input type="range" id="question-slider-internal" min="0" max="${Math.max(0, (q.question || '').length - visibleChars)}" value="${questionSlider.value}" style="width:90%;max-width:480px;margin:0 0 0 0;">
      </div>
    `;
    // Sync main slider and card slider
    const sliderInternal = document.getElementById("question-slider-internal");
    if (sliderInternal) {
      sliderInternal.value = questionSlider.value;
      sliderInternal.oninput = function() {
        questionSlider.value = this.value;
        updateSliderBox();
      };
    }
    questionSlider.oninput = function() {
      if (sliderInternal) sliderInternal.value = this.value;
      updateSliderBox();
    };
  }
  updateSliderBox();

  // --- OPTIONS ---
  let html = '';
  if (q.type === "single") {
    html += q.options.split(";").map((opt, i) =>
      `<div class="option-row">
        <input type="radio" name="option" value="${opt}" id="opt${i}" />
        <label for="opt${i}" style="margin:0;">${opt}</label>
      </div>`
    ).join("");
  } else if (q.type === "multi") {
    html += q.options.split(";").map((opt, i) =>
      `<div class="option-row">
        <input type="checkbox" name="option" value="${opt}" id="opt${i}" />
        <label for="opt${i}" style="margin:0;">${opt}</label>
      </div>`
    ).join("");
  } else if (q.type === "text") {
    html += `<input type="text" id="text-answer" class="option-row" style="width:95%;max-width:420px;padding:15px 12px;font-size:1.09em;">`;
  }
  optionsBox.innerHTML = html;

  // --- AUTO-NEXT on single option select ONLY ---
  if (q.type === "single") {
    nextBtn.style.display = "none";
    document.querySelectorAll('input[type="radio"][name="option"]').forEach(radio => {
      radio.addEventListener('change', function() {
        if (this.checked) {
          clearInterval(questionTimerInterval);
          answers[`q${currentQuestionIndex + 1}`] = this.value;
          currentQuestionIndex++;
          renderQuestion();
        }
      });
    });
  } else if (q.type === "multi" || q.type === "text") {
    // Show next button, do NOT auto-advance
    nextBtn.style.display = "block";
  }
  // Submit button will only be shown in the "all questions done" state (handled separately).
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
  renderQuestion();
};

// --- NEW: handleQuizCompletion shows result and score in same window ---
async function handleQuizCompletion() {
  clearAllTimers();
  // Calculate score
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

  let status = autoSubmitReason ? "autosubmitted" : "submitted";
  let autoReason = autoSubmitReason
    ? (autoSubmitReason === "anticheat"
        ? "Student left window/tab or exited fullscreen or screenshot"
        : autoSubmitReason)
    : "";

  // Save to Firestore (same as before)
  await setDoc(doc(db, "quizzes", currentQuizId, "responses", user.uid), {
    registrationNumber,
    email: user.email,
    answers,
    score,
    attemptedAt: new Date(),
    status,
    autoSubmitReason: autoReason
  });
  sessionStorage.setItem("quizResult", JSON.stringify({ registrationNumber, score, status, autoSubmitReason: autoReason }));

  // Show result on the same page
  questionBox.innerHTML = "";
  optionsBox.innerHTML = "";
  nextBtn.style.display = "none";
  submitBtn.style.display = "none";
  questionTimerDiv.textContent = "";
  globalTimerDiv.textContent = "";

  // Show result section
  resultSection.style.display = "block";
  resultText.innerHTML = `
    <div style="color:var(--accent2);font-size:1.35em;font-weight:bold;margin-bottom:8px;">
      Quiz successfully submitted!
    </div>
    <div style="font-size:1.2em;color:var(--text);margin-bottom:10px;">
      Your Score: <b>${score}</b> out of <b>${questions.length}</b>
    </div>
    <div style="color:var(--muted);font-size:1em;">
      ${status === "autosubmitted" ? "(Quiz was automatically submitted)" : ""}
    </div>
  `;
}

submitBtn.onclick = async () => {
  // When submit button is clicked, just call handleQuizCompletion
  await handleQuizCompletion();
};
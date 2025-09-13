import { auth, provider, db } from "./firebase.js";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  setDoc,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// --- GLOBALS ---
const errorMsgDiv = document.getElementById("reg-error-msg");

let user = null;
let quizData = null;
let currentQuizId = null;

let questions = [];
let currentQuestionIndex = 0;
let answers = {};
let registrationNumber = null;
let quizAllowedEmails = [];

// Timer variables
let globalTimer = 15 * 60; // default 15 min in seconds
let globalTimerInterval = null;
let questionTimer = 30; // default per-question timer in seconds
let questionTimerInterval = null;

const globalTimerDiv = document.getElementById("global-timer");
const questionTimerDiv = document.getElementById("question-timer");
const sliderWrap = document.getElementById("slider-reveal-wrap");
const revealSlider = document.getElementById("reveal-slider");

const loginBtn = document.getElementById("login-btn");
const regNumInput = document.getElementById("reg-num");
const regNumLockBtn = document.getElementById("lock-reg-btn");
const quizSection = document.getElementById("quiz-section");
const questionContainer = document.getElementById("question-container");
const submitBtn = document.getElementById("submit-btn");
const resultSection = document.getElementById("result-section");
const resultText = document.getElementById("result-text");

// Add: View Results Button (for students who already attempted)
let viewResultsBtn = document.getElementById("view-results-btn");
if (!viewResultsBtn) {
  viewResultsBtn = document.createElement("button");
  viewResultsBtn.id = "view-results-btn";
  viewResultsBtn.textContent = "View Previous Results";
  viewResultsBtn.style.display = "none";
  regNumInput.parentElement.appendChild(viewResultsBtn);
}

viewResultsBtn.onclick = async () => {
  if (!currentQuizId || !user) return;
  const respDoc = await getDoc(doc(db, "quizzes", currentQuizId, "responses", user.uid));
  if (respDoc.exists()) {
    const resp = respDoc.data();
    alert(
      `Registration Number: ${resp.registrationNumber}\n` +
      `Score: ${resp.score}\n` +
      `Submitted At: ${resp.attemptedAt?.toDate?.() ?? resp.attemptedAt}\n` +
      `Answers: ${JSON.stringify(resp.answers, null, 2)}`
    );
  } else {
    alert("No results found.");
  }
};

// Helper: Parse CSV with PapaParse
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

// Step 1: Google login
import { signInWithPopup } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
loginBtn.onclick = async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    user = result.user;
    // Check eligibility (fetch quizzes where this email is allowed)
    const qz = query(collection(db, "quizzes"), where("allowedEmails", "array-contains", user.email));
    const quizSnap = await getDocs(qz);
    if (quizSnap.empty) {
      alert("You are not eligible to take this quiz. Please contact your professor.");
      return;
    }
    loginBtn.style.display = "none";
    document.getElementById("studentInfo").innerText = `You are eligible to take this quiz as: ${user.email}`;
    document.getElementById("reg-section").style.display = "block";
  } catch (err) {
    alert("Google login failed");
  }
};

// Step 2: Lock registration number
regNumLockBtn.onclick = async () => {
  errorMsgDiv.textContent = "";
  registrationNumber = regNumInput.value.trim();
  if (!registrationNumber || !/^[a-zA-Z0-9]{6,12}$/.test(registrationNumber)) {
    errorMsgDiv.textContent = "Enter a valid registration number (6-12 alphanumeric characters)";
    return;
  }
  regNumInput.disabled = true;
  regNumLockBtn.disabled = true;
  errorMsgDiv.textContent = "Loading quiz...";

  let timeoutId = setTimeout(() => {
    errorMsgDiv.textContent = "Quiz loading timed out. Please check your connection or contact your professor.";
    regNumInput.disabled = false;
    regNumLockBtn.disabled = false;
    console.error("Quiz loading timed out.");
  }, 10000); // 10 seconds

  try {
    await loadAvailableQuiz();
    clearTimeout(timeoutId);
  } catch (err) {
    clearTimeout(timeoutId);
    // If quiz already attempted, keep inputs disabled and show "View Results" button
    if (err && err.message && err.message.includes("already attempted")) {
      regNumInput.disabled = true;
      regNumLockBtn.disabled = true;
      viewResultsBtn.style.display = "inline-block";
    } else {
      regNumInput.disabled = false;
      regNumLockBtn.disabled = false;
    }
    let msg = "Error loading quiz. Please try again or contact your professor.";
    if (err && err.message) msg = err.message;
    errorMsgDiv.textContent = msg;
    errorMsgDiv.style.color = "#ff6b6b";
    console.error("Quiz start error:", err);
  }
};

// --- AUTOSAVE DRAFTS ---
function autosaveDraft() {
  if (!currentQuizId || !registrationNumber) return;
  const draft = {
    quizId: currentQuizId,
    registrationNumber,
    answers,
    currentQuestionIndex
  };
  sessionStorage.setItem('quizDraft', JSON.stringify(draft));
}
setInterval(autosaveDraft, 30000); // Save every 30 seconds

// Restore draft if found and matches quiz/user
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
        alert("Draft restored! You can continue where you left off.");
        renderQuestion();
        return true;
      }
    } catch (e) {}
  }
  return false;
}

// --- Enhanced Anti-Cheat: Tab switch, fullscreen, auto-submit on exit ---
function enforceAntiCheat() {
  // Disable right-click, copy, paste, F12, Ctrl+Shift+I, Tab
  document.addEventListener("contextmenu", e => e.preventDefault());
  document.addEventListener("keydown", e => {
    if (e.key === "F12" || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "i")) e.preventDefault();
    if (e.ctrlKey && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "v")) e.preventDefault();
    if (e.key === "Tab") e.preventDefault();
  });
  document.addEventListener("copy", e => e.preventDefault());
  document.addEventListener("paste", e => e.preventDefault());

  // Enforce fullscreen on quiz start
  if (quizSection.requestFullscreen) quizSection.requestFullscreen();
  else if (quizSection.webkitRequestFullscreen) quizSection.webkitRequestFullscreen();
  else if (quizSection.msRequestFullscreen) quizSection.msRequestFullscreen();

  // Auto-submit if user leaves fullscreen or switches tab/window
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      autoSubmitQuiz();
    }
  });
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) {
      autoSubmitQuiz();
    }
  });
}

async function loadAvailableQuiz() {
  // Find a quiz where this student's email is allowed
  const qz = query(collection(db, "quizzes"), where("allowedEmails", "array-contains", user.email));
  const quizSnap = await getDocs(qz);
  if (quizSnap.empty) {
    throw new Error("No quiz available for your email. Contact your professor.");
  }
  // Assume only one quiz for prototype
  const quizDoc = quizSnap.docs[0];
  currentQuizId = quizDoc.id;
  quizData = quizDoc.data();
  quizAllowedEmails = quizData.allowedEmails;

  // --- Quiz Status Check: Active/Expired/Not Started ---
  const now = new Date();
  // Robust date parsing for Firestore Timestamp or ISO/legacy string
  const startDate = quizData.startDate?.toDate ? quizData.startDate.toDate() : new Date(quizData.startDate);
  const endDate = quizData.endDate?.toDate ? quizData.endDate.toDate() : new Date(quizData.endDate);

  if (startDate && now < startDate) {
    throw new Error(`Quiz has not started yet. Starts at: ${startDate.toLocaleString()}`);
  }
  if (endDate && now > endDate) {
    throw new Error(`Quiz has expired. Ended at: ${endDate.toLocaleString()}`);
  }

  // Check if already attempted
  const respDoc = await getDoc(doc(db, "quizzes", currentQuizId, "responses", user.uid));
  if (respDoc.exists()) {
    errorMsgDiv.textContent = `You have already attempted this quiz. Your score: ${respDoc.data().score || "N/A"}`;
    errorMsgDiv.style.color = "#ff6b6b";
    regNumInput.disabled = true;
    regNumLockBtn.disabled = true;
    viewResultsBtn.style.display = "inline-block";
    throw new Error("Quiz already attempted");
  }
  // Hide loading/error message when quiz starts
  errorMsgDiv.textContent = "";

  // Load quiz questions from CSV
  questions = await parseCSV(quizData.questionsCsvUrl);
  shuffleArray(questions);

  // Set global timer if provided
  if (quizData.globalTimer && !isNaN(Number(quizData.globalTimer))) {
    globalTimer = Number(quizData.globalTimer);
  }

  // Show quiz section, start timers, enforce anti-cheat
  document.getElementById("reg-section").style.display = "none";
  quizSection.style.display = "block";
  document.getElementById("quizTitle").innerText = quizData.quizName || "Quiz";
  startGlobalTimer();
  enforceAntiCheat();

  // Try restoring draft
  if (!restoreDraftIfAvailable()) {
    currentQuestionIndex = 0;
    answers = {};
    renderQuestion();
  }
}

// --- TIMER LOGIC ---
function startGlobalTimer() {
  let timeLeft = globalTimer;
  updateGlobalTimerDisplay(timeLeft);
  clearInterval(globalTimerInterval);
  globalTimerInterval = setInterval(() => {
    timeLeft--;
    updateGlobalTimerDisplay(timeLeft);
    if (timeLeft <= 0) {
      clearInterval(globalTimerInterval);
      autoSubmitQuiz();
    }
  }, 1000);
}

function updateGlobalTimerDisplay(timeLeft) {
  const min = Math.floor(timeLeft / 60);
  const sec = timeLeft % 60;
  globalTimerDiv.textContent = `Quiz Time Left: ${min}:${sec.toString().padStart(2, '0')}`;
}

function autoSubmitQuiz() {
  alert("Time's up! Submitting your quiz.");
  submitBtn.click();
}

function renderQuestion() {
  if (currentQuestionIndex >= questions.length) {
    questionContainer.innerHTML = "<p>All questions done. Please submit.</p>";
    submitBtn.style.display = "block";
    return;
  }
  submitBtn.style.display = "none";
  const q = questions[currentQuestionIndex];
  // Per-question timer
  let qTime = 30;
  if (q.timer && !isNaN(Number(q.timer))) qTime = Number(q.timer);
  startQuestionTimer(qTime);

  // Advanced slider box: horizontally scrollable, only a portion visible at a time
  const visibleChars = 25; // Number of characters visible at once
  revealSlider.value = 0;
  revealSlider.max = Math.max(0, (q.question || '').length - visibleChars);
  function updateSliderBox() {
    const start = Number(revealSlider.value);
    const end = start + visibleChars;
    const visibleText = (q.question || '').substring(start, end);
    questionContainer.innerHTML = `<div style="width:350px; overflow:hidden; border:1px solid var(--border2); background:var(--card); padding:8px 12px; font-size:1.1em; margin-bottom:10px; white-space:nowrap;">${visibleText}</div>`;
    if (Number(revealSlider.value) === Number(revealSlider.max)) {
      showQuestionContent(q, true); // show options/answer input
    } else {
      // Hide options/answer input until slider is at end
      if (document.getElementById('options-box')) document.getElementById('options-box').innerHTML = '';
    }
  }
  revealSlider.oninput = updateSliderBox;
  updateSliderBox();
}

function showQuestionContent(q, onlyOptions=false) {
  let html = '<div id="options-box">';
  if (q.type === "single") {
    html += q.options.split(";").map((opt, i) =>
      `<div>
        <input type="radio" name="option" value="${opt}" id="opt${i}" ${answerChecked(q, opt)} />
        <label for="opt${i}">${opt}</label>
      </div>`
    ).join("");
  } else if (q.type === "multi") {
    html += q.options.split(";").map((opt, i) =>
      `<div>
        <input type="checkbox" name="option" value="${opt}" id="opt${i}" ${answerChecked(q, opt)} />
        <label for="opt${i}">${opt}</label>
      </div>`
    ).join("");
  } else if (q.type === "text") {
    html += `<input type="text" id="text-answer" value="${answers[`q${currentQuestionIndex+1}`] || ""}"/>`;
  }
  html += `<br><button id="next-btn">Next</button>`;
  html += '</div>';
  questionContainer.innerHTML += html;

  document.getElementById("next-btn").onclick = () => {
    // Save answer for this question
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
    clearInterval(questionTimerInterval);
    autosaveDraft(); // Save after every answer
    renderQuestion();
  };
}

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

// Per-question timer logic
function startQuestionTimer(seconds) {
  let timeLeft = seconds;
  updateQuestionTimerDisplay(timeLeft);
  clearInterval(questionTimerInterval);
  questionTimerInterval = setInterval(() => {
    timeLeft--;
    updateQuestionTimerDisplay(timeLeft);
    if (timeLeft <= 0) {
      clearInterval(questionTimerInterval);
      // Auto-advance: save as unanswered
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

submitBtn.onclick = async () => {
  // Calculate score (if answer keys embedded in CSV as 'answer' field)
  let score = 0;
  questions.forEach((q, i) => {
    const userAns = answers[`q${i + 1}`];
    if (!q.answer) return; // if answer key not present, skip
    if (q.type === "single" || q.type === "text") {
      if ((userAns || "").toLowerCase().trim() === (q.answer || "").toLowerCase().trim()) score++;
    } else if (q.type === "multi") {
      // Compare arrays
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
    status: "submitted",
    attemptedAt: Timestamp.now(),
  });

  sessionStorage.removeItem('quizDraft'); // Clear draft upon submit

  quizSection.style.display = "none";
  resultSection.style.display = "block";
  resultText.innerText = `Quiz submitted! Registration number: ${registrationNumber}\nScore: ${score}`;
  errorMsgDiv.textContent = "";
};

// Utility: Shuffle array (Fisher-Yates)
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// --- On page load: try restoring draft if quiz section is visible ---
window.addEventListener('DOMContentLoaded', () => {
  // No-op here: handled after quiz is loaded!
});
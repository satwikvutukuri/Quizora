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

// ------ CONFIG ------
function getQuizIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("quiz") || "";
}
const QUIZ_ID = getQuizIdFromUrl();

// ------ DOM ------
const loginBtn = document.getElementById("login-btn");
const regSection = document.getElementById("reg-section");
const quizSection = document.getElementById("quiz-section");
const resultSection = document.getElementById("result-section");
const resultText = document.getElementById("result-text");
const guidelines = document.getElementById("guidelines");
const regNumInput = document.getElementById("reg-num");
const regNumLockBtn = document.getElementById("lock-reg-btn");
let viewResultsBtn = document.getElementById("view-results-btn");
const regErrorMsg = document.getElementById("reg-error-msg");
const studentInfo = document.getElementById("studentInfo");
const globalTimerDiv = document.getElementById("global-timer");
const questionTimerDiv = document.getElementById("question-timer");
const revealSlider = document.getElementById("reveal-slider");
const questionBox = document.getElementById("question-box");
const optionsBox = document.getElementById("options-box");
const submitBtn = document.getElementById("submit-btn");
const nextBtn = document.getElementById("next-btn");

// ------ State ------
let user = null;
let quizData = null;
let currentQuizId = null;
let questions = [];
let currentQuestionIndex = 0;
let answers = {};
let registrationNumber = null;
let quizAllowedEmails = [];
let globalTimer = 15 * 60;
let globalTimerInterval = null;
let questionTimer = 30;
let questionTimerInterval = null;
let quizLocked = false;

// --- DELAYED ANTI-CHEAT LOGIC ---
let antiCheatStrict = false;
let hasLeftOnce = false;

// Utility: Clear quiz session
function clearQuizSession() {
  sessionStorage.removeItem("quizUser");
  sessionStorage.removeItem("quizRegNum");
  sessionStorage.removeItem("quizId");
  sessionStorage.removeItem("quizResult");
}

// Only these listeners are active at quiz start — NO focus/interval checks!
function onFirstViolation(reason) {
  if (hasLeftOnce) return; // Defensive
  hasLeftOnce = true;
  showWarningModal();
  enableStrictAntiCheat();
  removeFirstViolationListeners();
}

function addFirstViolationListeners() {
  window.addEventListener("blur", firstBlur);
  document.addEventListener("visibilitychange", firstVisibility);
  document.addEventListener("fullscreenchange", firstFullscreen);
  window.addEventListener("keydown", firstScreenshot);
  window.addEventListener("keyup", firstScreenshot);
}
function removeFirstViolationListeners() {
  window.removeEventListener("blur", firstBlur);
  document.removeEventListener("visibilitychange", firstVisibility);
  document.removeEventListener("fullscreenchange", firstFullscreen);
  window.removeEventListener("keydown", firstScreenshot);
  window.removeEventListener("keyup", firstScreenshot);
}
function firstBlur() { onFirstViolation("Window/tab focus lost or switched."); }
function firstVisibility() {
  if (document.visibilityState === 'hidden') onFirstViolation("Tab hidden or switched.");
}
function firstFullscreen() {
  if (!document.fullscreenElement) onFirstViolation("Exited fullscreen (required for quiz).");
}
function firstScreenshot(e) {
  if (e.key === "PrintScreen" ||
      ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "4" || e.key === "3"))) {
    onFirstViolation("Screenshot detected.");
  }
}

// After first violation, activate strict mode (auto-submit on ANY violation!)
function enableStrictAntiCheat() {
  antiCheatStrict = true;
  window.addEventListener("blur", strictBlur);
  document.addEventListener("visibilitychange", strictVisibility);
  window.addEventListener("focusout", strictFocusOut);
  document.addEventListener("fullscreenchange", strictFullscreen);
  window.addEventListener("keydown", strictScreenshot);
  window.addEventListener("keyup", strictScreenshot);
}
function disableStrictAntiCheat() {
  window.removeEventListener("blur", strictBlur);
  document.removeEventListener("visibilitychange", strictVisibility);
  window.removeEventListener("focusout", strictFocusOut);
  document.removeEventListener("fullscreenchange", strictFullscreen);
  window.removeEventListener("keydown", strictScreenshot);
  window.removeEventListener("keyup", strictScreenshot);
}
function strictBlur() { lockAndSubmitQuiz("Window/tab focus lost or switched. (strict mode)"); }
function strictVisibility() {
  if (document.visibilityState === 'hidden') lockAndSubmitQuiz("Tab hidden or switched. (strict mode)");
}
function strictFocusOut() { lockAndSubmitQuiz("Focus left the quiz window. (strict mode)"); }
function strictFullscreen() {
  if (!document.fullscreenElement) lockAndSubmitQuiz("Exited fullscreen (strict mode)");
}
function strictScreenshot(e) {
  if (e.key === "PrintScreen" ||
      ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "4" || e.key === "3"))) {
    lockAndSubmitQuiz("Screenshot detected. (strict mode)");
  }
}

// Show warning modal after first violation
function showWarningModal() {
  let overlay = document.getElementById("anti-cheat-warning-modal");
  if (overlay) overlay.remove();
  overlay = document.createElement("div");
  overlay.id = "anti-cheat-warning-modal";
  overlay.style.position = "fixed";
  overlay.style.left = "0";
  overlay.style.top = "0";
  overlay.style.width = "100vw";
  overlay.style.height = "100vh";
  overlay.style.background = "rgba(40,0,0,0.90)";
  overlay.style.zIndex = "99999";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.innerHTML = `
    <div style="background:#2d1c1c;padding:40px 32px;border-radius:22px;max-width:420px;box-shadow:0 4px 36px #000;text-align:center;">
      <h2 style="color:#ff6b6b;margin-bottom:16px;">Warning!</h2>
      <p style="font-size:1.09em;color:#fff;margin-bottom:26px;">
        You left the quiz window or switched tabs.<br>
        <b>Do not leave the quiz window again.</b><br>
        <b>Next violation will auto-submit your quiz.</b>
      </p>
      <button id="warning-ok-btn" style="margin-top:18px;background:#ff6b6b;color:#fff;padding:10px 30px;border-radius:8px;border:none;font-size:1em;cursor:pointer;">OK</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("warning-ok-btn").onclick = () => overlay.remove();
}

function removeAllAntiCheatListeners() {
  removeFirstViolationListeners();
  disableStrictAntiCheat();
}

function lockAndSubmitQuiz(reason = "You left the quiz window or opened another app. Quiz is now auto-submitted.") {
  if (quizLocked) return;
  if (!user || !currentQuizId || !questions.length || !submitBtn || !document.body.contains(submitBtn)) return;
  quizLocked = true;
  removeAllAntiCheatListeners();
  
  // Show alert for auto-submission
  alert("Quiz auto-submitted: " + reason);
  
  // Calculate score for auto-submission
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

  // Save auto-submitted quiz results to Firestore
  setDoc(doc(db, "quizzes", currentQuizId, "responses", user.uid), {
    registrationNumber,
    email: user.email,
    answers,
    score,
    attemptedAt: new Date(),
    status: "autosubmitted",
    autoSubmitReason: reason
  });

  if (quizSection) quizSection.style.display = "none";
  if (resultSection) resultSection.style.display = "block";
  
  // Show prominent quiz submission message for auto-submit
  if (resultText) {
    resultText.innerHTML = `
      <div style="color:var(--accent2);font-size:1.5em;font-weight:bold;margin-bottom:12px;padding:16px;background:var(--card);border-radius:8px;border:2px solid var(--accent2);text-align:center;">
        Your quiz has been submitted.
      </div>
      <div style="font-size:1.2em;color:var(--text);margin-bottom:10px;text-align:center;">
        Registration Number: <b>${registrationNumber}</b>
      </div>
      <div style="font-size:1.2em;color:var(--text);margin-bottom:10px;text-align:center;">
        Your Score: <b>${score}</b> out of <b>${questions.length}</b>
      </div>
      <div style="color:var(--muted);font-size:1em;text-align:center;">
        (Quiz was automatically submitted)
      </div>
    `;
  }
  if (regErrorMsg) regErrorMsg.textContent = "";

  // Exit fullscreen mode after showing the submission message
  setTimeout(() => {
    exitFullscreen();
  }, 1000); // Small delay to ensure the message is visible before exiting fullscreen
}

// ----------- QUIZ WINDOW CHECK / UI CONTROL -----------
async function checkQuizWindowAndDisplay() {
  if (!QUIZ_ID) {
    document.body.innerHTML = `<div style="color:#e85d6f;max-width:480px;margin:80px auto;font-size:1.3em;text-align:center;background:#18223a;padding:32px 16px;border-radius:16px;">
      No quiz specified in URL. Contact your instructor.
    </div>`;
    return false;
  }
  const quizDoc = await getDoc(doc(db, "quizzes", QUIZ_ID));
  if (!quizDoc.exists()) {
    document.body.innerHTML = `<div style="color:#e85d6f;max-width:480px;margin:80px auto;font-size:1.3em;text-align:center;background:#18223a;padding:32px 16px;border-radius:16px;">
      Quiz not found. Contact your instructor.
    </div>`;
    return false;
  }
  quizData = quizDoc.data();
  currentQuizId = QUIZ_ID;
  const now = new Date();
  let quizStart = quizData.quizStart ? new Date(quizData.quizStart) : null;
  let quizEnd = quizData.quizEnd ? new Date(quizData.quizEnd) : null;

  if (quizStart && now < quizStart) {
    hideAllSections();
    document.body.innerHTML = `<div style="color:#e85d6f;max-width:480px;margin:80px auto;font-size:1.3em;text-align:center;background:#18223a;padding:32px 16px;border-radius:16px;">
      Quiz Not Started Yet.<br>Please come back at <b>${quizStart.toLocaleString()}</b>.
    </div>`;
    return false;
  }
  if (quizEnd && now > quizEnd) {
    hideAllSections();
    document.body.innerHTML = `<div style="color:#e85d6f;max-width:480px;margin:80px auto;font-size:1.3em;text-align:center;background:#18223a;padding:32px 16px;border-radius:16px;">
      Quiz is now closed.<br>It ended at <b>${quizEnd.toLocaleString()}</b>.
    </div>`;
    return false;
  }
  showLoginAndReg();
  return true;
}

function hideAllSections() {
  if (loginBtn) loginBtn.style.display = "none";
  if (regSection) regSection.style.display = "none";
  if (quizSection) quizSection.style.display = "none";
  if (resultSection) resultSection.style.display = "none";
  if (guidelines) guidelines.style.display = "none";
}
function showLoginAndReg() {
  if (guidelines) guidelines.style.display = "block";
  if (loginBtn) loginBtn.style.display = "";
}

// ----------- AUTH & REGISTRATION -----------
import { signInWithPopup } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
function setupAuthHandlers() {
  loginBtn.onclick = async () => {
    loginBtn.disabled = true;
    try {
      const result = await signInWithPopup(auth, provider);
      user = result.user;
      // Check eligibility (fetch quizzes where this email is allowed)
      const qz = query(collection(db, "quizzes"), where("allowedEmails", "array-contains", user.email));
      const quizSnap = await getDocs(qz);
      if (quizSnap.empty) {
        alert("You are not eligible to take this quiz. Please contact your professor.");
        loginBtn.disabled = false;
        return;
      }
      loginBtn.style.display = "none";
      studentInfo.innerText = `You are eligible to take this quiz as: ${user.email}`;
      regSection.style.display = "block";
    } catch (err) {
      alert("Google login failed");
      loginBtn.disabled = false;
    }
  };
}

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

regNumLockBtn.onclick = async () => {
  regErrorMsg.textContent = "";
  registrationNumber = regNumInput.value.trim();
  if (!registrationNumber || !/^[a-zA-Z0-9]{6,12}$/.test(registrationNumber)) {
    regErrorMsg.textContent = "Enter a valid registration number (6-12 alphanumeric characters)";
    return;
  }
  regNumInput.disabled = true;
  regNumLockBtn.disabled = true;
  regErrorMsg.textContent = "Loading quiz...";

  let timeoutId = setTimeout(() => {
    regErrorMsg.textContent = "Quiz loading timed out. Please check your connection or contact your professor.";
    regNumInput.disabled = false;
    regNumLockBtn.disabled = false;
    console.error("Quiz loading timed out.");
  }, 10000);

  try {
    clearQuizSession();
    await loadAvailableQuiz();
    clearTimeout(timeoutId);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err && err.message && err.message.includes("already attempted")) {
      regNumInput.disabled = true;
      regNumLockBtn.disabled = true;
      viewResultsBtn.style.display = "inline-block";
    } else {
      regNumInput.disabled = false;
      regNumLockBtn.disabled = false;
    }
    let msg = "Error loading quiz. Please try again or contact your professor.";
    if (err && err.message) {
      msg = err.message;
    }
    regErrorMsg.textContent = msg;
    regErrorMsg.style.color = "#ff6b6b";
    console.error("Quiz start error:", err);
  }
};

function showFullscreenPrompt(callback) {
  let overlay = document.getElementById("fullscreen-prompt-overlay");
  if (overlay) overlay.remove();

  overlay = document.createElement("div");
  overlay.id = "fullscreen-prompt-overlay";
  overlay.style.position = "fixed";
  overlay.style.left = 0;
  overlay.style.top = 0;
  overlay.style.width = "100vw";
  overlay.style.height = "100vh";
  overlay.style.background = "rgba(12,18,32,0.98)";
  overlay.style.zIndex = "9999";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.innerHTML = `
    <div style="background:#192447;padding:40px 32px;border-radius:22px;max-width:410px;box-shadow:0 4px 36px #1a223e70;text-align:center;">
      <h2 style="color:#5aa5ff;margin-bottom:18px;">Get Ready!</h2>
      <p style="font-size:1.11em;color:#e7ecff;margin-bottom:28px;">
        The quiz will now enter <b>fullscreen mode</b>.<br>
        <span style="color:#ff6b6b;">Do not exit or switch tabs</span> until your quiz is over.<br>
        Click "Continue" to begin.
      </p>
      <button id="fullscreen-continue-btn" style="background:#5aa5ff;color:#fff;font-size:1.13em;padding:12px 34px;border-radius:12px;border:none;box-shadow:0 2px 12px #5aa5ff22;font-weight:700;cursor:pointer;">Continue</button>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById("fullscreen-continue-btn").onclick = async () => {
    overlay.remove();
    if (quizSection && quizSection.requestFullscreen) await quizSection.requestFullscreen();
    else if (quizSection && quizSection.webkitRequestFullscreen) await quizSection.webkitRequestFullscreen();
    else if (quizSection && quizSection.msRequestFullscreen) await quizSection.msRequestFullscreen();
    setTimeout(() => {
      if (typeof callback === "function") callback();
    }, 3000);
  };
}

function enforceAntiCheat() {
  document.addEventListener("contextmenu", e => e.preventDefault());
  document.addEventListener("keydown", e => {
    if (e.key === "F12" || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "i")) e.preventDefault();
    if (e.ctrlKey && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "v")) e.preventDefault();
    if (e.key === "Tab") e.preventDefault();
  });
  document.addEventListener("copy", e => e.preventDefault());
  document.addEventListener("paste", e => e.preventDefault());
}

// ----------- LOADING & STARTING THE QUIZ -----------
async function loadAvailableQuiz() {
  const qz = query(collection(db, "quizzes"), where("allowedEmails", "array-contains", user.email));
  const quizSnap = await getDocs(qz);
  if (quizSnap.empty) {
    throw new Error("No quiz available for your email. Contact your professor.");
  }

  let foundQuiz = null;
  let foundQuizId = null;

  for (let i = 0; i < quizSnap.docs.length; i++) {
    const quizDoc = quizSnap.docs[i];
    const quizId = quizDoc.id;
    const respDoc = await getDoc(doc(db, "quizzes", quizId, "responses", user.uid));
    if (!respDoc.exists()) {
      foundQuiz = quizDoc.data();
      foundQuizId = quizId;
      break;
    }
  }

  if (!foundQuiz) {
    regErrorMsg.textContent = "You have already attempted all available quizzes.";
    regErrorMsg.style.color = "#ff6b6b";
    regNumInput.disabled = true;
    regNumLockBtn.disabled = true;
    viewResultsBtn.style.display = "inline-block";
    throw new Error("Quiz already attempted");
  }

  currentQuizId = foundQuizId;
  quizData = foundQuiz;
  quizAllowedEmails = quizData.allowedEmails;
  regErrorMsg.textContent = "";

  sessionStorage.setItem("quizUser", JSON.stringify(user));
  sessionStorage.setItem("quizRegNum", registrationNumber);
  sessionStorage.setItem("quizId", currentQuizId);

  showFullscreenPrompt(() => {
    enforceAntiCheat();
    setTimeout(() => {
      // *** Only these are active at quiz start: ***
      addFirstViolationListeners();
      startQuiz();
    }, 150);
  });
}

async function startQuiz() {
  if (quizSection) quizSection.style.display = "block";
  if (regSection) regSection.style.display = "none";
  if (guidelines) guidelines.style.display = "none";
  const questionsCsvUrl = quizData.questionsCsvUrl || quizData.questionCSV;
  if (!questionsCsvUrl) {
    if (questionBox) questionBox.innerHTML = "<p>Quiz questions unavailable. Contact your professor.</p>";
    return;
  }
  try {
    questions = await parseCSV(questionsCsvUrl);
    shuffleArray(questions);
    currentQuestionIndex = 0;
    answers = {};
    startGlobalTimer();
    renderQuestion();
  } catch (err) {
    if (questionBox) questionBox.innerHTML = "<p>Error loading questions. Contact your professor.</p>";
    console.error("Error loading questions:", err);
  }
}

function startGlobalTimer() {
  let timeLeft = globalTimer;
  updateGlobalTimerDisplay(timeLeft);
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
  if (globalTimerDiv) {
    const min = Math.floor(timeLeft / 60);
    const sec = timeLeft % 60;
    globalTimerDiv.textContent = `Quiz Time Left: ${min}:${sec.toString().padStart(2, '0')}`;
  }
}

function autoSubmitQuiz() {
  lockAndSubmitQuiz("Time's up or you left quiz! Submitting your quiz.");
}

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

function renderQuestion() {
  if (!questionBox || !optionsBox || !revealSlider || !nextBtn || !submitBtn) return;
  if (currentQuestionIndex >= questions.length) {
    questionBox.innerHTML = "<p>All questions done. Please submit.</p>";
    optionsBox.innerHTML = "";
    revealSlider.style.display = "none";
    nextBtn.style.display = "none";
    submitBtn.style.display = "block";
    return;
  }
  submitBtn.style.display = "none";
  nextBtn.style.display = "block";
  optionsBox.innerHTML = "";
  revealSlider.style.display = "block";

  const q = questions[currentQuestionIndex];
  let qTime = 30;
  if (q.timer && !isNaN(Number(q.timer))) qTime = Number(q.timer);
  startQuestionTimer(qTime);

  let imageHtml = "";
  if (q.image && q.image.trim().length > 0) {
    imageHtml = `<img src="${q.image}" alt="Question Image" style="max-width:250px;max-height:140px;display:block;margin:0 auto 18px auto;border-radius:12px;box-shadow:0 2px 10px #111c2d66;">`;
  }

  const visibleChars = 38;
  revealSlider.value = 0;
  revealSlider.max = Math.max(0, (q.question || '').length - visibleChars);

  questionBox.innerHTML = `
    ${imageHtml}
    <span style="color:#777;font-size:0.98em;">Slide to reveal question:</span><br>
    <span 
      id="question-visible-text"
      class="question-box slider-question-box"
      style="
        display:block; 
        margin-top:8px; 
        background:var(--option); 
        border-radius:7px; 
        padding:13px 17px; 
        font-size:1.08em; 
        border: 1px solid var(--border2); 
        min-height:40px;
        width:300px;
        max-width:300px;
        overflow-x:hidden;
        white-space:nowrap;
        user-select: none;
        -webkit-user-select: none;
        cursor: not-allowed;
      "
      oncopy="return false"
      onselectstart="return false"
      onmousedown="return false"
    ></span>
  `;

  const qvElem = document.getElementById("question-visible-text");
  if (qvElem) {
    qvElem.addEventListener("copy", e => { e.preventDefault(); });
    qvElem.addEventListener("selectstart", e => { e.preventDefault(); });
    qvElem.addEventListener("mousedown", e => { e.preventDefault(); });
    qvElem.addEventListener("contextmenu", e => { e.preventDefault(); });
    qvElem.addEventListener("dragstart", e => { e.preventDefault(); });
  }

  function updateSliderBox() {
    const start = Number(revealSlider.value);
    const end = start + visibleChars;
    const visibleText = (q.question || '').substring(start, end);
    const questionVisibleTextElem = document.getElementById("question-visible-text");
    if (questionVisibleTextElem) {
      questionVisibleTextElem.textContent = visibleText;
    }
  }
  revealSlider.oninput = updateSliderBox;
  updateSliderBox();

  showQuestionContent(q, true);

  // ---- UI ONLY: Option scrollbar fixes for 1-4 options ----
  // After rendering options:
  setTimeout(() => {
    const optionElems = Array.from(optionsBox.children).filter(el =>
      el.classList && (el.classList.contains('option-row') || el.classList.contains('option'))
    );
    optionsBox.classList.toggle('has-many', optionElems.length > 4);
  }, 0);
}

function showQuestionContent(q, onlyOptions = false) {
  if (!optionsBox || !nextBtn) return;
  optionsBox.innerHTML = "";
  let html = "";
  if (q.type === "single") {
    html += q.options.split(";").map((opt, i) =>
      `<label class="option-row">
        <input type="radio" name="option" value="${opt}" id="opt${i}" />
        ${opt}
      </label>`
    ).join("");
  } else if (q.type === "multi") {
    html += q.options.split(";").map((opt, i) =>
      `<label class="option-row">
        <input type="checkbox" name="option" value="${opt}" id="opt${i}" />
        ${opt}
      </label>`
    ).join("");
  } else if (q.type === "text") {
    html += `<input type="text" id="text-answer" class="option-row" style="width:90%;max-width:420px;padding:15px 12px;font-size:1.09em;">`;
  }
  optionsBox.innerHTML = html;
  nextBtn.style.display = "block";

  // --- AUTO-NEXT on single option select ---
  if (q.type === "single") {
    document.querySelectorAll('input[type="radio"][name="option"]').forEach(radio => {
      radio.addEventListener('change', function() {
        if (this.checked) {
          answers[`q${currentQuestionIndex + 1}`] = this.value;
          currentQuestionIndex++;
          clearInterval(questionTimerInterval);
          renderQuestion();
        }
      });
    });
  }

  nextBtn.onclick = () => {
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
      const textAnswerElem = document.getElementById("text-answer");
      ans = textAnswerElem ? textAnswerElem.value.trim() : "";
      if (!ans) return alert("Enter your answer");
    }
    answers[`q${currentQuestionIndex + 1}`] = ans;
    currentQuestionIndex++;
    clearInterval(questionTimerInterval);
    renderQuestion();
  };
}

function startQuestionTimer(seconds) {
  if (!questionTimerDiv) return;
  let timeLeft = seconds;
  updateQuestionTimerDisplay(timeLeft);
  clearInterval(questionTimerInterval);
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
  if (questionTimerDiv) {
    questionTimerDiv.textContent = `Time left for this question: ${timeLeft}s`;
  }
}

// --- Cross-browser fullscreen exit utility function ---
function exitFullscreen() {
  try {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  } catch (error) {
    console.log("Error exiting fullscreen:", error);
  }
}

submitBtn.onclick = async () => {
  if (!user || !currentQuizId || !questions.length || !submitBtn || !document.body.contains(submitBtn)) return;

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

  // Save quiz results to Firestore
  await setDoc(doc(db, "quizzes", currentQuizId, "responses", user.uid), {
    registrationNumber,
    email: user.email,
    answers,
    score,
    attemptedAt: new Date(),
    status: "submitted"
  });

  removeAllAntiCheatListeners();

  if (quizSection) quizSection.style.display = "none";
  if (resultSection) resultSection.style.display = "block";
  
  // Show prominent quiz submission message
  if (resultText) {
    resultText.innerHTML = `
      <div style="color:var(--accent2);font-size:1.5em;font-weight:bold;margin-bottom:12px;padding:16px;background:var(--card);border-radius:8px;border:2px solid var(--accent2);text-align:center;">
        Your quiz has been submitted.
      </div>
      <div style="font-size:1.2em;color:var(--text);margin-bottom:10px;text-align:center;">
        Registration Number: <b>${registrationNumber}</b>
      </div>
      <div style="font-size:1.2em;color:var(--text);margin-bottom:10px;text-align:center;">
        Your Score: <b>${score}</b> out of <b>${questions.length}</b>
      </div>
    `;
  }
  if (regErrorMsg) regErrorMsg.textContent = "";

  // Exit fullscreen mode after showing the submission message
  setTimeout(() => {
    exitFullscreen();
  }, 1000); // Small delay to ensure the message is visible before exiting fullscreen
};

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

window.onload = async () => {
  hideAllSections();
  const quizIsOpen = await checkQuizWindowAndDisplay();
  if (quizIsOpen) {
    setupAuthHandlers();
  }
};
import { auth, provider, db } from './firebase.js';
import { signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// ---- CONFIG ----
const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSaBw0Nw0LQrAXrIjHsmzyCSY0fOydwJYtC7-0D7Y0xHf_IABT79k6Qb2WF3ZNJEJDDyjBTO-wJe71p/pub?output=csv";
const FIRESTORE_RESULTS_COLLECTION = "quiz_results";
const LEADERBOARD_SIZE = 5; // Top N

// ---- Fetch questions from Google Sheets (CSV) ----
async function fetchQuestionsFromSheet(sheetUrl) {
  const res = await fetch(sheetUrl);
  const csvText = await res.text();
  const lines = csvText.split('\n').filter(l => l.trim().length);
  const headers = lines[0].split(',').map(h => h.trim());
  const questions = lines.slice(1).map(line => {
    const cells = [];
    let curr = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQuotes = !inQuotes;
      else if (c === ',' && !inQuotes) {
        cells.push(curr);
        curr = '';
      } else {
        curr += c;
      }
    }
    cells.push(curr);
    const obj = {};
    headers.forEach((h, i) => obj[h] = cells[i]?.trim() || "");
    // Parse options, answer, acceptable as arrays
    if (obj.options) obj.options = obj.options.split('|').map(s=>s.trim()).filter(Boolean);
    if (obj.answer) obj.answer = obj.answer.split('|').map(s=>s.trim()).filter(Boolean);
    if (obj.acceptable) obj.acceptable = obj.acceptable.split('|').map(s=>s.trim()).filter(Boolean);
    if (obj.timeLimitSec) obj.timeLimitSec = Number(obj.timeLimitSec) || 30;
    obj.image = (obj.image && obj.image !== "img_url") ? obj.image : "";
    obj.id = obj.id || "";
    obj.type = obj.type || "";
    obj.text = obj.text || "";
    return obj;
  });
  return questions;
}

// ---- FIRESTORE ----
async function saveQuizResultToFirestore({ regNo, email, score, total, answers, timestamp }) {
  try {
    await setDoc(doc(db, FIRESTORE_RESULTS_COLLECTION, regNo), {
      regNo, email, score, total, answers, timestamp
    });
  } catch (e) {
    console.error("Firestore save error:", e);
  }
}

async function getQuizResultFromFirestore(regNo) {
  try {
    const docRef = doc(db, FIRESTORE_RESULTS_COLLECTION, regNo);
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? docSnap.data() : null;
  } catch (e) {
    console.error("Firestore get error:", e);
    return null;
  }
}

async function getLeaderboardFromFirestore() {
  try {
    const q = query(collection(db, FIRESTORE_RESULTS_COLLECTION), orderBy("score", "desc"), limit(LEADERBOARD_SIZE));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => doc.data());
  } catch (e) {
    console.error("Firestore leaderboard error:", e);
    return [];
  }
}

// ---- AUTH ----
let userEmail = "";
function loginWithGoogle() {
  signInWithPopup(auth, provider)
    .then(async (result) => {
      userEmail = result.user.email;
      const docRef = doc(db, "allowed_emails", userEmail);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        console.log("Email allowed:", userEmail);
      } else {
        alert("Your email is not authorized to take the quiz.");
        signOut(auth);
        return;
      }
    })
    .catch((error) => {
      console.error("Google sign-in error:", error);
    });
}

// ---- UI ----
document.addEventListener("DOMContentLoaded", () => {
  const startBtn = document.getElementById('startBtn');
  const googleLoginBtn = document.getElementById('googleLoginBtn');
  const startScreen = document.getElementById('start-screen');
  const regNoInput = document.getElementById('regNo');
  const leaderboardBtn = document.getElementById('leaderboardBtn');
  const leaderboardScreen = document.getElementById('leaderboard-screen');
  const leaderboardTable = document.getElementById('leaderboardTable');
  const summaryTable = document.getElementById('summaryTable');
  const progressBar = document.getElementById('progressBar');

  googleLoginBtn.addEventListener('click', loginWithGoogle);
  leaderboardBtn.addEventListener('click', showLeaderboard);

  onAuthStateChanged(auth, user => {
    if (user) {
      userEmail = user.email;
      if (!document.getElementById('welcomeMsg')) {
        const welcomeDiv = document.createElement('div');
        welcomeDiv.id = "welcomeMsg";
        welcomeDiv.style.marginBottom = "12px";
        welcomeDiv.style.color = "green";
        welcomeDiv.innerHTML = `Welcome, <strong>${user.displayName}</strong>`;
        startScreen.insertBefore(welcomeDiv, googleLoginBtn);
      }
      googleLoginBtn.style.display = "none";
      startBtn.disabled = false;
    } else {
      userEmail = "";
      const welcomeDiv = document.getElementById('welcomeMsg');
      if (welcomeDiv) welcomeDiv.remove();
      googleLoginBtn.style.display = "block";
      startBtn.disabled = true;
    }
  });
});

// ---- ANTI-CHEATING ----
let tabSwitchCount = 0;
let tabWarningShown = false;
let quizStarted = false;
document.addEventListener("visibilitychange", () => {
  if (!quizStarted) return;
  if (document.visibilityState === "hidden") {
    tabSwitchCount++;
    if (!tabWarningShown) {
      alert("Warning: Switching tabs or minimizing the browser is not allowed during the quiz!");
      tabWarningShown = true;
    }
    if (tabSwitchCount >= 3) {
      alert("You have switched tabs too many times. The quiz will be auto-submitted.");
      autoSubmit();
    }
  }
});
function requestFullscreen() {
  const el = document.documentElement;
  if (el.requestFullscreen) el.requestFullscreen();
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  else if (el.msRequestFullscreen) el.msRequestFullscreen();
}
function checkFullscreen() {
  if (!document.fullscreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {
    alert("You have exited fullscreen mode. The quiz will be auto-submitted.");
    autoSubmit();
  }
}
document.addEventListener('fullscreenchange', checkFullscreen);
document.addEventListener('webkitfullscreenchange', checkFullscreen);
document.addEventListener('msfullscreenchange', checkFullscreen);
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('copy', e => e.preventDefault());
document.addEventListener('cut', e => e.preventDefault());
document.addEventListener('paste', e => e.preventDefault());
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && ['c','x','v','a','s','p'].includes(e.key.toLowerCase())) e.preventDefault();
});

// ---- QUIZ LOGIC ----
const $ = sel => document.querySelector(sel);
const shuffle = arr => arr.map(v => [Math.random(), v]).sort((a,b)=>a[0]-b[0]).map(p=>p[1]);
const toMMSS = s => {
  const m = Math.floor(s/60), ss = s%60;
  return `${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
};

let QUESTIONS = [];
let current = 0;
let globalTime = 15 * 60;
let globalTick, questionTick;
let regNo = '';
let score = 0;
let answers = [];

const startScreen = $('#start-screen');
const regNoInput = $('#regNo');
const startBtn = $('#startBtn');
const quizScreen = $('#quiz-screen');
const qText = $('#qText');
const qImg = $('#qImage');
const optionsDiv = $('#options');
const typedWrap = $('#typedWrap');
const typedInput = $('#typedInput');
const typedSubmit = $('#typedSubmit');
const multiSubmit = $('#multiSubmit');
const qIndex = $('#qIndex');
const qTotal = $('#qTotal');
const globalTimerEl = $('#globalTimer');
const questionTimerEl = $('#questionTimer');
const resultScreen = $('#result-screen');
const outReg = $('#outReg');
const outScore = $('#outScore');
const outTotal = $('#outTotal');
const downloadCsvBtn = $('#downloadCsv');
const restartBtn = $('#restart');
const leaderboardBtn2 = document.getElementById('leaderboardBtn'); // fix duplicate
const leaderboardScreen2 = document.getElementById('leaderboard-screen'); // fix duplicate
const leaderboardTable2 = document.getElementById('leaderboardTable');
const summaryTable2 = document.getElementById('summaryTable');
const progressBar2 = document.getElementById('progressBar');

// --- Viewport reveal logic ---
const qViewport = document.getElementById('qViewport');
const qContent = document.getElementById('qContent');
const qSliderX = document.getElementById('qSliderX');
const qSliderY = document.getElementById('qSliderY');

function setQuestionViewport(xPercent, yPercent) {
  // xPercent, yPercent: 0 (left/top) to 100 (right/bottom)
  // qContent is twice the viewport size, so -viewportW/2 to 0
  const vpW = qViewport.offsetWidth, vpH = qViewport.offsetHeight;
  const maxX = vpW, maxY = vpH;
  const left = - (xPercent / 100) * maxX;
  const top  = - (yPercent / 100) * maxY;
  qContent.style.left = `${left}px`;
  qContent.style.top = `${top}px`;
}

function resetViewportSliders() {
  if (qSliderX) qSliderX.value = 0;
  if (qSliderY) qSliderY.value = 0;
  setQuestionViewport(0,0);
}

if (qSliderX && qSliderY) {
  qSliderX.addEventListener('input', () => setQuestionViewport(qSliderX.value, qSliderY.value));
  qSliderY.addEventListener('input', () => setQuestionViewport(qSliderX.value, qSliderY.value));
}

// ---- MAIN QUIZ HANDLER ----
startBtn.addEventListener('click', async () => {
  regNo = regNoInput.value.trim();
  if (!regNo) { alert('Please enter Registration Number'); return; }
  if (!userEmail) { alert('Please login with Google first'); return; }

  // Check for previous attempt
  const prevResult = await getQuizResultFromFirestore(regNo);
  if (prevResult) {
    alert("You have already attempted the quiz. Showing your result.");
    showResultScreen(prevResult.score, prevResult.answers, prevResult.total, prevResult.regNo, true);
    return;
  }

  QUESTIONS = await fetchQuestionsFromSheet(SHEET_CSV_URL);
  if (!QUESTIONS || QUESTIONS.length === 0) {
    alert("No questions found in the sheet!");
    return;
  }
  QUESTIONS = shuffle(QUESTIONS);

  qTotal.textContent = QUESTIONS.length;
  startScreen.classList.add('hidden');
  quizScreen.classList.remove('hidden');
  regNoInput.disabled = true;
  quizStarted = true;
  requestFullscreen();

  globalTime = 15 * 60;
  score = 0;
  answers = [];
  tabSwitchCount = 0;
  tabWarningShown = false;
  updateProgressBar(0);
  startGlobalTimer();
  showQuestion(0);
});

function startGlobalTimer() {
  globalTimerEl.textContent = toMMSS(globalTime);
  globalTick = setInterval(() => {
    globalTime--;
    globalTimerEl.textContent = toMMSS(globalTime);
    if (globalTime <= 0) {
      clearInterval(globalTick);
      autoSubmit();
    }
  }, 1000);
}

function startQuestionTimer(limit) {
  clearInterval(questionTick);
  let remain = limit;
  questionTimerEl.textContent = remain;
  questionTick = setInterval(() => {
    remain--;
    questionTimerEl.textContent = remain;
    if (remain <= 0) {
      clearInterval(questionTick);
      recordAnswerTimeout();
      nextQuestion();
    }
  }, 1000);
}

function showQuestion(idx) {
  resetViewportSliders();
  current = idx;
  updateProgressBar(current / QUESTIONS.length);
  const q = QUESTIONS[idx];
  qIndex.textContent = idx + 1;

  optionsDiv.innerHTML = '';
  typedWrap.classList.add('hidden');
  multiSubmit.classList.add('hidden');
  qImg.classList.add('hidden');
  typedInput.value = '';

  // --- Place text and image inside qContent ---
  qText.textContent = q.text || '';
  if (q.image) {
    qImg.src = q.image;
    qImg.classList.remove('hidden');
  } else {
    qImg.classList.add('hidden');
  }

  if (q.type === 'ShortAnswer') {
    typedWrap.classList.remove('hidden');
    typedInput.focus();
  } else if (q.type === 'MCQ' || q.type === 'TrueFalse' || q.type === 'ImageBased') {
    q.options.forEach((opt, i) => {
      const id = `opt-${idx}-${i}`;
      const wrap = document.createElement('label');
      wrap.className = 'option';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `q-${idx}`;
      input.value = opt;
      input.id = id;
      const span = document.createElement('span');
      span.textContent = opt;
      wrap.appendChild(input);
      wrap.appendChild(span);
      optionsDiv.appendChild(wrap);
      input.addEventListener('change', () => {
        lockChoices();
        recordAnswer([opt]);
        setTimeout(nextQuestion, 300);
      });
    });
  } else if (q.type === 'MultiMCQ') {
    q.options.forEach((opt, i) => {
      const id = `opt-${idx}-${i}`;
      const wrap = document.createElement('label');
      wrap.className = 'option';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = `q-${idx}`;
      input.value = opt;
      input.id = id;
      const span = document.createElement('span');
      span.textContent = opt;
      wrap.appendChild(input);
      wrap.appendChild(span);
      optionsDiv.appendChild(wrap);
    });
    multiSubmit.classList.remove('hidden');
    multiSubmit.disabled = true;
    optionsDiv.addEventListener('change', () => {
      const anyChecked = [...optionsDiv.querySelectorAll('input[type="checkbox"]')].some(i=>i.checked);
      multiSubmit.disabled = !anyChecked;
    });
    multiSubmit.onclick = () => {
      const chosen = [...optionsDiv.querySelectorAll('input[type="checkbox"]:checked')].map(i=>i.value);
      lockChoices();
      recordAnswer(chosen);
      nextQuestion();
    };
  }

  startQuestionTimer(q.timeLimitSec || 30);
}

function lockChoices() {
  optionsDiv.querySelectorAll('input').forEach(i => i.disabled = true);
  typedInput.disabled = true;
  typedSubmit.disabled = true;
}

typedSubmit.addEventListener('click', () => {
  const val = typedInput.value.trim();
  lockChoices();
  recordAnswer([val]);
  nextQuestion();
});

function recordAnswerTimeout() {
  const q = QUESTIONS[current];
  if (q.type === 'MCQ' || q.type === 'TrueFalse' || q.type === 'ImageBased') {
    const chosen = [...optionsDiv.querySelectorAll('input[type="radio"]:checked')].map(i=>i.value);
    recordAnswer(chosen);
  } else if (q.type === 'MultiMCQ') {
    const chosen = [...optionsDiv.querySelectorAll('input[type="checkbox"]:checked')].map(i=>i.value);
    recordAnswer(chosen);
  } else if (q.type === 'ShortAnswer') {
    recordAnswer([typedInput.value.trim()]);
  } else {
    recordAnswer([]); // fallback
  }
}

function isCorrect(q, givenArr) {
  if (q.type === 'MCQ' || q.type === 'TrueFalse' || q.type === 'ImageBased') {
    return givenArr.length === 1 && q.answer.includes(givenArr[0]);
  }
  if (q.type === 'MultiMCQ') {
    const setA = new Set(givenArr);
    const setB = new Set(q.answer);
    if (setA.size !== setB.size) return false;
    for (const v of setA) if (!setB.has(v)) return false;
    return true;
  }
  if (q.type === 'ShortAnswer') {
    const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g,'').trim();
    const g = norm(givenArr[0] ?? '');
    return (q.acceptable.length ? q.acceptable : q.answer).some(a => norm(a) === g);
  }
  return false;
}

function recordAnswer(givenArr) {
  const q = QUESTIONS[current];
  const correct = isCorrect(q, givenArr);
  if (correct) score++;
  answers.push({
    id: q.id,
    type: q.type,
    text: q.text,
    options: q.options,
    given: givenArr,
    correctAnswer: q.answer,
    correct
  });
}

function nextQuestion() {
  clearInterval(questionTick);
  if (current + 1 < QUESTIONS.length) {
    showQuestion(current + 1);
  } else {
    autoSubmit();
  }
}

function autoSubmit() {
  clearInterval(questionTick);
  clearInterval(globalTick);
  quizScreen.classList.add('hidden');
  quizStarted = false;

  const timestamp = new Date().toISOString();
  outReg.textContent = regNo;
  outScore.textContent = String(score);
  outTotal.textContent = String(QUESTIONS.length);

  // Save result to Firestore
  saveQuizResultToFirestore({
    regNo,
    email: userEmail,
    score,
    total: QUESTIONS.length,
    answers,
    timestamp
  });

  showResultScreen(score, answers, QUESTIONS.length, regNo, false);
}

function showResultScreen(finalScore, answerArr, totalQ, showOnly) {
  resultScreen.classList.remove('hidden');
  outReg.textContent = regNo;
  outScore.textContent = String(finalScore);
  outTotal.textContent = String(totalQ);

  // Detailed summary table
  summaryTable.innerHTML = `<tr>
    <th>#</th>
    <th>Question</th>
    <th>Your Answer</th>
    <th>Correct Answer</th>
    <th>Result</th>
  </tr>`;
  answerArr.forEach((ans, i) => {
    summaryTable.innerHTML += `<tr>
      <td>${i+1}</td>
      <td>${ans.text}</td>
      <td>${ans.given.join(', ')}</td>
      <td>${ans.correctAnswer.join(', ')}</td>
      <td>${ans.correct ? '✅' : '❌'}</td>
    </tr>`;
  });

  if (!showOnly) {
    // Optionally, show leaderboard button after quiz
    leaderboardBtn2.style.display = "inline-block";
  }
}

// ---- LEADERBOARD ----
async function showLeaderboard() {
  leaderboardScreen2.classList.remove('hidden');
  resultScreen.classList.add('hidden');
  startScreen.classList.add('hidden');
  quizScreen.classList.add('hidden');
  leaderboardBtn2.style.display = "none";

  // Fetch leaderboard data
  const data = await getLeaderboardFromFirestore();
  leaderboardTable2.innerHTML = `<tr>
    <th>Rank</th><th>Reg No</th><th>Email</th><th>Score</th>
  </tr>`;
  data.forEach((row, idx) => {
    leaderboardTable2.innerHTML += `<tr>
      <td>${idx+1}</td>
      <td>${row.regNo}</td>
      <td>${row.email}</td>
      <td>${row.score}</td>
    </tr>`;
  });
}

// ---- CSV Download ----
downloadCsvBtn.addEventListener('click', () => {
  const ts = new Date().toISOString();
  const rows = [
    ['reg_no','score','total','timestamp'],
    [regNo, String(score), String(QUESTIONS.length), ts]
  ];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `quiz_result_${regNo}.csv`; a.click();
  URL.revokeObjectURL(url);
});

restartBtn.addEventListener('click', () => {
  location.reload();
});

// ---- Progress Bar for Mobile/UX ----
function updateProgressBar(percent) {
  if (progressBar2) {
    progressBar2.style.width = `${Math.floor(percent*100)}%`;
    progressBar2.textContent = `${Math.floor(percent*100)}%`;
  }
}
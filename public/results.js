import { auth, provider, db } from "./firebase.js";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

const resultContent = document.getElementById("result-content");
let result = JSON.parse(sessionStorage.getItem("quizResult"));

async function fetchResultIfNeeded() {
  // Always prefer sessionStorage, but fall back to Firestore if missing
  if (!result) {
    try {
      const user = JSON.parse(sessionStorage.getItem("quizUser"));
      const currentQuizId = sessionStorage.getItem("quizId");
      if (!user || !currentQuizId) {
        resultContent.innerHTML = `<p>Session expired or invalid. Please log in again.</p>`;
        return;
      }
      const respDoc = await getDoc(doc(db, "quizzes", currentQuizId, "responses", user.uid));
      if (respDoc.exists()) {
        const respData = respDoc.data();
        result = {
          registrationNumber: respData.registrationNumber,
          score: respData.score,
          status: respData.status
        };
        sessionStorage.setItem("quizResult", JSON.stringify(result));
      } else {
        resultContent.innerHTML = `<p>No result found. Please attempt a quiz first.</p>`;
        return;
      }
    } catch (e) {
      resultContent.innerHTML = `<p>Error loading result. Please try again or contact your instructor.</p>`;
      return;
    }
  }
  // At this point, result is guaranteed to be set
  let statusText = "";
  if (result.status === "autosubmitted") {
    statusText = "<span style='color:red;'>(Quiz was auto-submitted/locked)</span>";
  } else if (result.status === "submitted") {
    statusText = "<span style='color:green;'>(Quiz submitted normally)</span>";
  } else {
    statusText = "<span style='color:gray;'>(Submission status unknown)</span>";
  }
  resultContent.innerHTML = `
    <h2>Registration Number: ${result.registrationNumber}</h2>
    <h2>Score: ${result.score}</h2>
    ${statusText}
  `;
}

fetchResultIfNeeded();
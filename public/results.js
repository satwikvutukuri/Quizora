// results.js

const resultContent = document.getElementById("result-content");
const result = JSON.parse(sessionStorage.getItem("quizResult"));

if (result) {
  let statusMsg = "";
  if (result.status === "autosubmitted") {
    statusMsg = `<div style="color:#e85d6f;font-weight:600;margin-bottom:10px;">
      <span>⚠️ Your quiz was auto-submitted.</span>
      ${result.autoSubmitReason ? `<br><span>Reason: ${result.autoSubmitReason}</span>` : ""}
    </div>`;
  } else {
    statusMsg = `<div style="color:#1fbf75;font-weight:600;margin-bottom:10px;">
      <span>✅ Your quiz was submitted successfully.</span>
    </div>`;
  }

  resultContent.innerHTML = `
    ${statusMsg}
    <h2>Registration Number: ${result.registrationNumber}</h2>
    <h2>Score: ${result.score}</h2>
  `;
} else {
  resultContent.innerHTML = `<p>No result found. Please attempt a quiz first.</p>`;
}